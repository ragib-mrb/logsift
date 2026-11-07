# Contributing to logsift

Thanks for helping! Bug reports, ideas, docs fixes and code are all welcome.

## Before you start

- **Bugs:** open an issue with the bug template. The command you ran and a few log lines that show the problem help most (remove anything private first).
- **A log format logsift reads wrong:** open a bug with 3–5 sample lines. These are some of the most useful reports.
- **New features:** open an issue first, so we can agree on the idea before you spend time on it.
- **Small fixes** (typos, docs, tests): send a pull request straight away.
- Looking for something to do? Try the issues labelled [`good first issue`](https://github.com/ragib-mrb/logsift/labels/good%20first%20issue) or [`help wanted`](https://github.com/ragib-mrb/logsift/labels/help%20wanted). Comment on the issue so others know you're on it.

## Set up

You need Node.js 22 or newer.

```bash
git clone https://github.com/<your-username>/logsift.git
cd logsift
npm install
npm test
```

Useful scripts:

| Command             | What it does                   |
| ------------------- | ------------------------------ |
| `npm test`          | Runs all tests (Vitest)        |
| `npm run lint`      | ESLint                         |
| `npm run typecheck` | TypeScript type check          |
| `npm run format`    | Formats the code with Prettier |
| `npm run build`     | Builds `dist/`                 |

Try your change on the sample logs:

```bash
npm run build && node dist/cli.js test/fixtures --request req-2
```

## Project layout

- `src/cli.ts`: the `logsift` command
- `src/run.ts`: reads the options and wires everything together
- `src/sources.ts`: finds files (folders, globs, `.gz`, stdin) and reads their lines
- `src/parse.ts`: works out each line's format, time and level
- `src/filter.ts`: the filters (`--level`, `--since`, `--request`, …)
- `src/merge.ts`: merges all files into one timeline by time
- `src/follow.ts`: `--follow`, watches files for new lines
- `src/output.ts`: pretty and JSON output, stats
- `test/`: tests; `test/fixtures/` has sample logs

## Pull requests

1. Fork the repo and create a branch from `main`.
2. Keep the change focused: one fix or feature per pull request.
3. Add or update tests for what you changed. For a new log format, add sample lines to a test.
4. Run `npm run lint`, `npm run typecheck`, `npm test` and `npm run format:check` before you push. CI runs the same checks.
5. Update `README.md` if behaviour or options change, and add a line under "Unreleased" in `CHANGELOG.md`.
6. Write a clear title, e.g. `fix: read timestamps with a comma before the milliseconds`.

## Rules that keep logsift fast and simple

- **No runtime dependencies.** Only Node.js built-ins; everything else is dev-only.
- **Stream, don't load.** Files are read line by line, so huge logs never need to fit in memory.
- **Read only.** logsift never changes or deletes log files.

## Code of conduct

Please follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
