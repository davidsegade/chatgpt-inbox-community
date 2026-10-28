# Community publication checklist — 27 October 2026

Candidate 0.4.4. Source and install assets are prepared separately from the original mixed development repository. A GitHub release does not mean the plugin has been accepted by Obsidian.

## Ready for repository/release review

- [x] Independent ID `chatgpt-inbox-community`, display name, author and MIT license.
- [x] Manifest, versions, package and release version agree.
- [x] Minimum declared version 1.14.5, matching recorded desktop acceptance; do not infer earlier compatibility from the API typings.
- [x] Browser bundle checked for Node/Electron dependencies; `isDesktopOnly: false`.
- [x] README explains accounts, network use, hosting costs, local/mobile behavior and no included public relay.
- [x] Privacy documentation separates active-store retention from operator logs/backups.
- [x] Local packager stages an allowlisted source tree with root README/LICENSE/manifest and individual install assets; no private vault, credentials or Git history.
- [x] OAuth browser Origin/CSP corrections, refresh rotation/replay protection, durable rollback and startup handover tests.
- [x] Actual PostgreSQL process acceptance, including initial lease retry, SIGTERM, SIGKILL and refresh persistence.

## Before claiming broad mobile/hosted-service acceptance

- [ ] Record exact iOS and Obsidian versions plus candidate hashes for the user-reported working iPhone setup.
- [ ] Complete physical mobile suspension/resume, offline/reconnect, conflict, scope/revoke, two-device and refresh acceptance.
- [ ] If offering a hosted relay, define its audience/costs and publish operator-specific privacy, infrastructure/log/backup retention and support policy. This release supplies a self-hosted relay, not access to the author's beta infrastructure.
- [ ] Verify hosted TLS, database availability/lifetime and the chosen single-writer deployment process.

## Directory status

On 28 October 2026 the official directory lists `chatgpt-inbox-community`, linked to `davidsegade/chatgpt-inbox-community`, at version 0.4.3, with automated review Passed. The entry explicitly has not been manually reviewed. Version 0.4.4 remains a candidate until released and rescanned. Physical-iPhone acceptance is tracked separately in MOBILE-ACCEPTANCE.md.

## Original directory submission procedure

1. Use a standalone GitHub repository whose default branch has README.md, LICENSE, manifest.json and the reviewable source at its root.
2. Publish an unprefixed release tag equal to manifest.version and attach main.js, manifest.json and styles.css individually.
3. Sign in to https://community.obsidian.md with the author's Obsidian account and link GitHub. This account-linking step may require the owner to interact.
4. Submit the repository through the Community dashboard, verify ID uniqueness there and resolve its automated review feedback.
5. Only claim in-app availability when the directory confirms the entry is published and installable.

Current submission route: https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin . Do not publish the mixed repository or copy its history into the standalone repository.
