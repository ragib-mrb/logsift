#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { run } from './run.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// Stop quietly when the reader goes away, e.g. `logsift app.log | head`.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

const code = await run(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  stdin: process.stdin,
  version: pkg.version,
});
process.exitCode = code;
