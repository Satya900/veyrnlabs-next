import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  accountFields,
  requirePasswordLength,
  signupFields,
} from "../src/lib/crm/account-validation.ts";

test("signup validates identity fields and ignores client-supplied privileges", () => {
  const valid = {
    email: " USER@example.com ",
    name: " User ",
    organization: " Agency ",
    password: "a long password here",
    role: "owner",
    organization_id: crypto.randomUUID(),
  };
  assert.deepEqual(signupFields(valid), {
    email: "user@example.com",
    name: "User",
    organization: "Agency",
    password: valid.password,
    invitation: "",
  });
  assert.throws(() => signupFields({ ...valid, password: "short" }));
  assert.throws(() => signupFields({ ...valid, organization: "" }));
  assert.throws(() => signupFields({ ...valid, invitation: "bad" }));
  assert.throws(() => accountFields({ email: "not-email" }));
  assert.equal(
    signupFields({ ...valid, organization: "", invitation: "a".repeat(64) })
      .invitation.length,
    64,
  );
});

test("requirePasswordLength enforces the same 12-128 boundary used at signup", () => {
  assert.throws(() => requirePasswordLength("a".repeat(11)));
  assert.throws(() => requirePasswordLength("a".repeat(129)));
  requirePasswordLength("a".repeat(12));
  requirePasswordLength("a".repeat(128));
});

test("verified invitations enforce tenant, email, role, expiry and replay boundaries", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;`);
  for (const file of [
    "202609140001_crm",
    "202609150001_crm_saved_views",
    "202609150002_crm_capture_returns_inserted",
    "202609220001_crm_organizations",
    "202609230001_crm_invitations",
  ])
    await db.exec(
      await readFile(
        new URL(`../supabase/migrations/${file}.sql`, import.meta.url),
        "utf8",
      ),
    );
  const ids = Object.fromEntries(
    [
      "ownerA",
      "ownerB",
      "adminA",
      "teamA",
      "new",
      "wrong",
      "unverified",
      "expired",
      "revoked",
      "demoted",
    ].map((k) => [k, crypto.randomUUID()]),
  );
  for (const [name, id] of Object.entries(ids))
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,$2,$3)",
      [
        id,
        `${name.toLowerCase()}@example.com`,
        name === "unverified" ? null : new Date().toISOString(),
      ],
    );
  const login = async (id = "", role = "authenticated") => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec(`set role ${role}`);
  };
  await login("", "service_role");
  const provision = async (id, name) =>
    (
      await db.query("select crm_provision_organization($1,$2,$2) as id", [
        id,
        name,
      ])
    ).rows[0].id;
  const orgA = await provision(ids.ownerA, "A");
  const orgB = await provision(ids.ownerB, "B");
  await db.query(
    "insert into crm_members(id,organization_id,name,role) values($1,$2,'Admin','admin'),($3,$2,'Agent','team')",
    [ids.adminA, orgA, ids.teamA],
  );
  const hash = () => createHash("sha256").update(randomBytes(32)).digest("hex");
  const invite = async (email, role = "team") => {
    const token = hash();
    const { rows } = await db.query(
      "select crm_create_invitation($1,$2,$3) as id",
      [email, role, token],
    );
    return { token, id: rows[0].id };
  };
  const accept = async (item, user) =>
    db.query("select crm_accept_invitation($1,$2,'New member') as org", [
      item.token,
      user,
    ]);
  await t.test(
    "only permitted managers create links, without exposing token hashes",
    async () => {
      await login(ids.teamA);
      await assert.rejects(invite("new@example.com"));
      await login(ids.adminA);
      await assert.rejects(invite("new@example.com", "admin"));
      await login(ids.ownerA);
      await assert.rejects(invite("new@example.com", "owner"));
      await assert.rejects(db.query("select token_hash from crm_invitations"));
      await assert.rejects(
        db.query(
          "insert into crm_invitations(email) values('bad@example.com')",
        ),
      );
    },
  );
  await login(ids.ownerA);
  const invitation = await invite("new@example.com", "admin");
  await t.test(
    "wrong email and direct authenticated acceptance fail",
    async () => {
      await login(ids.new);
      await assert.rejects(accept(invitation, ids.new));
      await login("", "service_role");
      await assert.rejects(
        accept(invitation, ids.wrong),
        /Invitation unavailable/,
      );
      assert.equal(
        (await db.query("select * from crm_members where id=$1", [ids.wrong]))
          .rows.length,
        0,
      );
    },
  );
  await t.test(
    "verified matching email joins once with the intended role",
    async () => {
      await login("", "service_role");
      assert.equal((await accept(invitation, ids.new)).rows[0].org, orgA);
      assert.equal((await accept(invitation, ids.new)).rows[0].org, orgA);
      assert.equal(
        (await db.query("select role from crm_members where id=$1", [ids.new]))
          .rows[0].role,
        "admin",
      );
      await login(ids.new);
      assert.ok(
        (await db.query("select organization_id from crm_members")).rows.every(
          (r) => r.organization_id === orgA,
        ),
      );
    },
  );
  await t.test(
    "users cannot join a second business or elevate an existing membership",
    async () => {
      await login(ids.ownerB);
      const other = await invite("new@example.com");
      await login("", "service_role");
      await assert.rejects(accept(other, ids.new), /another business/);
      await login(ids.ownerA);
      const elevate = await invite("teama@example.com", "admin");
      await login("", "service_role");
      await accept(elevate, ids.teamA);
      assert.equal(
        (
          await db.query("select role from crm_members where id=$1", [
            ids.teamA,
          ])
        ).rows[0].role,
        "team",
      );
    },
  );
  await t.test(
    "expiry, revocation, replacement, and email confirmation are enforced",
    async () => {
      await login(ids.ownerA);
      const expired = await invite("expired@example.com");
      const revoked = await invite("revoked@example.com");
      const unverified = await invite("unverified@example.com");
      const replaced = await invite("wrong@example.com");
      await invite("wrong@example.com");
      await db.query("select crm_revoke_invitation($1)", [revoked.id]);
      await login("", "service_role");
      await db.query(
        "update crm_invitations set expires_at=now()-interval '1 second' where id=$1",
        [expired.id],
      );
      await assert.rejects(accept(expired, ids.expired));
      await assert.rejects(accept(revoked, ids.revoked));
      await assert.rejects(accept(replaced, ids.wrong));
      await assert.rejects(
        accept(unverified, ids.unverified),
        /Verified email/,
      );
    },
  );
  await t.test(
    "removed inviter authority invalidates outstanding invites",
    async () => {
      await login(ids.adminA);
      const pending = await invite("demoted@example.com");
      await login("", "service_role");
      await db.query("update crm_members set role='team' where id=$1", [
        ids.adminA,
      ]);
      await assert.rejects(accept(pending, ids.demoted));
    },
  );
  await t.test(
    "invitation listings and revocations are scoped to the business",
    async () => {
      await login(ids.ownerA);
      const pending = await invite("expired@example.com");
      await login(ids.ownerB);
      assert.ok(
        (
          await db.query("select organization_id from crm_invitations")
        ).rows.every((r) => r.organization_id === orgB),
      );
      await db.query("select crm_revoke_invitation($1)", [pending.id]);
      await login("", "service_role");
      assert.equal(
        (
          await db.query("select revoked_at from crm_invitations where id=$1", [
            pending.id,
          ])
        ).rows[0].revoked_at,
        null,
      );
      await login("", "anon");
      await assert.rejects(invite("wrong@example.com"));
      await assert.rejects(db.query("select id from crm_invitations"));
    },
  );
});
