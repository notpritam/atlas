#!/usr/bin/env bun
import type { Scope } from "@atlas/shared";
import { openDb } from "../src/db.ts";
import { listDevices, mintDevice, revokeDevice } from "../src/devices.ts";

const VALID_SCOPES: Scope[] = ["ingest", "read", "enrich", "relay"];

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

function usage(): never {
  console.log(`atlas — admin CLI

Usage:
  bun run bin/atlas.ts devices add "<name>" --scope ingest[,read,enrich,relay] [--kind extension]
  bun run bin/atlas.ts devices list
  bun run bin/atlas.ts devices revoke <deviceId>

  # hosted browser-control relay account token (used by BOTH the extension and the agent):
  bun run bin/atlas.ts devices add "<account>" --scope relay --kind relay

  # self-serve onboarding — mint an invite code users redeem at /redeem:
  bun run bin/atlas.ts invite add [--uses 1] [--scope relay,read,ingest] [--note "..."]
  bun run bin/atlas.ts invite list

Scopes: ingest (extension), read (plugin/web), enrich (bb worker), relay (hosted browser control)`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const [group, cmd, ...rest] = argv;

if (group !== "devices" && group !== "invite") usage();

const db = openDb();

if (group === "invite") {
  const { mintInvite, listInvites } = await import("../src/invites.ts");
  if (cmd === "add") {
    const scopes = (flag(rest, "scope") ?? "relay,read,ingest")
      .split(",").map((s) => s.trim())
      .filter((s): s is Scope => VALID_SCOPES.includes(s as Scope));
    const uses = Number(flag(rest, "uses") ?? "1");
    const { id, code } = mintInvite(db, { scopes, uses, note: flag(rest, "note") });
    console.log(`\n  Invite created: ${id}`);
    console.log(`  scopes : ${scopes.join(", ")}   uses: ${uses}`);
    console.log(`\n  CODE (share it — redeem at https://atlas.notpritam.in/redeem):\n`);
    console.log(`    ${code}\n`);
  } else if (cmd === "list") {
    const invites = listInvites(db);
    if (!invites.length) console.log("(no invites)");
    for (const i of invites) {
      const state = i.revoked_at ? "REVOKED" : `${i.uses_left} left`;
      console.log(`  ${i.id}  [${state}]  redeemed ${i.redeemed_count}  (${(JSON.parse(i.scopes) as string[]).join(",")})  ${i.note ?? ""}`);
    }
  } else usage();
  process.exit(0);
}

if (cmd === "add") {
  const name = rest.find((a) => !a.startsWith("--"));
  if (!name) usage();
  const scopes = (flag(rest, "scope") ?? "ingest")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is Scope => VALID_SCOPES.includes(s as Scope));
  if (!scopes.length) {
    console.error(`No valid scopes. Choose from: ${VALID_SCOPES.join(", ")}`);
    process.exit(1);
  }
  const kind = flag(rest, "kind") ?? "extension";
  const { id, token } = mintDevice(db, { name, kind, scopes });
  console.log(`\n  Device created: ${name}`);
  console.log(`  id     : ${id}`);
  console.log(`  scopes : ${scopes.join(", ")}`);
  console.log(`\n  TOKEN (shown once — copy it now):\n`);
  console.log(`    ${token}\n`);
} else if (cmd === "list") {
  const devices = listDevices(db);
  if (!devices.length) console.log("(no devices)");
  for (const d of devices) {
    const seen = d.lastSeenAt
      ? new Date(d.lastSeenAt).toISOString()
      : "never";
    const state = d.revokedAt ? "REVOKED" : "active";
    console.log(
      `  ${d.id}  [${state}]  ${d.name}  (${d.scopes.join(",")})  last seen ${seen}`,
    );
  }
} else if (cmd === "revoke") {
  const id = rest[0];
  if (!id) usage();
  console.log(revokeDevice(db, id) ? `Revoked ${id}` : `Not found: ${id}`);
} else {
  usage();
}
