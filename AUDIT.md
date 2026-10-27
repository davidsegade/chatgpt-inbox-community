# Acceptance evidence — 27 October 2026

Candidate: ChatGPT Inbox Community 0.4.1. This document distinguishes automated tests, protocol checks, native application evidence and user reports. A successful SDK call is not treated as proof of a physical-device workflow.

## Current automated evidence

The general suite covers the compiled plugin, setup UI contracts, safe paths and folders, identities, deduplication, conflicts, OAuth/PKCE, browser form policies, access/refresh rotation, scope/resource/client binding, replay revocation, expiry, old snapshots, durable failures, startup contention and safe shutdown. TypeScript and the browser bundle are checked separately by `npm run verify`.

The PostgreSQL 18.4 suite uses a new loopback-only database and a restricted runtime role. It exercises actual relay processes and SQL: initial lease contention recovering in the same process, SIGTERM releasing the lease, SIGKILL restarts, persisted refresh rotation, failed rotations rolling back, queued jobs and receipts surviving restarts, permission failures, revocation, retention and terminated database connections. No hosted database is used by these tests.

Packaging checks manifest/package/lock version consistency and rejects Node/Electron dependencies in the installable browser bundle. The staged source is allowlisted and contains no vault, credentials, local data.json or Git history.

## Application evidence carried from 0.4.0

Native desktop acceptance on Obsidian 1.14.5 used a disposable vault. It covered plugin loading, setup navigation, exact Unicode note creation, local relay delivery and verified receipts, retry idempotence, conflict preservation, opening a history note and revocation. It did not establish compatibility on every earlier Obsidian version; 0.4.1 therefore declares 1.14.5 as its minimum.

The HTTPS beta at commit f47dbd775e3800c85246d24b057c41f6628aafb7 passed a real browser form with an external callback, state/issuer checks, no cross-origin Referer, PKCE exchange, MCP SDK discovery/tool calls, synthetic queue/receipt and device revocation. The original `Origin rejected` and subsequent form-CSP redirect rejection were both reproduced before correction. This did not involve an actual private vault.

After configuration instructions for OB-ChatGPT and Obsidian iPhone, the owner reported «listo..funciona». This is useful user acceptance, not a separately recorded exact iOS/Obsidian version, build hash, or full mobile regression matrix.

## Limits and remaining verification

- The physical iPhone matrix still needs exact app/OS versions, candidate hash, suspension/resume, offline/reconnect, conflict, permission removal, revocation and two-device checks.
- Rotating refresh has automated and PostgreSQL evidence. Existing ChatGPT connections need a new consent to receive a refresh token; natural refresh after an hour has not been observed across every client.
- A hosted relay operator must verify TLS, logging, backup retention/deletion, database lifetime, limits and deployment strategy. Local tests do not certify those policies.
- Initial lease contention retries automatically; it is not multi-writer support or a guarantee of zero-downtime rolling deployments. A lost leased session after loading stays fail-closed until restart.
- Obsidian directory acceptance and availability are separate from a GitHub source repository/release.

## Standards and publication references

- OAuth refresh protection: https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14
- ChatGPT OAuth client persistence: https://developers.openai.com/plugins/build/auth
- Obsidian publication: https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin
- Obsidian requirements: https://docs.obsidian.md/community-directory/submission-requirements-for-plugins
