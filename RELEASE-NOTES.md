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
