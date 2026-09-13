# Foundkeep extension configuration and updates

Foundkeep uses two update paths with a strict boundary between account data and executable extension code.

## Live account controls

The dashboard stores one validated preferences document per account. Connected extensions read it over authenticated HTTPS, cache it for at most five minutes, and retain the last valid copy when offline. Saving settings from a dashboard that can detect the extension triggers an immediate revision-checked refresh.

| Area | Live controls |
| --- | --- |
| Capture methods | Page, highlight, region, full page, image, X post, note |
| Bookmark copy | Readable text, extended metadata, heading outline |
| Notes | Attach the open page as the note source |
| Popup | Secondary action order, recent section, recent item count |
| Sync | Automatic cloud upload |
| Automatic context | OCR, summaries, tags |
| Feedback | Success badge |
| Browser menus | Right-click actions |

These 20 values change extension behavior without repackaging or waiting for a store release. The server validates the exact schema before saving it. The extension validates it again before applying it. A bad response falls back to the last valid cache or built-in defaults.

## Operator controls

Foundkeep also publishes a strictly validated data-only policy at `/extension-policy.json`. It can disable any capture method, automatic sync, or browser context menus globally, and can lower the packaged limits for article text, selected text, images, full-page pixels, and full-page height. It cannot enable a feature the customer disabled, raise a packaged safety ceiling, add permissions, change network destinations, or execute code.

The extension uses a valid cached policy immediately and refreshes it every minute. On a cold or offline start it applies the bundled safe policy without delaying a local save, then refreshes in the background. Change the policy's `revision` whenever publishing a new document so an older response can never replace a newer cached revision.

## Changes that require a store release

The following are executable or privileged extension behavior and therefore ship only through a new reviewed package:

- JavaScript, HTML, CSS, or packaged assets
- Manifest permissions, host access, keyboard commands, content scripts, and externally connectable origins
- Capture algorithms, extraction fields, storage schema, encryption or authentication behavior
- New browser APIs or new kinds of network access
- The fixed Foundkeep API origin

Manifest V3 and Chrome Web Store policy prohibit using remotely hosted JavaScript or an arbitrary over-the-air code loader. Foundkeep intentionally fetches JSON account configuration only. Store updates are automatic after Google approves a new version, so customers normally do not need to update the extension by hand.

The manual self-hosted build has its own signed update channel and version history. The Chrome Web Store channel starts at `1.0.0` and omits the self-hosting `key` and `update_url` fields because Google owns signing, identity, and updates for that channel.

## Separate development and production

`bun run extension:build:dev` creates **Foundkeep Dev**, ID `fngoidplpdpoamenhgpabbheghpkdkcb`, targeting only `https://dev.foundkeep.app`. Its fixed public key is tracked in `deploy/extension-dev-identity.json`; never regenerate it for an update. It is an unpacked development build with no signed update feed. The public key fixes its browser identity; no private signing key is included or needed for loading unpacked.

`bun run extension:build:prod` creates the production manual build, preserving ID `mjfcgmboaijfcaanepdipbgmipnccnpn`, the existing database name, and the signed production update URL. The separate Web Store packaging command remains `bun run store:pack`. Both packaging paths read `deploy/extension-files.json` so they contain the same application modules.

The separate IDs isolate Chrome storage, credentials, offline queues, and IndexedDB even in one browser profile. Development also uses database name `atlas-dev`; production keeps `atlas` so updates retain existing captures. Capture uploads, policies, preferences, pairing, library requests, and dashboard links all follow the packaged origin. There is no runtime environment switch or automatic data migration.

For dev deployment, create a new static asset release under `/home/pritam/.local/share/foundkeep-dev-web/releases`. Copy `apps/web` into it, overwrite `customer-config.json` with the generated dev config, place the dev ZIP at `ext/foundkeep-extension-dev.zip`, and replace both generic extension ZIP aliases with that dev ZIP. Remove copied production CRXs and update manifests from this dev release. Atomically set `/home/pritam/.local/share/foundkeep-dev-web/current` to the new release.

The dev backend service uses:

```ini
Environment=ATLAS_WEB_DIR=/home/pritam/.local/share/foundkeep-dev-web/current
Environment=ATLAS_CUSTOMER_EXTENSION_IDS=fngoidplpdpoamenhgpabbheghpkdkcb
```

An explicit `ATLAS_CUSTOMER_EXTENSION_IDS` is a complete allowlist, replacing production defaults. Keep `ATLAS_DATA_DIR=/home/pritam/.local/share/foundkeep-dev` and `ATLAS_CUSTOMER_ORIGINS=https://dev.foundkeep.app`. Restart only the dev backend for these settings, then deploy the customer site following `deploy/NEXT_WEB.md`. Production retains its separate `/home/pritam/.local/share/atlas` database and its existing extension IDs.

Verify `/customer-config.json`, `/extension-policy.json`, `/ext/foundkeep-extension-dev.zip`, and the dev Apps & devices installation flow. `tests/extension-environments-browser.mjs` loads both real MV3 builds in one temporary profile against two disposable databases, verifies pairing, local/cloud isolation, cross-environment token rejection, and offline dev saves while production continues syncing. Never use existing customer databases for this test.
