import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { buildFilter, parseDuration, parseMoment, parseWhere } from '../src/filter.js';
import { mergeByTime } from '../src/merge.js';
import { readEntries } from '../src/sources.js';
import type { Entry } from '../src/types.js';

const now = new Date('2026-11-05T13:30:00Z');
const entry = (over: Partial<Entry>): Entry => ({
  msg: '',
  fields: {},
  raw: '',
  source: 'a.log',
  line: 1,
  format: 'json',
  ...over,
});

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe('times and durations', () => {
  it('reads durations and moments', () => {
    expect(parseDuration('15m')).toBe(900_000);
    expect(parseDuration('1.5h')).toBe(5_400_000);
    expect(parseDuration('soon')).toBeUndefined();
    expect(parseMoment('10m', now)).toBe(Date.UTC(2026, 10, 5, 13, 20));
    expect(parseMoment('13:23', now)).toBe(Date.UTC(2026, 10, 5, 13, 23));
    expect(parseMoment('2026-11-05 13:23', now)).toBe(Date.UTC(2026, 10, 5, 13, 23));
    expect(() => parseMoment('lunchtime', now)).toThrow(/Can't read the time/);
  });
});

describe('filters', () => {
  it('compares fields by text and number', () => {
    const e = entry({ fields: { status: 502, user: { id: 42 }, path: '/orders' } });
    expect(parseWhere('status>=500')(e)).toBe(true);
    expect(parseWhere('status<500')(e)).toBe(false);
    expect(parseWhere('user.id=42')(e)).toBe(true);
    expect(parseWhere('path~ORD')(e)).toBe(true);
    expect(parseWhere('missing!=x')(e)).toBe(true);
    expect(() => parseWhere('nonsense')).toThrow(/Can't read the filter/);
  });

  it('combines level, time, text and request filters', () => {
    const t = Date.UTC(2026, 10, 5, 13, 23);
    const f = buildFilter({ level: 'warn', since: '10m', grep: ['pay'], request: 'req-2' }, now);
    expect(f(entry({ level: 'error', time: t, raw: 'payment req-2' }))).toBe(true);
    expect(f(entry({ level: 'info', time: t, raw: 'payment req-2' }))).toBe(false);
    expect(f(entry({ level: 'error', time: t - 3_600_000, raw: 'payment req-2' }))).toBe(false);
    expect(f(entry({ level: 'error', time: t, raw: 'payment req-3' }))).toBe(false);
    const traced = entry({
      level: 'error',
      time: t,
      raw: '{"traceId":"req-2","msg":"pay"}',
      fields: { traceId: 'req-2' },
    });
    expect(f(traced)).toBe(true);
  });

  it('matches whole request IDs only', () => {
    const f = buildFilter({ request: 'req-42' });
    expect(f(entry({ raw: 'job for req-42 done' }))).toBe(true);
    expect(f(entry({ raw: '{"reqId":"req-42"}' }))).toBe(true);
    expect(f(entry({ raw: 'job for req-420 done' }))).toBe(false);
    expect(f(entry({ raw: 'job for xreq-42' }))).toBe(false);
  });

  it('supports /regex/ and re:regex', () => {
    expect(buildFilter({ grep: ['/time(d|out)/'] })(entry({ raw: 'timed out' }))).toBe(true);
    expect(buildFilter({ grep: ['re:FAIL|grow'] })(entry({ raw: 'queue growing' }))).toBe(true);
    expect(() => buildFilter({ grep: ['re:(('] })).toThrow(/not a valid regular expression/);
  });

  it('keeps lines within the --around window', () => {
    const f = buildFilter({ around: '13:23', window: '30s' }, now);
    expect(f(entry({ time: Date.UTC(2026, 10, 5, 13, 23, 20) }))).toBe(true);
    expect(f(entry({ time: Date.UTC(2026, 10, 5, 13, 24) }))).toBe(false);
  });

  it('explains bad input', () => {
    expect(() => buildFilter({ level: 'loud' })).toThrow(/Unknown level/);
    expect(() => buildFilter({ around: '13:23', window: 'big' }, now)).toThrow(/window/);
  });
});

describe('reading and merging', () => {
  it('folds stack traces into the entry above and keeps line numbers', async () => {
    const text = [
      '2026-11-05T13:23:06Z ERROR charge failed',
      'Error: card declined',
      '    at charge (/app/billing.js:42:11)',
      '2026-11-05T13:23:07Z INFO next',
    ].join('\n');
    const entries = await collect(readEntries(Readable.from([text]), 'w.log'));
    expect(entries).toHaveLength(2);
    expect(entries[0]!.raw.split('\n')).toHaveLength(3);
    expect(entries[1]).toMatchObject({ msg: 'next', line: 4 });
  });

  it('gives untimed lines the time of the line before', async () => {
    const lines = '{"time":1793884980000,"msg":"a"}\n{"msg":"b"}\n';
    const entries = await collect(readEntries(Readable.from([lines]), 'x'));
    expect(entries.map((e) => e.time)).toEqual([1793884980000, 1793884980000]);
  });

  it('merges streams by time, oldest first, stable on ties', async () => {
    async function* s(name: string, times: number[]) {
      for (const time of times) yield entry({ source: name, time });
    }
    const merged = await collect(mergeByTime([s('a', [1, 4, 4]), s('b', [2, 3, 4, 9]), s('c', [])]));
    expect(merged.map((e) => `${e.source}${e.time}`)).toEqual(['a1', 'b2', 'b3', 'a4', 'a4', 'b4', 'b9']);
  });
});
