import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("ownership transfer and member removal enforce roles, tenancy, and a single owner", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;`);
  const migrate = async (name) =>
    db.exec(
      await readFile(
        new URL(`../supabase/migrations/${name}.sql`, import.meta.url),
        "utf8",
      ),
    );
  for (const file of [
    "202609140001_crm",
    "202609150001_crm_saved_views",
    "202609150002_crm_capture_returns_inserted",
    "202609220001_crm_organizations",
    "202609240006_crm_member_lifecycle",
  ])
    await migrate(file);

  const ids = Object.fromEntries(
    [
      "ownerA",
      "adminA",
      "teamA",
      "teamA2",
      "ownerB",
      "adminB",
      "stranger",
      "selfLeaver",
    ].map((k) => [k, crypto.randomUUID()]),
  );
  for (const id of Object.values(ids))
    await db.query("insert into auth.users values($1)", [id]);
  const login = async (id = "", role = "authenticated") => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec(`set role ${role}`);
  };
  const provision = async (id, name) =>
    (
      await db.query("select crm_provision_organization($1,$2,$2) as id", [
        id,
        name,
      ])
    ).rows[0].id;
  await login("", "service_role");
  const orgA = await provision(ids.ownerA, "A");
  const orgB = await provision(ids.ownerB, "B");
  await db.query(
    "insert into crm_members(id,organization_id,name,role) values($1,$2,'Admin','admin'),($3,$2,'Agent','team'),($4,$2,'Agent 2','team')",
    [ids.adminA, orgA, ids.teamA, ids.teamA2],
  );
  await db.query(
    "insert into crm_members(id,organization_id,name,role) values($1,$2,'Admin B','admin')",
    [ids.adminB, orgB],
  );
  const roleOf = async (id) =>
    (await db.query("select role,organization_id from crm_members where id=$1", [id]))
      .rows[0];

  await t.test(
    "only the owner transfers ownership, never to self, and never leaves two owners",
    async () => {
      await login(ids.adminA);
      await assert.rejects(
        db.query("select crm_transfer_ownership($1)", [ids.teamA]),
        /current owner/,
      );
      await login(ids.ownerA);
      await assert.rejects(
        db.query("select crm_transfer_ownership($1)", [ids.ownerA]),
        /different member/,
      );
      await assert.rejects(
        db.query("select crm_transfer_ownership($1)", [ids.stranger]),
        /does not belong/,
      );
      await assert.rejects(
        db.query("select crm_transfer_ownership($1)", [ids.adminB]),
        /does not belong/,
      );
      await db.query("select crm_transfer_ownership($1)", [ids.adminA]);
      assert.deepEqual(await roleOf(ids.adminA), { role: "owner", organization_id: orgA });
      assert.deepEqual(await roleOf(ids.ownerA), { role: "admin", organization_id: orgA });
      assert.equal(
        (
          await db.query(
            "select count(*) from crm_members where organization_id=$1 and role='owner'",
            [orgA],
          )
        ).rows[0].count,
        1,
      );
      // Transfer back so later subtests use the original owner/admin ids.
      await login(ids.adminA);
      await db.query("select crm_transfer_ownership($1)", [ids.ownerA]);
    },
  );

  await t.test(
    "admins remove team members only; owners remove admins and team but not the owner",
    async () => {
      await login(ids.teamA);
      await assert.rejects(
        db.query("select crm_remove_member($1)", [ids.teamA2]),
        /Only owners and admins/,
      );
      await login(ids.adminA);
      await assert.rejects(
        db.query("select crm_remove_member($1)", [ids.ownerA]),
        /Transfer ownership/,
      );
      await assert.rejects(
        db.query("select crm_remove_member($1)", [ids.stranger]),
        /does not belong/,
      );
      await assert.rejects(
        db.query("select crm_remove_member($1)", [ids.adminB]),
        /does not belong/,
      );
      await db.query("select crm_remove_member($1)", [ids.teamA2]);
      assert.equal(
        (await db.query("select 1 from crm_members where id=$1", [ids.teamA2]))
          .rows.length,
        0,
      );
    },
  );

  await t.test(
    "removing an assigned member unassigns their leads and clients instead of blocking",
    async () => {
      await login(ids.ownerA);
      const stage = (
        await db.query(
          "select id from crm_stages where organization_id=$1 and kind='open' order by position limit 1",
          [orgA],
        )
      ).rows[0].id;
      const lead = (
        await db.query(
          "insert into crm_leads(name,stage_id,owner_id) values('Assigned',$1,$2) returning id",
          [stage, ids.teamA],
        )
      ).rows[0].id;
      await login("", "service_role");
      const client = (
        await db.query(
          "insert into crm_clients(organization_id,name,owner_id) values($1,'Assigned client',$2) returning id",
          [orgA, ids.teamA],
        )
      ).rows[0].id;
      await login(ids.ownerA);
      await db.query("select crm_remove_member($1)", [ids.teamA]);
      assert.equal(
        (await db.query("select owner_id from crm_leads where id=$1", [lead]))
          .rows[0].owner_id,
        null,
      );
      assert.equal(
        (await db.query("select owner_id from crm_clients where id=$1", [client]))
          .rows[0].owner_id,
        null,
      );
      assert.equal(
        (await db.query("select 1 from crm_members where id=$1", [ids.teamA]))
          .rows.length,
        0,
      );
    },
  );

  await t.test("a non-owner may remove their own membership", async () => {
    await login("", "service_role");
    await db.query(
      "insert into crm_members(id,organization_id,name,role) values($1,$2,'Leaver','team')",
      [ids.selfLeaver, orgA],
    );
    await login(ids.selfLeaver);
    await db.query("select crm_remove_member($1)", [ids.selfLeaver]);
    await login("", "service_role");
    assert.equal(
      (await db.query("select 1 from crm_members where id=$1", [ids.selfLeaver]))
        .rows.length,
      0,
    );
  });

  await t.test("neither function is reachable by anon or unauthenticated callers", async () => {
    await login("", "anon");
    await assert.rejects(db.query("select crm_transfer_ownership($1)", [ids.adminA]));
    await assert.rejects(db.query("select crm_remove_member($1)", [ids.adminA]));
  });
});
