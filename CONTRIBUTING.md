# Contributing

Use Node.js 24 and npm ci. Run npm run verify before proposing a change; it checks the full Obsidian lint preset, TypeScript and compiled regression tests. Use a disposable test vault for native desktop/mobile checks and never commit data.json, secrets or private notes.

Changes to paths, scope, deduplication, pairing or persistence need a regression test. Keep the installable bundle browser-only and preserve create-only delivery on desktop and mobile. Run npm run test:postgres only against a new local disposable database with a restricted test role, as documented in relay/README.md.

Open a PR with the problem, behavior change, validation and any physical-device limitations. Packaging uses npm run package:community -- /absolute/new/staging-folder. A candidate or draft release is not a published update; verify attached assets, attestations and the Community scorecard before claiming publication.
