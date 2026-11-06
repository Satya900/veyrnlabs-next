import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("one login can belong to several businesses and acts only in the one it selects", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema public,auth to anon,authenticated,service_role;",
  );
  for (const file of (await readdir(new URL("../supabase/migrations/", import.meta.url)))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(await readFile(new URL("../supabase/migrations/" + file, import.meta.url), "utf8"));

  const ownerA = crypto.randomUUID(), agent = crypto.randomUUID(), outsider = crypto.randomUUID();
  for (const [id, email] of [[ownerA, "owner@a.test"], [agent, "agent@b.test"], [outsider, "x@c.test"]])
    await db.query("insert into auth.users values($1,$2,now())", [id, email]);
  // Simulates PostgREST: the login comes from the JWT, the chosen business from a header.
  const login = async (id = "", role = "authenticated", org = null) => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.query("select set_config('request.headers',$1,false)", [
      org ? JSON.stringify({ "x-crm-organization": org }) : "",
    ]);
    await db.exec(`set role ${role}`);
  };
  const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];

  await login("", "service_role");
  const orgA = (await one("select crm_provision_organization($1,'Agency A','Owner A') id", [ownerA])).id;
  const orgB = (await one("select crm_provision_organization($1,'Agency B','Agent') id", [agent])).id;
  const orgC = (await one("select crm_provision_organization($1,'Agency C','Outsider') id", [outsider])).id;
  // Agency A is on Pro Plus (3 included users), so there's a seat for the agent.
  await db.query("insert into crm_subscriptions(organization_id,plan,billing_months,active) values($1,'pro_plus',1,true)", [orgA]);
  // The agent's first membership keeps id = login id, as before this change.
  assert.equal((await one("select id from crm_members where user_id=$1", [agent])).id, agent);

  // Owner A invites the agent, who already owns Agency B.
  await login(ownerA);
  const token = createHash("sha256").update("invite-token").digest("hex");
  await db.query("select crm_create_invitation('agent@b.test','team',$1)", [token]);
  await login("", "service_role");
  assert.equal(
    (await one("select invited_by from crm_invitations where email='agent@b.test'")).invited_by,
    ownerA,
  );
  assert.equal(
    (await one("select crm_accept_invitation($1,$2,'Agent') org", [token, agent])).org,
    orgA,
  );
  // Accepting again is idempotent.
  assert.equal((await one("select crm_accept_invitation($1,$2,'Agent') org", [token, agent])).org, orgA);
  const memberships = (await db.query("select id,organization_id,role from crm_members where user_id=$1 order by joined_at", [agent])).rows;
  assert.equal(memberships.length, 2);
  const inA = memberships.find((m) => m.organization_id === orgA);
  assert.notEqual(inA.id, agent, "a second membership gets its own id");
  assert.equal(inA.role, "team");

  // Without a header the agent lands in their first business.
  await login(agent);
  assert.equal((await one("select crm_organization_id() org")).org, orgB);
  assert.equal((await one("select crm_role() r")).r, "owner");
  // Selecting Agency A switches identity, role and visible data.
  await login(agent, "authenticated", orgA);
  assert.equal((await one("select crm_organization_id() org")).org, orgA);
  assert.equal((await one("select crm_member_id() m")).m, inA.id);
  assert.equal((await one("select crm_role() r")).r, "team");
  const names = (await db.query("select name from crm_organizations")).rows.map((r) => r.name);
  assert.deepEqual(names, ["Agency A"]);
  // A team member can't invite in Agency A, even though they own Agency B.
  await assert.rejects(
    db.query("select crm_create_invitation('new@a.test','team',$1)", [createHash("sha256").update("t2").digest("hex")]),
    /Invitation unavailable/,
  );
  // Saved views belong to the membership in the business being used.
  await db.query("insert into crm_saved_views(member_id,name) values($1,'Mine')", [inA.id]);
  await assert.rejects(
    db.query("insert into crm_saved_views(member_id,name) values($1,'Other')", [agent]),
  );

  // A business the login doesn't belong to, or a malformed header, gives no access at all.
  for (const org of [orgC, "not-a-uuid"]) {
    await login(agent, "authenticated", org);
    assert.equal((await one("select crm_member_id() m")).m, null);
    assert.equal((await one("select crm_organization_id() org")).org, null);
    assert.equal((await db.query("select id from crm_organizations")).rows.length, 0);
  }

  // Removing the agent from Agency A leaves their own business untouched.
  await login(ownerA);
  await db.query("select crm_remove_member($1)", [inA.id]);
  await login("", "service_role");
  assert.deepEqual(
    (await db.query("select organization_id from crm_members where user_id=$1", [agent])).rows.map((r) => r.organization_id),
    [orgB],
  );
});
