# Changelog

All notable changes to this project are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-11-06

First release.

- Searches many log files, folders, globs, `.gz` files or stdin as one timeline, merged by time as it streams.
- Works out each line's format: JSON lines (pino, bunyan, winston, ECS), logfmt and plain text with a timestamp. Stack traces stay attached to their entry.
- Filters by level, time range, text or regex, and fields (`--where`); all filters must match.
- `--request <id>` follows one request, trace or correlation ID across every file; `--around` shows what happened near a moment.
- `--follow` watches files for new lines.
- Pretty or JSON output, `--stats` summary, and grep-style exit codes.
- The same parts can be used from code.

[Unreleased]: https://github.com/ragib-mrb/logsift/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ragib-mrb/logsift/releases/tag/v0.1.0
