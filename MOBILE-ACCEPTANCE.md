# Reliability acceptance — 0.4.4 candidate

## Automated evidence

Compiled plugin and relay tests cover offline → online recovery, focus-event throttling, bounded transient backoff, request timeout, immediate cancellation on backgrounding, late responses, transport changes in flight, permission changes, receipt-response loss, retry after restart with the same key, no duplicate create, deleted confirmed notes, two device credentials, queue limits, scope revocation and durable failed writes. PostgreSQL CI additionally checks the test key and terminal receipt across SIGKILL and restricted-role save failures.

These tests model lifecycle events; they are not evidence of physical iPhone execution.

## Native desktop evidence

Obsidian 1.14.5, disposable vault, loopback-only relay, synthetic notes and a disposable OAuth/MCP client. The wizard obtained a code through Obsidian SecretStorage, checked authorization/destination and activated reception. The actual MCP client observed its queued note become delivered after the native plugin wrote it. The new test button created a second synthetic note and reported a confirmed relay receipt after local verification. The diagnostic panel showed versions, connection/check state and aggregate counts without addresses, paths, note contents, pairing codes or credentials. No private vault or production service was used.

## Physical iPhone acceptance — pending

| Scenario | Required evidence | Status |
|---|---|---|
| Initial setup | Exact iOS/Obsidian versions and candidate asset hash; pairing, allowed destination and real client note receipt | Pending physical device |
| Suspend/resume | Queue a note while backgrounded; resume Obsidian; verify one note and its delivered receipt | Pending physical device |
| Offline/reconnect | Interrupted network followed by reconnect, correct status and retry without duplication | Pending physical device |
| Conflict | Existing unrelated note is preserved; conflict is shown and remotely acknowledged | Pending physical device |
| Permission removal | Revoked destination is not read or written; restoring it resumes only the authorized request | Pending physical device |
| Two devices | Sync a disposable vault; each device uses its own secret; one logical note and trustworthy receipts | Pending physical device |
| Long-lived authorization | Observe actual client refresh/reconnect across expiry; no promise based only on an SDK test | Pending physical device |
| UI | Wizard, inbox, optional report selection and accessibility at supported text sizes | Pending physical device |

There is no claim of iOS background delivery. Physical-device rows remain pending until observed; automated/desktop success does not complete them.
