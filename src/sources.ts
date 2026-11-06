import { createReadStream } from 'node:fs';
import { glob, stat, readdir } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { parseLine } from './parse.js';
import type { Entry } from './types.js';

export interface Source {
  /** Short label shown next to each line. */
  name: string;
  /** Full path, or undefined for stdin. */
  path?: string;
}

const LOG_FILE = /\.(log|txt|json|jsonl|ndjson|out|err)(\.\d+)?(\.gz)?$|\.gz$/i;
const MAX_ENTRY_CHARS = 64 * 1024;

async function walk(dir: string, out: string[]): Promise<void> {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, item.name);
    if (item.isDirectory()) {
      if (item.name !== 'node_modules' && !item.name.startsWith('.')) await walk(full, out);
    } else if (LOG_FILE.test(item.name)) {
      out.push(full);
    }
  }
}

/**
 * Turns the inputs (files, folders, globs) into a sorted list of files.
 * Globs are expanded here, so they work on Windows shells too.
 */
export async function expandInputs(inputs: string[], cwd = process.cwd()): Promise<string[]> {
  const files = new Set<string>();
  for (const input of inputs) {
    if (/[*?[\]{}]/.test(input)) {
      for await (const match of glob(input, { cwd })) files.add(resolve(cwd, match));
      continue;
    }
    const full = resolve(cwd, input);
    const info = await stat(full).catch(() => undefined);
    if (!info) throw new Error(`No such file or folder: ${input}`);
    if (info.isDirectory()) {
      const found: string[] = [];
      await walk(full, found);
      found.forEach((f) => files.add(f));
    } else {
      files.add(full);
    }
  }
  return [...files].sort();
}

/** Short, unique labels: the file name, or a relative path when names repeat. */
export function labelSources(paths: string[], cwd = process.cwd()): Source[] {
  const counts = new Map<string, number>();
  for (const p of paths) counts.set(basename(p), (counts.get(basename(p)) ?? 0) + 1);
  return paths.map((p) => ({
    path: p,
    name: (counts.get(basename(p)) ?? 0) > 1 ? relative(cwd, p).replace(/\\/g, '/') : basename(p),
  }));
}

export function openStream(source: Source, stdin: Readable = process.stdin): Readable {
  if (!source.path) return stdin;
  const raw = createReadStream(source.path);
  return /\.gz$/i.test(source.path) ? raw.pipe(createGunzip()) : raw;
}

/**
 * Reads a stream into entries. Lines that continue the entry before them
 * (stack traces, wrapped JSON) are folded into it. Entries without a time take
 * the time of the entry before them, so they keep their place in the timeline.
 */
export async function* readEntries(
  stream: Readable,
  source: string,
  options: { now?: Date; startLine?: number } = {},
): AsyncGenerator<Entry> {
  const now = options.now ?? new Date();
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let pending: Entry | undefined;
  let pendingHasOwnTime = false;
  let lastTime: number | undefined;
  let lineNo = (options.startLine ?? 1) - 1;

  for await (const line of lines) {
    lineNo++;
    const parsed = parseLine(line, now);
    if (!parsed) continue;
    // In a text log whose lines start with a time, a line without one belongs
    // to the entry above it (e.g. "Error: card declined" in a stack trace).
    const untimedTextAfterTimed =
      parsed.format === 'text' &&
      parsed.time === undefined &&
      pending?.format === 'text' &&
      pendingHasOwnTime;
    if (pending && (parsed.continuation || untimedTextAfterTimed)) {
      if (pending.raw.length < MAX_ENTRY_CHARS) pending.raw += `\n${line}`;
      continue;
    }
    if (pending) yield pending;
    const { continuation: _c, ...rest } = parsed;
    pendingHasOwnTime = rest.time !== undefined;
    if (rest.time !== undefined) lastTime = rest.time;
    pending = { ...rest, time: rest.time ?? lastTime, raw: line, source, line: lineNo };
  }
  if (pending) yield pending;
}
