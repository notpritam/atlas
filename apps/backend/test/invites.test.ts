import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.ATLAS_DATA_DIR = mkdtempSync(join(tmpdir(), "atlas-invite-test-"));

const { openDb } = await import("../src/db.ts");
const { mintInvite, redeemInvite } = await import("../src/invites.ts");
const { resolveRelayToken } = await import("../src/relay.ts");

const db = openDb();

test("redeem: valid code → a working relay token; single-use decrements", () => {
  const { code } = mintInvite(db, { scopes: ["relay", "read"], uses: 1 });
  const r = redeemInvite(db, code, "alice");
  expect(r).not.toBeNull();
  expect(r!.scopes).toContain("relay");
  // the minted token is a valid relay token for its own account
  expect(resolveRelayToken(db, r!.token)?.accountId).toBe(r!.accountId);
  // spent now
  expect(redeemInvite(db, code)).toBeNull();
});

test("redeem: multi-use code works N times then stops", () => {
  const { code } = mintInvite(db, { scopes: ["relay"], uses: 2 });
  expect(redeemInvite(db, code)).not.toBeNull();
  expect(redeemInvite(db, code)).not.toBeNull();
  expect(redeemInvite(db, code)).toBeNull();
});

test("redeem: invalid code → null", () => {
  expect(redeemInvite(db, "not-a-real-code")).toBeNull();
  expect(redeemInvite(db, "")).toBeNull();
});
