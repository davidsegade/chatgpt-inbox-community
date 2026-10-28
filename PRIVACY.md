# Privacy and permissions

ChatGPT Inbox Community is an independent, open source MIT plugin. It is not an official
Obsidian or OpenAI product. No ads, analytics, client telemetry, remote code
loading or self-updater are included. No OpenAI API key is required.

## Relay mode

Reception is disabled by default. After choosing a trusted HTTPS relay and
pairing, the plugin sends authorized folder names, default destination, polling
activity, job identifiers and delivery states to that relay. ChatGPT sends the
new note's title, destination, content and retry key. The operator can see this
data: transport encryption is not end-to-end encryption. No existing note
contents are uploaded by the plugin; verification and identity lookup are local.
Only the current vault is used; hidden/configuration paths are rejected.

Pending content lasts up to 24 hours and is removed on delivery/conflict or expiry.
Receipts and retry keys last up to 48 hours from creation. Paired devices expire
after 7 inactive days; an unconnected pairing expires after 1 hour, its code after 5 minutes.
OAuth access tokens last up to 1 hour. Rotating refresh credentials allow renewal
for up to 30 days from consent, with a 7-day inactivity limit and a bounded
rotation history. Reusing a spent refresh credential revokes that client grant.
OAuth client registration metadata (client IDs and allowed redirect URIs) is
retained until the operator removes it, so an existing connector can reauthorize.
The server caps registrations at 1,000. It stores only hashes of access and
refresh credentials, not the raw secrets. Re-pairing
revokes the old device first. Revocation removes that device's retained state from
the active store. Backups and operator access logs have separate retention: the
operator must disclose their policy before offering a public service. Configure
a dedicated database and disable body, query-string and credential logging.

The code includes no server analytics, but hosting providers can observe IPs and
connection metadata. No public relay is bundled or configured. An operator must
supply a privacy policy covering hosting, backups, jurisdiction, deletion and
contact details before operating a public service. Hosting may cost money.

## GitHub mode

Uses only GET requests to api.github.com for the repository chosen by the user.
Requires a GitHub account and fine-grained read-only Contents token. Requests are
stored in that repository and possibly its Git history until its owner removes
them. GitHub's own policies apply. Never put private notes in a public repository.

## Lite mode

Generates an obsidian://new link locally. It has no remote receipt or plugin folder
enforcement. Anyone who receives the link can read its encoded note content.
The place where a user shares it may retain it. It requires a deliberate tap.

## Local state and mobile

Credentials use Obsidian SecretStorage; data.json stores settings, folder paths,
hashes and the last 100 history entries, without note content or raw tokens.
External synchronization can copy these settings. Use separate secrets and pair
on each device. The deduplication ledger has no automatic pruning. Identity
markers added to notes allow local recovery after stale settings or a move.
Opening a history note can scan Markdown files locally to locate that identity.
Obsidian must be open and active to receive. Sync to another device is independent.

The public plugin ID is chatgpt-inbox-community, separate from the private
chatgpt-inbox plugin. Its settings are loaded from its own plugin directory;
no private settings or credentials are imported automatically.

## Scope and clipboard correction in 0.4.3

The folder picker enumerates local file/folder metadata to let the user choose a destination. It does not read note content or send the listing to the relay. History lookup traverses only authorized folder subtrees (the whole vault only when explicitly authorized), skips configuration paths, and checks authorization again before each content read. The picker capability disclosure is therefore expected.

The plugin no longer uses clipboard APIs. “Seleccionar para copiar” selects the generated instruction in a local text area; the user copies it through the operating system menu on desktop or mobile. Clipboard contents are never read.

## Reliability candidate 0.4.4

A connection test creates a synthetic note only after the user explicitly selects its button, with reception enabled and the default folder currently authorized. A retry key, path, receipt state and relay/secret identifiers are stored locally so interruption can recover the same request. No existing note is sent to the relay. The server applies the device's current folder scope, queue/byte/rate limits, normal retention and durable save behavior to test requests as well.

Diagnostics are generated from an explicit allowlist: version numbers, transport/state, check timestamps and counts. They exclude note content, paths, folder/vault names, server/repository addresses, request IDs, pairing codes and credentials. A report remains local unless the user chooses to share it through the operating system. No clipboard API or automatic upload is added.
