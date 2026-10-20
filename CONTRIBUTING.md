# Contributing

Code Atlas is a personal edition of T3 Code maintained by Esteban. Bug reports are welcome; larger changes are best discussed in an issue first.

## Reporting a bug

[Open an issue](https://github.com/EstebanPdNS/Code-Atlas/issues/new?template=bug_report.md) with:

- the Code Atlas and macOS versions,
- the agent you were using (Claude Code, Codex or another),
- the steps that reproduce the problem,
- a screenshot or the relevant part of the logs in `~/.code-atlas/userdata/logs`.

Remove private paths, tokens and personal content before attaching anything.

## Changes

1. Follow the [getting started guide](docs/getting-started.md) to build the app.
2. Keep each change focused, and keep Code Atlas changes separate from upstream T3 Code code where possible, so the fork stays easy to update.
3. Run the tests and type checks for the packages you changed (see the [development runbook](docs/operations/development.md)).
4. Use a short, plain English commit title.

Problems that also happen in T3 Code belong upstream: [pingdotgg/t3code](https://github.com/pingdotgg/t3code).
