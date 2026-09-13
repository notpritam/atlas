# Populated development environment

The permanent test site is [dev.foundkeep.app](https://dev.foundkeep.app). Run `bun run dev:seed` from the repository root to add missing demo fixtures. The script verifies the dev environment marker and uses two dedicated demo accounts. It preserves existing customers, data, authentication, and Paddle sandbox configuration. Production is never a seed target.

| Collection | What to test |
| --- | --- |
| [The agent toolkit](https://dev.foundkeep.app/collection/demo-agent-toolkit) | Six public finds about agents, tools, and reusable skills. Signed-in visitors can suggest finds; the curator must approve them. One demo suggestion starts in the private approval queue. |
| [Design that works](https://dev.foundkeep.app/collection/demo-design-that-works) | Eight image, note, design and accessibility finds; curator-only contributions. |
| [Worth a slower read](https://dev.foundkeep.app/collection/demo-worth-reading) | Seven essays, original notes and image finds; signed-in visitors can contribute directly. |
| Private demo scratchpad | One private entry, accessible from the demo curator’s dashboard; anonymous visitors receive 404. |

The curator’s personal library includes three starter notes, the original demo images, and nine connected agent references for the mind map. The contributor follows the three public collections and owns the pending suggestion. Descriptions identify demo content, annotations are original, and links point to original publishers. These are fixture accounts, not popularity claims. Browse publicly or use your own dev account to follow and contribute.

## Demo accounts and reruns

The curator is `curator@demo.foundkeep.invalid`; the contributor is `contributor@demo.foundkeep.invalid`. Generated passwords and recovery codes are stored only on the host in `~/.local/share/foundkeep-dev-demo/state.json` (0600 inside a 0700 directory). Open that file privately when you need to test moderation or the private library. Never commit it or include it in web releases, screenshots, or logs. The nearby `report.json` contains public URLs and the private dashboard path.

Keep the state directory: it records account identities and fixtures already created. Reruns preserve tester edits, entry moves/deletions, removed collections, moderation decisions, and unfollows. This command adds missing fixtures; it does not reset them. Invalid credentials stop the operation instead of taking over an account. Directory overrides must remain outside the repository, including symlink aliases and parent traversal paths. The script logs out only the sessions it created.

Fixtures do not grant Pro, create billing events, or enable processing. Use existing sandbox checkout for paid-feature testing. Group permissions have a separate disposable-backend browser test with an explicit test entitlement.

## Local verification

Use a disposable backend and a site built against it. Local seed mode accepts only loopback site ports 18000–19999 and a state directory under `/tmp/foundkeep-collections…`.

```sh
node scripts/seed-dev.mjs --local-test --origin http://127.0.0.1:18791 --state-dir /tmp/foundkeep-collections-editorial-seed
node --test tests/dev-seed.mjs
FOUNDKEEP_WEB_TEST_URL=http://127.0.0.1:18791 FOUNDKEEP_DEMO_TEST_STATE=/tmp/foundkeep-collections-editorial-seed node --test tests/dev-seed-integration.mjs
FOUNDKEEP_WEB_TEST_URL=http://127.0.0.1:18791 node --test tests/next-public-collections.mjs tests/next-collections.mjs
```

The seed integration test deliberately renames the private fixture, removes its entry, declines the pending suggestion, and unfollows a collection, then checks that a rerun preserves those changes. It must not run against permanent dev.

Follow [NEXT_WEB.md](../deploy/NEXT_WEB.md) for web releases. Collection search requires the updated backend query handling but no schema migration. Keep a consistent database backup before first seeding; never reset the dev database.
