import { levelRank, toLevel } from './parse.js';
import type { Entry, Level } from './types.js';

export interface FilterOptions {
  /** Minimum level, e.g. "warn" shows warn, error and fatal. */
  level?: string;
  since?: string;
  until?: string;
  /** Text (case-insensitive) or /regex/flags. Several are all required. */
  grep?: string[];
  /** Field filters like `status>=500`, `user.id=42`, `msg~timeout`. */
  where?: string[];
  /** Show only lines that mention this request, trace or correlation ID. */
  request?: string;
  /** A moment in time; shows lines within `window` of it. */
  around?: string;
  /** Size of the `around` window, e.g. "2m". Default 1m. */
  window?: string;
}

/** Field names that usually hold a request, trace or correlation ID. */
export const REQUEST_ID_KEYS = [
  'reqId',
  'req_id',
  'requestId',
  'request_id',
  'request-id',
  'x-request-id',
  'X-Request-Id',
  'traceId',
  'trace_id',
  'trace.id',
  'traceID',
  'correlationId',
  'correlation_id',
  'x-correlation-id',
  'spanId',
  'span_id',
  'req.id',
  'request.id',
  'rid',
];

const UNITS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/** "90s", "15m", "2h", "1d" → milliseconds. */
export function parseDuration(text: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)$/i.exec(text.trim());
  return m ? Number(m[1]) * UNITS[m[2]!.toLowerCase()]! : undefined;
}

/**
 * A point in time: a duration ago ("15m"), a time today ("14:03" or "14:03:30"),
 * or a date ("2026-11-05", "2026-11-05 14:03").
 */
export function parseMoment(text: string, now: Date): number {
  const ago = parseDuration(text);
  if (ago !== undefined) return now.getTime() - ago;
  const clock = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text.trim());
  if (clock) {
    const d = new Date(now);
    d.setHours(Number(clock[1]), Number(clock[2]), Number(clock[3] ?? 0), 0);
    return d.getTime();
  }
  const t = Date.parse(text.trim().replace(' ', 'T'));
  if (Number.isNaN(t)) throw new Error(`Can't read the time "${text}". Try 15m, 14:03 or 2026-11-05 14:03.`);
  return t;
}

const toRegex = (source: string, flags: string) => {
  try {
    return new RegExp(source, flags.replace('g', ''));
  } catch {
    throw new Error(`"${source}" is not a valid regular expression.`);
  }
};

/**
 * Plain text matches anywhere, ignoring case. `/regex/flags` is a regex.
 * `re:regex` is a case-insensitive regex that shells (like Git Bash) won't rewrite as a path.
 */
function textMatcher(pattern: string): (s: string) => boolean {
  const slashed = /^\/(.+)\/([a-z]*)$/.exec(pattern);
  if (slashed || pattern.startsWith('re:')) {
    const regex = slashed ? toRegex(slashed[1]!, slashed[2]!) : toRegex(pattern.slice(3), 'i');
    return (s) => regex.test(s);
  }
  const needle = pattern.toLowerCase();
  return (s) => s.toLowerCase().includes(needle);
}

function fieldValue(entry: Entry, key: string): unknown {
  if (key === 'msg' || key === 'message') return entry.msg;
  if (key === 'level') return entry.level;
  if (key === 'source' || key === 'file') return entry.source;
  if (key in entry.fields) return entry.fields[key];
  let cur: unknown = entry.fields;
  for (const part of key.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** `key op value`, with op one of = != >= <= > < ~ (contains / regex). */
export function parseWhere(expr: string): (e: Entry) => boolean {
  const m = /^([\w.@-]+)\s*(!=|>=|<=|=|>|<|~)\s*(.*)$/.exec(expr.trim());
  if (!m) throw new Error(`Can't read the filter "${expr}". Use key=value, key>=500, key~text.`);
  const [, key, op, wanted] = m as unknown as [string, string, string, string];
  const asNumber = Number(wanted);
  const numeric = wanted !== '' && !Number.isNaN(asNumber);
  const contains = op === '~' ? textMatcher(wanted) : undefined;
  return (entry) => {
    const value = fieldValue(entry, key);
    if (value === undefined || value === null) return op === '!=';
    const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
    switch (op) {
      case '=':
        return str === wanted;
      case '!=':
        return str !== wanted;
      case '~':
        return contains!(str);
      default: {
        const n = typeof value === 'number' ? value : Number(str);
        if (!numeric || Number.isNaN(n)) return false;
        if (op === '>') return n > asNumber;
        if (op === '>=') return n >= asNumber;
        if (op === '<') return n < asNumber;
        return n <= asNumber;
      }
    }
  };
}

/** Builds one test from all the filter options. Throws a readable error on bad input. */
export function buildFilter(options: FilterOptions, now = new Date()): (e: Entry) => boolean {
  const tests: ((e: Entry) => boolean)[] = [];

  if (options.level) {
    const min = toLevel(options.level);
    if (!min)
      throw new Error(`Unknown level "${options.level}". Use trace, debug, info, warn, error or fatal.`);
    const rank = levelRank(min as Level);
    tests.push((e) => levelRank(e.level) >= rank);
  }
  if (options.since) {
    const from = parseMoment(options.since, now);
    tests.push((e) => e.time !== undefined && e.time >= from);
  }
  if (options.until) {
    const to = parseMoment(options.until, now);
    tests.push((e) => e.time !== undefined && e.time <= to);
  }
  if (options.around) {
    const at = parseMoment(options.around, now);
    const span = parseDuration(options.window ?? '1m');
    if (span === undefined) throw new Error(`Can't read the window "${options.window}". Try 30s or 2m.`);
    tests.push((e) => e.time !== undefined && Math.abs(e.time - at) <= span);
  }
  for (const pattern of options.grep ?? []) {
    const match = textMatcher(pattern);
    tests.push((e) => match(e.raw));
  }
  for (const expr of options.where ?? []) tests.push(parseWhere(expr));
  if (options.request) {
    const id = options.request;
    // The whole ID only: "req-42" must not match "req-420".
    const whole = new RegExp(`(?<![\\w-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`);
    tests.push(
      (e) =>
        // Any match has the ID somewhere in the line, so that cheap check skips most lines.
        e.raw.includes(id) &&
        (whole.test(e.raw) || REQUEST_ID_KEYS.some((k) => String(fieldValue(e, k) ?? '') === id)),
    );
  }
  return (e) => tests.every((t) => t(e));
}
