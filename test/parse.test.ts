import { describe, expect, it } from 'vitest';
import { parseLine, parseLogfmt, toLevel, toTime } from '../src/parse.js';

const now = new Date('2026-11-05T12:00:00Z');

describe('levels', () => {
  it('reads words and pino/bunyan numbers', () => {
    expect(['WARN', 'warning', 'Err', 'critical', 'verbose'].map((w) => toLevel(w))).toEqual([
      'warn',
      'warn',
      'error',
      'fatal',
      'trace',
    ]);
    expect([10, 20, 30, 40, 50, 60, '30'].map((n) => toLevel(n))).toEqual([
      'trace',
      'debug',
      'info',
      'warn',
      'error',
      'fatal',
      'info',
    ]);
    expect(toLevel('loud')).toBeUndefined();
  });
});

describe('times', () => {
  it('reads ISO, seconds, milliseconds, nginx and syslog times', () => {
    expect(toTime('2026-11-05T13:23:00.000Z')).toBe(Date.UTC(2026, 10, 5, 13, 23));
    expect(toTime('2026-11-05 13:23:00,250')).toBe(Date.UTC(2026, 10, 5, 13, 23, 0, 250));
    expect(toTime(1793884980)).toBe(1793884980000);
    expect(toTime(1793884980123)).toBe(1793884980123);
    expect(toTime('05/Nov/2026:13:23:00 +0000')).toBe(Date.UTC(2026, 10, 5, 13, 23));
    expect(toTime('Nov  5 13:23:00', now)).toBe(Date.UTC(2026, 10, 5, 13, 23));
    expect(toTime('hello')).toBeUndefined();
  });
});

describe('lines', () => {
  it('parses pino JSON', () => {
    const p = parseLine('{"level":50,"time":1793884986500,"msg":"payment failed","status":502}');
    expect(p).toMatchObject({
      format: 'json',
      level: 'error',
      time: 1793884986500,
      msg: 'payment failed',
      fields: { status: 502 },
    });
  });

  it('parses winston and Elastic style JSON', () => {
    expect(parseLine('{"level":"warn","message":"slow","timestamp":"2026-11-05T13:23:00Z"}')).toMatchObject({
      level: 'warn',
      msg: 'slow',
      time: Date.UTC(2026, 10, 5, 13, 23),
    });
    expect(
      parseLine('{"@timestamp":"2026-11-05T13:23:00Z","log.level":"error","message":"x"}'),
    ).toMatchObject({ level: 'error', msg: 'x' });
  });

  it('parses logfmt, and ignores text that only has an "=" in it', () => {
    expect(parseLogfmt('level=info msg="gateway up" port=8080')).toEqual({
      level: 'info',
      msg: 'gateway up',
      port: '8080',
    });
    expect(parseLogfmt('user tried a=b in the search box')).toBeUndefined();
  });

  it('parses plain text with a time and level', () => {
    expect(parseLine('2026-11-05T13:23:06.000Z ERROR charge failed', now)).toMatchObject({
      format: 'text',
      level: 'error',
      msg: 'charge failed',
      time: Date.UTC(2026, 10, 5, 13, 23, 6),
      continuation: false,
    });
    expect(parseLine('[2026-11-05 13:23:06] [warn] disk almost full', now)).toMatchObject({
      level: 'warn',
      msg: 'disk almost full',
    });
  });

  it('marks stack trace lines as continuations', () => {
    expect(parseLine('    at charge (/app/billing.js:42:11)')?.continuation).toBe(true);
    expect(parseLine('Caused by: java.io.IOException')?.continuation).toBe(true);
    expect(parseLine('')).toBeUndefined();
  });

  it('falls back to text for broken JSON', () => {
    expect(parseLine('{"level":30, oops')).toMatchObject({ format: 'text' });
  });
});
