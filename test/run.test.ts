import { appendFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { run, type RunIO } from '../src/run.js';

const fixtures = join(import.meta.dirname, 'fixtures');
const now = new Date('2026-11-05T13:30:00Z');

async function sift(args: string[], extra: Partial<RunIO> = {}) {
  const out = new PassThrough();
  const err = new PassThrough();
  let stdout = '';
  let stderr = '';
  out.on('data', (d) => (stdout += d));
  err.on('data', (d) => (stderr += d));
  const stdin = Object.assign(Readable.from([]), { isTTY: true });
  const code = await run(args, {
    stdout: out,
    stderr: err,
    stdin,
    cwd: fixtures,
    now,
    color: false,
    ...extra,
  });
  return { code, stdout, stderr, lines: stdout.trimEnd().split('\n').filter(Boolean) };
}

describe('logsift command', () => {
  it('merges every file in a folder, including .gz, into one timeline', async () => {
    const { code, lines } = await sift(['.']);
    expect(code).toBe(0);
    expect(lines[0]).toContain('rotated file line'); // from old.log.gz, the oldest
    expect(lines.at(-1)).toContain('health check failed');
    const times = lines.filter((l) => /^\d\d-\d\d /.test(l)).map((l) => l.slice(0, 18));
    expect([...times].sort()).toEqual(times);
  });

  it('follows one request across JSON, logfmt and text logs', async () => {
    const { lines, stdout } = await sift(['.', '--request', 'req-2']);
    expect(stdout).toContain('api.log');
    expect(stdout).toContain('gateway.log');
    expect(stdout).toContain('worker.log');
    expect(stdout).toContain('at charge (/app/billing.js:42:11)');
    expect(stdout).not.toContain('req-1');
    expect(lines.filter((l) => /^\d\d-\d\d /.test(l))).toHaveLength(5);
  });

  it('filters by level and field, and writes JSON', async () => {
    const { lines } = await sift(['.', '-l', 'error', '-w', 'status>=500', '--json']);
    expect(lines.map((l) => JSON.parse(l))).toEqual([
      expect.objectContaining({ source: 'api.log', msg: 'payment failed', status: 502, level: 'error' }),
    ]);
  });

  it('expands globs itself (so they work on Windows too)', async () => {
    const { stdout } = await sift(['*.log', '--stats']);
    expect(stdout).toMatch(/^12 matching lines/);
    expect(stdout).not.toContain('old.log.gz');
  });

  it('shows stats', async () => {
    const { stdout } = await sift(['.', '--stats']);
    expect(stdout).toContain('13 matching lines');
    expect(stdout).toMatch(/3 {2}error/);
    expect(stdout).toContain('request start');
  });

  it('stops at --limit', async () => {
    expect((await sift(['.', '-n', '2'])).lines).toHaveLength(2);
  });

  it('reads from a pipe', async () => {
    const stdin = Object.assign(Readable.from(['2026-11-05T13:00:00Z WARN from a pipe\n']), { isTTY: false });
    const { lines } = await sift([], { stdin });
    expect(lines[0]).toContain('stdin');
    expect(lines[0]).toContain('from a pipe');
  });

  it('uses exit code 1 when nothing matches and 2 on errors', async () => {
    expect((await sift(['.', '-g', 'no such text'])).code).toBe(1);
    const bad = await sift(['.', '--level', 'loud']);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain('Unknown level');
    expect((await sift(['missing.log'])).stderr).toContain('No such file or folder');
    expect((await sift(['--nope'])).code).toBe(2);
  });

  it('prints help', async () => {
    const { code, stdout } = await sift(['--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('--request');
  });

  it('follows files for new lines', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'logsift-'));
    const file = join(dir, 'live.log');
    await writeFile(file, '2026-11-05T13:00:00Z INFO first\n');
    const out = new PassThrough();
    let stdout = '';
    out.on('data', (d) => (stdout += d));
    let stop: () => void = () => {};
    const done = run([file, '-f', '-l', 'warn'], {
      stdout: out,
      stderr: new PassThrough(),
      stdin: Object.assign(Readable.from([]), { isTTY: true }),
      now,
      color: false,
      onFollow: (s) => (stop = s),
    });
    await new Promise((r) => setTimeout(r, 200));
    await appendFile(file, '2026-11-05T13:00:01Z INFO skip me\n2026-11-05T13:00:02Z ERROR it broke\n');
    for (let i = 0; i < 40 && !stdout.includes('it broke'); i++) await new Promise((r) => setTimeout(r, 100));
    stop();
    expect(await done).toBe(0);
    expect(stdout).toContain('it broke');
    expect(stdout).not.toContain('skip me');
    expect(stdout).not.toContain('first');
  });
});
