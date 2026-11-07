# Security policy

## Supported versions

Only the latest release of `@ragib.mrb/logsift` gets security fixes.

## Reporting a vulnerability

Please **don't** open a public issue for security problems.

Report it privately through GitHub: go to the [Security tab](https://github.com/ragib-mrb/logsift/security) and click **Report a vulnerability**. Include the logsift and Node.js versions, what an attacker could do, and the steps to reproduce it.

You'll get a reply within 7 days. Once a fix is released, you'll be credited in the release notes unless you'd rather not be.

## What counts

logsift reads log files, and logs often hold text an attacker controls. Problems that matter most:

- log lines that can send terminal escape codes through the pretty output (changing the terminal, hiding lines, faking output)
- a crafted line or file that hangs logsift or uses huge amounts of memory
- logsift writing to, changing or deleting any file
