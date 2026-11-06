# logsift

Search many log files as **one timeline**. Any format, real filters, and one flag to follow a single request across all your services.

```bash
npx @ragib.mrb/logsift logs/ --request req-2
```

```
11-05 13:23:05.000 INFO  api.log     request start reqId=req-2 method=POST url=/orders
11-05 13:23:05.100 INFO  gateway.log proxy request_id=req-2 path=/orders status=502
11-05 13:23:05.500 DEBUG worker.log  picked job for request req-2
11-05 13:23:06.000 ERROR worker.log  charge failed for req-2
Error: card declined
    at charge (/app/billing.js:42:11)
11-05 13:23:06.500 ERROR api.log     payment failed reqId=req-2 status=502
```

Three services, three log formats, one story.

## Why

- `grep` sees text, not time: lines from different files come out file by file, not in the order things happened.
- Pretty-printers like pino-pretty format one stream; they don't merge files or follow a request.
- The great log tools (lnav, hl) aren't one `npx` away.

logsift reads every file you give it, works out each line's format, and merges everything by time as it streams. A million-line, 115 MB file is searched in about 3 seconds.

## Install

```bash
npm install -g @ragib.mrb/logsift   # gives you the `logsift` command; or just: npx @ragib.mrb/logsift …
```

Needs Node.js 22 or newer. No dependencies.

## Use

```bash
logsift api.log worker.log              # several files, merged by time
logsift logs/                           # every log file in a folder (and .gz files)
logsift "logs/**/*.log"                 # globs work on Windows too
kubectl logs my-pod | logsift -l warn   # or pipe anything in
```

### Filters

All filters must match.

| Option                        | What it keeps                                                            | Example                                       |
| ----------------------------- | ------------------------------------------------------------------------ | --------------------------------------------- |
| `-l, --level`                 | this level and above                                                     | `-l warn`                                     |
| `-s, --since` / `-u, --until` | a time range                                                             | `-s 15m`, `-s 14:03`, `-u "2026-11-05 14:30"` |
| `-g, --grep`                  | text (any case), `/regex/flags` or `re:regex`; repeat to require several | `-g timeout`, `-g "re:fail\|denied"`          |
| `-w, --where`                 | field filters: `=`, `!=`, `>`, `>=`, `<`, `<=`, `~` (contains)           | `-w "status>=500" -w user.id=42`              |
| `-r, --request`               | every line that mentions one request, trace or correlation ID            | `-r req-2`                                    |
| `-a, --around` + `--window`   | what happened just before and after a moment                             | `-a 14:03 --window 30s`                       |

`--request` matches the whole ID only (so `req-42` doesn't match `req-420`). It checks the text of each line and common ID fields such as `reqId`, `requestId`, `traceId`, `correlationId` and `x-request-id`.

> **Git Bash on Windows** rewrites arguments that start with `/` into file paths, which breaks `/regex/`. Use `re:regex` instead.

### Output

| Option         | What you get                                                                     |
| -------------- | -------------------------------------------------------------------------------- |
| (default)      | readable, coloured lines with the time, level, file and fields                   |
| `--json`       | one JSON object per line, for `jq` or another tool                               |
| `--stats`      | counts by level and file, and the most common messages (numbers and IDs grouped) |
| `-n, --limit`  | stop after n matching lines                                                      |
| `-f, --follow` | keep watching the files and print new matching lines                             |
| `--no-color`   | plain text (also when `NO_COLOR` is set)                                         |

Exit code: `0` when something matched, `1` when nothing did, `2` on errors, like `grep`.

## Formats it understands

| Format     | Examples                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------- |
| JSON lines | pino, bunyan, winston, Elastic (ECS), most JSON loggers                                      |
| logfmt     | `time=… level=info msg="gateway up" port=8080`                                               |
| Plain text | `2026-11-05 14:03:01,123 ERROR …`, `[2026-11-05T14:03:01Z] [warn] …`, nginx and syslog times |

- Times can be ISO strings, seconds or milliseconds; levels can be words or pino/bunyan numbers.
- Stack traces and other lines that continue an entry stay attached to it.
- Lines with no time keep their place right after the line before them.
- Plain-text times without a time zone are read as your local time.

## Use it in code

```js
import {
  readEntries,
  mergeByTime,
  buildFilter,
  expandInputs,
  labelSources,
  openStream,
} from '@ragib.mrb/logsift';
```

## Develop

```bash
npm install
npm test
npm run build && node dist/cli.js test/fixtures --request req-2
```

## License

[MIT](LICENSE)
