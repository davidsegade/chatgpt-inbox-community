# ChatGPT Inbox Community

Create new Markdown notes in your current Obsidian vault from ChatGPT or another compatible MCP client. Choose which folders may receive notes, and check delivery receipts instead of assuming a queued note has arrived.

An independent MIT-licensed project by David Segade. It is not an official Obsidian or OpenAI product.

## Requirements and connection options

Obsidian 1.14.5 or later. The plugin is built for desktop and mobile, without Node.js or Electron dependencies in its installable bundle. **Obsidian must be open and active to receive notes**; iOS background delivery is not supported. The Mac does not need to be on when the receiving plugin is running on the iPhone.

| Mode | Requirements | Delivery |
| --- | --- | --- |
| Relay | A trusted HTTPS relay, and a ChatGPT account/client allowed to use custom MCP write tools | Queue and verified delivery receipts |
| Lite | An `obsidian://new` link opened by the user | One tap; no remote delivery receipt |
| Advanced GitHub | A repository and a fine-grained, read-only Contents token in Obsidian; a separate writer able to create requests in that repository | Receive JSON requests while Obsidian is active |

**No public relay is included or configured.** For Relay mode, use an operator you trust or host the included server yourself. Hosting and database services may cost money. Your ChatGPT plan, client and workspace policies determine whether custom MCP write tools are available; paying for a plan alone does not prove access. No OpenAI API key is required. [Custom MCP setup documentation](https://developers.openai.com/api/docs/guides/custom-mcp-server).

## Installation

The plugin is listed in the Obsidian Community directory. Search for **ChatGPT Inbox Community** in Community plugins, or open https://community.obsidian.md/plugins/chatgpt-inbox-community . It has not been manually reviewed by Obsidian staff.

For a candidate build, install it manually in a disposable test vault:

1. Download the individual `main.js`, `manifest.json` and `styles.css` assets from the GitHub release. Source archives alone are not installable assets.
2. Place them in `.obsidian/plugins/chatgpt-inbox-community/` in that vault (or the corresponding folder under its custom configuration directory).
3. Enable community plugins and **ChatGPT Inbox Community** in Obsidian settings.
4. Open **Configure step by step / Configurar paso a paso** in the plugin's settings. The current setup interface uses Spanish labels.

This plugin has its own ID and settings. It does not import credentials or replace another ChatGPT Inbox installation. On iPhone, install or sync the plugin files using your normal vault setup, then configure its secret on the iPhone itself. Copying `data.json` from another device does not transfer its secret.

## Connect a relay

An operator prepares the server once: see [relay setup](relay/README.md). Use a dedicated database and a relay privacy policy you can inspect.

1. In **Configurar paso a paso**, select the allowed folders in step 2. For a first test, authorize only `ChatGPT Inbox`, and use that as the default destination.
2. Return to step 1, choose **Relay beta**, and enter its HTTPS origin **without a path**, for example `https://relay.example`. Use a distinct secret identifier on each device.
3. Select **Obtener código**. The single-use pairing code is valid for five minutes. The device credential is stored locally in Obsidian SecretStorage.
4. In ChatGPT web, add or open your custom MCP connection. Its URL must be `https://relay.example/mcp`, with OAuth. Select **Connect / Conectar**, and paste the code only into the authorization page of the relay you selected, not into the chat. An existing connection such as `OB-ChatGPT` is just the name chosen by its owner; other users create their own connection.
5. Return to step 3 in Obsidian and select **Comprobar y activar**. Keep Obsidian open.
6. Select the connector in a ChatGPT conversation and ask it to list the folders, create a test note and check its receipt. If it is `queued`, open Obsidian and select **Recibir ahora**, then check again. Only `delivered` confirms a verified write.

The relay exposes `listar_carpetas`, `crear_nota` and `consultar_estado`. Notes are create-only; an existing unrelated file produces a conflict instead of being overwritten. Reusing the same retry key with the same content returns the same receipt. A revoked folder blocks the queued note until permission is restored or it expires.

## Authorization and mobile use

Access tokens last up to one hour. The 0.4.1 relay issues rotating refresh tokens so a compatible OAuth client can renew access without another pairing every hour. Each refresh credential can be used once; replay revokes that client grant. A connection expires after seven days without refreshing, after thirty days in total, or at the rotation safety limit. Revoking the device in Obsidian invalidates its access and refresh credentials immediately.

Connections created by an older relay do not gain a refresh token automatically: authorize once again after upgrading. Automatic renewal also depends on the client; it has been exercised through protocol tests, not by waiting for every supported ChatGPT app to renew on a real device. Registered OAuth clients are retained so reconnecting does not require creating a new ChatGPT connector.

Reception checks at most once per configured interval (minimum 60 seconds; default 120), while Obsidian is active. Open **Recibir ahora** for an immediate check. Vault synchronization is a separate service and is not supplied by this plugin.

## Lite and GitHub

Lite produces an `obsidian://new` link locally. Open the link deliberately; it does not provide a remote receipt. Anyone who sees the link can read its encoded content. Long links or title conflicts should be checked before use.

Advanced GitHub mode reads request JSON files using GET requests to the repository you configure. Obsidian uses a fine-grained Contents read-only token. A separate writer must create those requests: do not assume that a ChatGPT GitHub connection can write. The wizard supplies the required request format and allowed folders. Paths are relative to the vault, without its name. Do not put private content in a public repository.

## Data and privacy

Relay mode sends authorized folder names, connection activity and delivery states to the chosen operator. The new note's title and content pass through the relay. HTTPS protects transport; the operator can see the plaintext. Existing vault notes are not uploaded by the receiver. Identity lookup and content verification stay local and respect current folder permissions. Hidden/configuration paths are blocked.

Pending content expires after 24 hours and is removed from the active store at delivery, conflict or expiry. Receipts and retry keys last up to 48 hours from creation. Backups and infrastructure logs have a separate retention policy, supplied by the operator. Credentials use SecretStorage locally and hashes on the relay; note paths, deduplication hashes and the latest 100 history entries are stored locally. No ads, client telemetry, analytics, remote code loading or self-updater are included. See [privacy and permissions](PRIVACY.md).

## Status and development

Version 0.4.2 is listed in the Community directory; 0.4.3 is a correction candidate until its release and directory scan are verified. Directory listing does not imply manual approval. Desktop acceptance was performed on Obsidian 1.14.5. A user reported the configured iPhone flow working; the exact iOS/Obsidian version and the full physical-device acceptance matrix remain to be recorded. See [acceptance evidence](AUDIT.md) and the [submission checklist](COMMUNITY.md).

Build from source with Node.js 24:

```sh
npm ci
npm run verify
npm run package:community -- /absolute/new/staging-folder
```

`npm run test:postgres` additionally needs a new disposable local database and a restricted test role, as described in [relay setup](relay/README.md). Node.js is required for building and operating the separate relay, not for running the Obsidian plugin.

## License

[MIT](LICENSE).
