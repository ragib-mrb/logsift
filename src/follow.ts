import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { readEntries, type Source } from './sources.js';
import type { Entry } from './types.js';

/**
 * Watches files for new lines and passes each new entry to `onEntry`.
 * Polls file sizes, which works the same on Windows, macOS and Linux.
 * Returns a function that stops watching.
 */
export async function followFiles(
  sources: Source[],
  onEntry: (entry: Entry) => void,
  options: { intervalMs?: number } = {},
): Promise<() => void> {
  const files = sources.filter((s) => s.path && !/\.gz$/i.test(s.path));
  const offsets = new Map<string, number>();
  const lines = new Map<string, number>();
  for (const f of files) offsets.set(f.path!, (await stat(f.path!)).size);

  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      for (const f of files) {
        const path = f.path!;
        const size = (await stat(path).catch(() => undefined))?.size;
        if (size === undefined) continue;
        let start = offsets.get(path) ?? 0;
        if (size < start) start = 0; // file was truncated or rotated
        if (size === start) continue;
        offsets.set(path, size);
        const stream = createReadStream(path, { start, end: size - 1 });
        for await (const entry of readEntries(stream, f.name, { startLine: (lines.get(path) ?? 0) + 1 })) {
          lines.set(path, entry.line);
          onEntry(entry);
        }
      }
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), options.intervalMs ?? 500);
  return () => clearInterval(timer);
}
