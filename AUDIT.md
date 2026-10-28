# 0.4.3 candidate verification — 28 October 2026

The official Community entry and community-plugins.json identify `davidsegade/chatgpt-inbox-community`, ID `chatgpt-inbox-community`, current listed/released version 0.4.2. The working directory `/Users/davidsegade/ChatGPT-Inbox` instead has remote `obsidian-chatgpt-test`, version 0.4.0 and uncommitted work; it was read only and not changed. This candidate starts from the clean standalone Community repository at 6f39865effb932a182bc0dcdafe7ff407f31ba88.

The original 0.4.2 source rebuild matches its downloaded main.js byte for byte (SHA-256 851bf4f239456d6c08bf604f4b13c118253e83a340519723e873cd2733f096cc). Its baseline suite passes 115 tests. Local typed lint reproduces 75 unsafe errors in core.ts, main.ts and ui.ts. The official scorecard shows 81 warnings: those unsafe findings, two globalThis warnings, two settings refresh warnings, one declarative settings warning and one hardcoded configuration-directory warning. It also shows two missing-attestation observations, two deprecated display observations, vault enumeration and clipboard access. The three disclosures are runtime base64 decoding and unavailable malware/obfuscation scans. No suspicious network patterns or vulnerable dependencies were reported.

The candidate passes 122 compiled regression tests, typecheck, browser build and the full Obsidian recommended lint preset with zero warnings. The local preset retains unsafe TypeScript checks, recognizes product/acronym spelling, and delegates extensionless TypeScript import resolution to tsc/esbuild. New tests cover malformed envelopes/relay data/saved state, declarative settings contracts, authorized-only history traversal, permission revocation during GitHub folder creation and native text selection without clipboard APIs. Dependency audit reports zero vulnerabilities. A global moment override fixes the older nested development SDK dependency pulled in by the lint plugin.

The packager verifies consistent 0.4.3 metadata, individual main.js/manifest.json/styles.css assets and a bundle without Node/Electron imports. The release workflow prepares a draft and provenance attestations after a version tag is pushed; adding that workflow alone does not create an attestation or publish a release. CI also tests PostgreSQL with a disposable restricted-role database.

Vault enumeration is retained for the explicit folder picker. History recovery now walks only authorized subtrees, deduplicates overlapping roots and rechecks authorization before each content read. GitHub writes recheck current authorization after asynchronous folder creation. No existing note upload or broader permission is added.

Physical macOS/iPhone acceptance of the new declarative layout and native copy interaction is not claimed by these automated tests. The hosted Community scorecard must be checked again only after a release is published; the currently visible scorecard still describes 0.4.2.

---

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
