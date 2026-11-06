import { styleText } from 'node:util';
import type { Entry, Level } from './types.js';

type Style = Parameters<typeof styleText>[0];

const LEVEL_STYLE: Record<Level, Style> = {
  trace: 'gray',
  debug: 'blue',
  info: 'green',
  warn: 'yellow',
  error: 'red',
  fatal: ['bgRed', 'white', 'bold'],
};

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Local time: `11-05 14:03:01.123`. */
export function formatTime(ms: number | undefined): string {
  if (ms === undefined) return '              ';
  const d = new Date(ms);
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(
    d.getSeconds(),
  )}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function formatValue(v: unknown): string {
  if (typeof v === 'string') return /[\s"=]/.test(v) ? JSON.stringify(v) : v;
  return JSON.stringify(v);
}

/** One readable line (plus any continuation lines) for the terminal. */
export function formatPretty(entry: Entry, options: { color: boolean; sourceWidth: number }): string {
  const paint = (style: Style, text: string) => (options.color ? styleText(style, text) : text);
  const level = (entry.level ?? '').toUpperCase().padEnd(5);
  const parts = [
    paint('dim', formatTime(entry.time)),
    entry.level ? paint(LEVEL_STYLE[entry.level], level) : level,
    paint('cyan', entry.source.padEnd(options.sourceWidth)),
  ];
  if (entry.format === 'text') {
    parts.push(entry.msg);
  } else {
    parts.push(entry.msg);
    const extras = Object.entries(entry.fields)
      .filter(([k]) => !['pid', 'hostname', 'v', 'name'].includes(k))
      .map(([k, v]) => `${paint('dim', `${k}=`)}${formatValue(v)}`);
    if (extras.length) parts.push(extras.join(' '));
  }
  const continuation = entry.raw.includes('\n') ? `\n${entry.raw.slice(entry.raw.indexOf('\n') + 1)}` : '';
  return parts.join(' ') + (continuation ? paint('dim', continuation) : '');
}

/** One JSON object per line, ready for jq or another tool. */
export function formatJson(entry: Entry): string {
  return JSON.stringify({
    time: entry.time === undefined ? null : new Date(entry.time).toISOString(),
    level: entry.level ?? null,
    source: entry.source,
    line: entry.line,
    msg: entry.msg,
    ...entry.fields,
    ...(entry.raw.includes('\n') ? { stack: entry.raw.slice(entry.raw.indexOf('\n') + 1) } : {}),
  });
}

/** Turns "user 42 timed out after 3000ms" into "user # timed out after #ms" to group similar messages. */
export function messageShape(msg: string): string {
  return msg
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\b[0-9a-f]{16,}\b/gi, '<id>')
    .replace(/\d+(\.\d+)?/g, '#')
    .slice(0, 120);
}

export class Stats {
  total = 0;
  first?: number;
  last?: number;
  readonly byLevel = new Map<string, number>();
  readonly bySource = new Map<string, number>();
  readonly byMessage = new Map<string, { count: number; level?: Level }>();

  add(entry: Entry): void {
    this.total++;
    if (entry.time !== undefined) {
      this.first = Math.min(this.first ?? entry.time, entry.time);
      this.last = Math.max(this.last ?? entry.time, entry.time);
    }
    const level = entry.level ?? 'none';
    this.byLevel.set(level, (this.byLevel.get(level) ?? 0) + 1);
    this.bySource.set(entry.source, (this.bySource.get(entry.source) ?? 0) + 1);
    const shape = messageShape(entry.msg || entry.raw);
    const m = this.byMessage.get(shape) ?? { count: 0, level: entry.level };
    m.count++;
    this.byMessage.set(shape, m);
  }

  format(color: boolean): string {
    const paint = (style: Style, text: string) => (color ? styleText(style, text) : text);
    const sorted = (map: Map<string, number>) => [...map].sort((a, b) => b[1] - a[1]);
    const lines = [
      paint('bold', `${this.total} matching lines`) +
        (this.first !== undefined ? `  ${formatTime(this.first)} → ${formatTime(this.last)}` : ''),
      '',
      paint('bold', 'By level'),
      ...sorted(this.byLevel).map(([k, n]) => `  ${String(n).padStart(8)}  ${k}`),
      '',
      paint('bold', 'By file'),
      ...sorted(this.bySource).map(([k, n]) => `  ${String(n).padStart(8)}  ${k}`),
      '',
      paint('bold', 'Most common messages'),
      ...[...this.byMessage]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 10)
        .map(([shape, m]) => `  ${String(m.count).padStart(8)}  ${(m.level ?? '').padEnd(5)}  ${shape}`),
    ];
    return lines.join('\n');
  }
}
