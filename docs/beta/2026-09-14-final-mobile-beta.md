# Final mobile production beta — 14 September 2026

In progress. Marketing version remains **1.0.0**. Live EAS counters were iOS 21 and Android 5; the only increments reserved **iOS 22** and **Android 6**. Apple independently confirmed iOS 21 as the previous valid TestFlight build. No public App Store/Play release or invitations are included.

Both build profiles use the production API `https://foundkeep.app`, channel `production-beta`, iOS `app.foundkeep.ios`, Android `app.foundkeep.android`, and `foundkeep` links. App Group and keychain sharing retain the existing production identity.

Build source: `e467366d65f968d55a3b170842aaa9f83aedbbc2`, plus the complimentary beta plan labels and an App Store verification correction, subsequently committed in `c2b04f4`. Complimentary access is explicitly labeled; an App Store purchase/restore is verified only by an actual active RevenueCat subscription. Complimentary, web-only, and expired subscriptions do not falsely verify a purchase. Existing paid subscription management still uses real subscription records.

Validation completed before signed compilation:

- All 101 mobile tests and mobile TypeScript checks passed. The two new purchase verification tests failed against the prior `plan.pro` behavior and passed after correction.
- All 23 native Swift share-loader cases passed on the Mac, including actual file representations, URL-first providers, mixed PNG/PDF/MP4 batches, policy and size limits.
- Frozen-lockfile installation passed after the staging workspace manifests were corrected. The first EAS attempts stopped at dependency installation before compiling or signing. Retries explicitly disable automatic increments and reuse 22/6.
- No physical iPhone was connected; both known iPhones were offline. The existing Android API 36 AVD is available for exact signed-APK checks.

Private evidence and artifact staging: `/home/pritam/.local/share/foundkeep-beta-artifacts/20260914-final`. Mac source trees are `/Users/notpritamm/Developer/foundkeep-final-ios-20260914` and `/Users/notpritamm/Developer/foundkeep-final-android-20260914`. Previous iOS 20/21 and Android 5 artifacts remain retained.

Signed artifact verification and TestFlight submission are pending. External TestFlight contact details (first/last name, email, phone) were absent in the live Apple record; no external review submission or invitation has been created.

## iOS signed artifact

- `1.0.0 (22)`, 23,839,608 bytes, SHA-256 `d68ab33eed93cd390d368be7c2778fed55460c1590fc94e7897bd942bc35eca7`.
- Mac artifact: `/Users/notpritamm/.local/share/foundkeep-builds/20260914-final-ios22/FoundKeep.ipa`.
- Runtime `dfad265e4c7502c74fc80e6b0f128c884f0de519`; production origin and `production-beta` channel verified inside the IPA.
- App and Share extension use build22, marketing1.0.0, canonical IDs, team `6HVH7CKN3M`, App Store profiles expiring2027-09-08, shared production groups, and `get-task-allow=false`. Both deep strict signature checks passed.
- The actual native build contains144 verified staged source files. All six generated Share extension inputs match their canonical sources, including the Files loader and environment queue scope. The generated iOS project verification passed.
- Upload to the existing App Store Connect app6809771188 is in progress. No physical TestFlight installation has been tested.
