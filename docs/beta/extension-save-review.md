# Detailed extension save review

FoundKeep Dev 1.7.10 brings the mobile share sheet's organization controls into the extension sidebar. Every capture that uses the save review can include an edited title, a personal note, a folder, and personal tags before confirmation. The original captured text and source metadata remain separate from the annotation.

## Saving and sharing

- Choose a private account save, a collection, or a browser-only save.
- Pick an existing folder or create a top-level folder inline. Creating a folder happens immediately; cancelling the later save leaves that folder in the account.
- Choose suggested tags or type custom tags. Enter, comma, the Add button, and Save all commit pending tag input. Personal saves allow 20 tags; collection entries allow 10. Each tag allows 40 characters, with normalized, case-insensitive deduplication.
- Collection title, link, text, tags, and optional image are explicit shared fields. The personal note, folder, and personal tags remain on the private account copy.
- Browser-only saves retain their title, note, and tags locally. Folders require an account. The existing upload queue carries those fields when a local copy is imported or an account save syncs.

Review edits are stored in `chrome.storage.session`, bound to the original browser window and connected account. They survive sidebar reloads within the existing 30-minute review lifetime, but are not permanent drafts across browser restarts. Failed saves retain the form for retry. Account changes, deleted folders, changed collection visibility, and replayed confirmations are checked again in the background.

The sheet uses the existing light/dark theme tokens, rounded surfaces, a scrollable form, and a fixed action area. Its tag picker and validation are shared between the personal and collection fields.

## Verification

- `bun run test:extension`: 82 tests passed, covering draft restoration, custom fields, tag bounds, retry behavior, cloud upload, collection privacy, and narrow light/dark layouts.
- Built 1.7.10 native Chrome sidebar checks: `tests/extension-action.mjs` and `tests/extension-destination.mjs` passed.
- `tests/next-extension-autoconnect.mjs` passed against the real dev app with temporary accounts, including custom title/folder/tags and private/shared field separation.
- `tests/next-twitter-preservation.mjs` passed against dev during this change, including inline folder creation, title/note/tags, original tweet retention, and real server media preservation/playback. Its X DOM is a controlled fixture; source file downloads and dev APIs are real.
- The public 1.7.10 ZIP was downloaded and matched the built artifact byte for byte. Dev services remained active; tests removed only their own temporary accounts.

## Dev package

[Download FoundKeep Dev 1.7.10](https://dev.foundkeep.app/ext/foundkeep-extension-dev-1.7.10.zip).

SHA-256: `7d559cb2b92ec76d31a00f7dd90191838951ddb75589d4d12f63e9111062324a`.

Static release: `/home/pritam/.local/share/foundkeep-dev-web/releases/20260914-detailed-save-1.7.10`. The generic dev ZIP aliases point to the same package. Dev extension identity remains `fngoidplpdpoamenhgpabbheghpkdkcb`, with `https://dev.foundkeep.app` as its fixed account endpoint. Replace the files in the existing unpacked dev extension directory and reload it at `chrome://extensions`; do not remove the installed extension or its local data.

The prior static release `20260914-detailed-save-1.7.9` is retained for an atomic symlink rollback, along with the preceding 1.7.8 release. No website/backend release or production deployment was changed for this update.
