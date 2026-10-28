# 0.4.3 — review correction candidate

- Validate JSON envelopes, relay replies, GitHub listings/blobs and saved settings/history from unknown inputs before use. Preserve valid settings, secrets by identifier, receipts and create-only delivery.
- Searchable declarative settings and public update API; no deprecated display override.
- History search traverses only authorized subtrees and rechecks scope before content reads. Folder selection still needs local metadata enumeration.
- Remove clipboard APIs; select generated instructions for native copy on macOS/iOS.
- Run the full Obsidian recommended lint preset and unsafe TypeScript checks in CI. TypeScript 6.0 is used because the current TypeScript ESLint parser supports versions below 6.1.
- Pin the development dependency override for patched moment; runtime plugin bundle remains browser-only.
- 122 automated tests, typecheck, build and lint passed locally. Physical iPhone acceptance of this candidate is pending. PostgreSQL verification is also run by CI.
- Add a draft-release workflow with build provenance attestations; attestations only exist after that workflow succeeds.

The official 0.4.2 scorecard showed 81 warnings and 6 other observations. Base64 decoding is required for GitHub blobs. Vault enumeration remains necessary for the explicit folder picker. Unavailable malware/obfuscation scans are scanner limitations, not results this repository can certify.

# ChatGPT Inbox Community 0.4.1

Create Markdown notes through a paired OAuth/PKCE MCP relay, Lite links or an advanced GitHub inbox. Obsidian must be active to receive. No public hosted relay is included.

## Changes

- Fix browser OAuth consent: keep same-origin Origin on form submissions, allow the validated callback origin through form CSP, and encode CSP delimiters in unusual URL hostnames.
- Add rotating refresh credentials, bound to the original client, resource and authorized scope. Reuse revokes the affected grant. Expiry is seven inactive days or thirty days from consent; an additional safety limit bounds rotation history.
- Preserve registered DCR client IDs across reconnects. Snapshots made by older relays still load; existing access tokens continue until expiry, but users must authorize again to receive refresh credentials.
- Retry initial PostgreSQL lease contention for up to two minutes. Pending/failed storage returns HTTP 503. Connection loss after loading remains terminal to prevent stale-snapshot writes.
- Drain active requests and release storage on SIGTERM/SIGINT. The relay remains single-writer; deployments may briefly return 503 during handover and do not promise zero downtime.
- Raise the declared minimum to Obsidian 1.14.5, the desktop version with native acceptance evidence. This does not certify every physical mobile scenario.
- Update setup, privacy, operator instructions and acceptance evidence.

## Existing behavior

Notes are create-only; folder permissions are checked on receipt, conflicts preserve existing files, retry keys avoid duplicates, and only `delivered` confirms a verified local write. The mobile bundle has no Node.js/Electron dependencies. Device secrets are not copied through `data.json`.

## Upgrade

Update the relay as well as the Obsidian plugin. Reauthorize the MCP client once to obtain refresh credentials. Use a distinct secret and pairing on each receiving device. A compatible client handles subsequent refreshes; exact client behavior and account permissions still apply.

The published plugin is independent of any existing private installation and uses the ID `chatgpt-inbox-community`. A general public relay service, hosted database policy and production service guarantee are not part of this release.
