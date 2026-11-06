import { parseArgs } from 'node:util';
import type { Readable, Writable } from 'node:stream';
import { buildFilter } from './filter.js';
import { followFiles } from './follow.js';
import { mergeByTime } from './merge.js';
import { Stats, formatJson, formatPretty } from './output.js';
import { expandInputs, labelSources, openStream, readEntries, type Source } from './sources.js';

export const HELP = `logsift: search many log files as one timeline

Usage
  logsift [files, folders or globs...] [options]
  some-command | logsift [options]

Filters (all must match)
  -l, --level <level>     this level and above: trace, debug, info, warn, error, fatal
  -s, --since <time>      15m, 2h, 1d, 14:03 or 2026-11-05 14:03
  -u, --until <time>      same formats as --since
  -g, --grep <text>       text (any case), /regex/i or re:regex; repeat to require several
  -w, --where <expr>      field filter: status>=500, user.id=42, msg~timeout; repeatable
  -r, --request <id>      every line that mentions this request, trace or correlation ID
  -a, --around <time>     lines near a moment, e.g. 14:03 (see --window)
      --window <span>     size of --around on each side (default 1m)

Output
      --json              one JSON object per line
      --stats             counts by level and file, and the most common messages
  -n, --limit <n>         stop after n matching lines
  -f, --follow            keep watching the files for new lines
      --no-color          plain text (also when NO_COLOR is set)
  -h, --help              show this help
  -v, --version           show the version

Exit code: 0 when something matched, 1 when nothing did, 2 on errors.`;

export interface RunIO {
  stdout: Writable;
  stderr: Writable;
  stdin: Readable & { isTTY?: boolean };
  cwd?: string;
  now?: Date;
  /** Colours on? Default: when stdout is a terminal and NO_COLOR isn't set. */
  color?: boolean;
  /** Called with a stop function when following, so tests can end it. */
  onFollow?: (stop: () => void) => void;
  version?: string;
}

const write = (stream: Writable, text: string) =>
  new Promise<void>((resolve) => {
    if (stream.write(`${text}\n`)) resolve();
    else stream.once('drain', resolve);
  });

/** Runs the command line. Returns the exit code instead of exiting, so it can be tested. */
export async function run(argv: string[], io: RunIO): Promise<number> {
  let args;
  try {
    args = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        level: { type: 'string', short: 'l' },
        since: { type: 'string', short: 's' },
        until: { type: 'string', short: 'u' },
        grep: { type: 'string', short: 'g', multiple: true },
        where: { type: 'string', short: 'w', multiple: true },
        request: { type: 'string', short: 'r' },
        around: { type: 'string', short: 'a' },
        window: { type: 'string' },
        json: { type: 'boolean' },
        stats: { type: 'boolean' },
        limit: { type: 'string', short: 'n' },
        follow: { type: 'boolean', short: 'f' },
        'no-color': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (err) {
    await write(io.stderr, `logsift: ${(err as Error).message}\nRun logsift --help to see the options.`);
    return 2;
  }
  const { values: o, positionals } = args;
  if (o.help) {
    await write(io.stdout, HELP);
    return 0;
  }
  if (o.version) {
    await write(io.stdout, io.version ?? 'unknown');
    return 0;
  }

  const now = io.now ?? new Date();
  const cwd = io.cwd ?? process.cwd();
  const color =
    !o['no-color'] &&
    (io.color ?? Boolean((io.stdout as { isTTY?: boolean }).isTTY && !process.env.NO_COLOR));

  try {
    const filter = buildFilter(o, now);
    const limit = o.limit === undefined ? Infinity : Number(o.limit);
    if (o.limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
      throw new Error('--limit needs a whole number above 0.');
    }

    let sources: Source[];
    if (positionals.length > 0) {
      const files = await expandInputs(positionals, cwd);
      if (files.length === 0) throw new Error('No log files found for those inputs.');
      sources = labelSources(files, cwd);
    } else if (!io.stdin.isTTY) {
      sources = [{ name: 'stdin' }];
    } else {
      await write(io.stdout, HELP);
      return 2;
    }

    const sourceWidth = Math.min(24, Math.max(...sources.map((s) => s.name.length)));
    const stats = o.stats ? new Stats() : undefined;
    let matched = 0;
    const emit = async (entry: Parameters<typeof filter>[0]) => {
      if (!filter(entry)) return;
      matched++;
      if (stats) stats.add(entry);
      else await write(io.stdout, o.json ? formatJson(entry) : formatPretty(entry, { color, sourceWidth }));
    };

    const streams = sources.map((s) => readEntries(openStream(s, io.stdin), s.name, { now }));
    for await (const entry of mergeByTime(streams)) {
      await emit(entry);
      if (matched >= limit) break;
    }

    if (o.follow && matched < limit && sources.some((s) => s.path)) {
      await new Promise<void>((resolve) => {
        void followFiles(sources, (entry) => void emit(entry)).then((stop) => {
          const end = () => {
            stop();
            resolve();
          };
          process.once('SIGINT', end);
          io.onFollow?.(end);
        });
      });
    }

    if (stats) await write(io.stdout, stats.format(color));
    return matched > 0 ? 0 : 1;
  } catch (err) {
    await write(io.stderr, `logsift: ${(err as Error).message}`);
    return 2;
  }
}
