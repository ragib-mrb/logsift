import { LEVELS, type Entry, type Level } from './types.js';

type Parsed = Omit<Entry, 'source' | 'line' | 'raw'>;

const TIME_KEYS = ['time', 'timestamp', '@timestamp', 'ts', 'date', 'datetime', 't'];
const LEVEL_KEYS = ['level', 'lvl', 'severity', 'loglevel', 'log.level', '@level'];
const MSG_KEYS = ['msg', 'message', '@message', 'event', 'text'];

const LEVEL_WORDS: Record<string, Level> = {
  trace: 'trace',
  verbose: 'trace',
  silly: 'trace',
  debug: 'debug',
  dbg: 'debug',
  info: 'info',
  information: 'info',
  notice: 'info',
  http: 'info',
  warn: 'warn',
  warning: 'warn',
  error: 'error',
  err: 'error',
  fatal: 'fatal',
  critical: 'fatal',
  crit: 'fatal',
  panic: 'fatal',
  alert: 'fatal',
  emerg: 'fatal',
};

/** Level from a word ("WARN") or a pino/bunyan number (40). */
export function toLevel(value: unknown): Level | undefined {
  if (typeof value === 'number') {
    if (value >= 60) return 'fatal';
    if (value >= 50) return 'error';
    if (value >= 40) return 'warn';
    if (value >= 30) return 'info';
    if (value >= 20) return 'debug';
    return 'trace';
  }
  if (typeof value === 'string') {
    const word = value.trim().toLowerCase();
    if (/^\d+$/.test(word)) return toLevel(Number(word));
    return LEVEL_WORDS[word];
  }
  return undefined;
}

export const levelRank = (level: Level | undefined) => (level ? LEVELS.indexOf(level) : -1);

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

/** Time in ms from a number (seconds or ms) or a date string. */
export function toTime(value: unknown, now = new Date()): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e11 ? Math.round(value * 1000) : value; // seconds vs milliseconds
  }
  if (typeof value !== 'string' || value.length < 6) return undefined;
  const s = value.trim();
  if (/^\d{10}(\.\d+)?$/.test(s) || /^\d{13}$/.test(s)) return toTime(Number(s));

  // 05/Nov/2026:14:03:01 +0000 (nginx, apache)
  let m = /^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})(?:\s*([+-]\d{4}))?/.exec(s);
  if (m) {
    const [, d, mon, y, hh, mm, ss, tz] = m;
    const month = MONTHS[mon!.toLowerCase()];
    if (month === undefined) return undefined;
    const iso = `${y}-${String(month + 1).padStart(2, '0')}-${d}T${hh}:${mm}:${ss}${tz ? `${tz.slice(0, 3)}:${tz.slice(3)}` : ''}`;
    const t = Date.parse(iso);
    return Number.isNaN(t) ? undefined : t;
  }
  // Nov  5 14:03:01 (syslog, no year: assume this year)
  m = /^(\w{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})/.exec(s);
  if (m) {
    const month = MONTHS[m[1]!.toLowerCase()];
    if (month === undefined) return undefined;
    return new Date(
      now.getFullYear(),
      month,
      Number(m[2]),
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
    ).getTime();
  }
  // 2026-11-05 14:03:01,123 → ISO
  const iso = s.replace(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})[,.]?(\d+)?/,
    (_a, d, t, frac) => `${d}T${t}${frac ? `.${String(frac).slice(0, 3).padEnd(3, '0')}` : ''}`,
  );
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return undefined;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? undefined : t;
}

function getPath(obj: Record<string, unknown>, key: string): unknown {
  if (key in obj) return obj[key];
  let cur: unknown = obj;
  for (const part of key.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Pulls time, level and message out of structured fields. */
function fromFields(fields: Record<string, unknown>, format: 'json' | 'logfmt', now: Date): Parsed {
  const rest = { ...fields };
  const take = (keys: string[], convert: (v: unknown) => unknown) => {
    for (const key of keys) {
      const value = getPath(rest, key);
      const converted = value === undefined ? undefined : convert(value);
      if (converted !== undefined) {
        if (key in rest) delete rest[key];
        return converted;
      }
    }
    return undefined;
  };
  const time = take(TIME_KEYS, (v) => toTime(v, now)) as number | undefined;
  const level = take(LEVEL_KEYS, toLevel) as Level | undefined;
  const msg = take(MSG_KEYS, (v) => (typeof v === 'string' ? v : undefined)) as string | undefined;
  return { time, level, msg: msg ?? '', fields: rest, format };
}

/** Parses `key=value key2="quoted value"`; returns undefined when it doesn't look like logfmt. */
export function parseLogfmt(line: string): Record<string, unknown> | undefined {
  const fields: Record<string, unknown> = {};
  const re = /([\w.@-]+)=("(?:[^"\\]|\\.)*"|\S*)/g;
  let count = 0;
  let covered = 0;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    let value: string = m[2]!;
    if (value.startsWith('"')) value = value.slice(1, -1).replace(/\\(.)/g, '$1');
    fields[m[1]!] = value;
    count++;
    covered += m[0].length;
  }
  // Mostly key=value pairs, and at least one well-known key.
  const known = Object.keys(fields).some((k) => [...LEVEL_KEYS, ...MSG_KEYS, ...TIME_KEYS].includes(k));
  if (count < 2 || !known || covered < line.replace(/\s/g, '').length * 0.6) return undefined;
  return fields;
}

const TEXT_TIME =
  /^\[?((?:\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?)|(?:\d{2}\/\w{3}\/\d{4}:\d{2}:\d{2}:\d{2}(?:\s[+-]\d{4})?)|(?:\w{3}\s+\d{1,2}\s\d{2}:\d{2}:\d{2}))\]?\s*/;
const TEXT_LEVEL =
  /^\[?(trace|debug|dbg|info|notice|warn|warning|error|err|fatal|critical|crit|panic)\]?[:\s-]+/i;
const ANY_LEVEL = /\b(TRACE|DEBUG|INFO|NOTICE|WARN|WARNING|ERROR|FATAL|CRITICAL)\b/;

/** Plain text: optional timestamp, optional level word, then the message. */
function parseText(line: string, now: Date): Parsed & { hasTime: boolean } {
  let rest = line;
  let time: number | undefined;
  const tm = TEXT_TIME.exec(rest);
  if (tm) {
    time = toTime(tm[1], now);
    rest = rest.slice(tm[0].length);
  }
  let level: Level | undefined;
  const lm = TEXT_LEVEL.exec(rest);
  if (lm) {
    level = toLevel(lm[1]);
    rest = rest.slice(lm[0].length);
  } else {
    const any = ANY_LEVEL.exec(rest.slice(0, 60));
    if (any) level = toLevel(any[1]);
  }
  return { time, level, msg: rest.trim(), fields: {}, format: 'text', hasTime: time !== undefined };
}

/**
 * Parses one line. Returns `continuation: true` for lines that belong to the
 * entry before them, such as stack trace lines.
 */
export function parseLine(line: string, now = new Date()): (Parsed & { continuation: boolean }) | undefined {
  if (line.trim() === '') return undefined;
  const trimmed = line.trimStart();
  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed) as unknown;
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        return { ...fromFields(obj as Record<string, unknown>, 'json', now), continuation: false };
      }
    } catch {
      // Not JSON after all: fall through to the other formats.
    }
  }
  const lf = parseLogfmt(line);
  if (lf) return { ...fromFields(lf, 'logfmt', now), continuation: false };

  const text = parseText(line, now);
  const looksLikeContinuation =
    !text.hasTime && (/^\s+/.test(line) || /^(at |Caused by|\.\.\. \d+ more|Traceback|\})/.test(trimmed));
  const { hasTime: _hasTime, ...parsed } = text;
  return { ...parsed, continuation: looksLikeContinuation };
}
