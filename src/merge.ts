import type { Entry } from './types.js';

/**
 * Merges several time-ordered streams into one, oldest first. Each stream is
 * read one entry at a time, so memory stays small however big the files are.
 * Entries with no time at all sort first; ties keep the input order.
 */
export async function* mergeByTime(streams: AsyncIterable<Entry>[]): AsyncGenerator<Entry> {
  const iterators = streams.map((s) => s[Symbol.asyncIterator]());
  const heads: (Entry | undefined)[] = await Promise.all(
    iterators.map(async (it) => (await it.next()).value as Entry | undefined),
  );

  try {
    yield* pickOldest(iterators, heads);
  } finally {
    // Stopping early (e.g. --limit) closes every file.
    await Promise.all(iterators.map((it) => it.return?.()));
  }
}

async function* pickOldest(
  iterators: AsyncIterator<Entry>[],
  heads: (Entry | undefined)[],
): AsyncGenerator<Entry> {
  while (true) {
    let best = -1;
    for (let i = 0; i < heads.length; i++) {
      const head = heads[i];
      if (!head) continue;
      if (best === -1) {
        best = i;
        continue;
      }
      const current = heads[best]!;
      if ((head.time ?? -Infinity) < (current.time ?? -Infinity)) best = i;
    }
    if (best === -1) return;
    yield heads[best]!;
    const next = await iterators[best]!.next();
    heads[best] = next.done ? undefined : next.value;
  }
}
