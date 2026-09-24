import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("organisation migration preserves internal data and isolates customer workspaces", async (t) => {
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
  await migrate("202609140001_crm");
  await migrate("202609150001_crm_saved_views");
  await migrate("202609150002_crm_capture_returns_inserted");
  const [internal, ownerA, ownerB, teamA, adminA, stranger] = Array.from(
    { length: 6 },
    () => crypto.randomUUID(),
  );
  for (const id of [internal, ownerA, ownerB, teamA, adminA, stranger])
    await db.query("insert into auth.users values($1)", [id]);
  await db.query(
    "insert into crm_members(id,name,role) values($1,'Internal owner','owner')",
    [internal],
  );
  const oldStage = (
    await db.query(
      "select id from crm_stages where kind='open' order by position limit 1",
    )
  ).rows[0].id;
  const oldLead = (
    await db.query(
      "insert into crm_leads(name,stage_id,owner_id) values('Historical',$1,$2) returning id",
      [oldStage, internal],
    )
  ).rows[0].id;
  await db.query(
    "insert into crm_tasks(lead_id,title,due_at) values($1,'Historical task',now())",
    [oldLead],
  );
  await db.query(
    "insert into crm_saved_views(member_id,name) values($1,'Historical view')",
    [internal],
  );
  await migrate("202609220001_crm_organizations");
  const login = async (id = "", role = "authenticated") => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec(`set role ${role}`);
  };
  const provision = async (id, name) =>
    (
      await db.query("select crm_provision_organization($1,$2,$3) as id", [
        id,
        name,
        name + " owner",
      ])
    ).rows[0].id;
  await login("", "service_role");
  const orgA = await provision(ownerA, "Agency A");
  const orgB = await provision(ownerB, "Agency B");
  assert.notEqual(orgA, orgB);
  assert.equal(await provision(ownerA, "Retry"), orgA);
  await db.query(
    "insert into crm_members(id,organization_id,name,role) values($1,$2,'Agent A','team'),($3,$2,'Admin A','admin')",
    [teamA, orgA, adminA],
  );
  await t.test(
    "historical data is backfilled; provisioning is atomic and service-only",
    async () => {
      const count = (
        await db.query("select count(*)::int as n from crm_organizations")
      ).rows[0].n;
      await assert.rejects(provision(crypto.randomUUID(), "Missing auth user"));
      assert.equal(
        (await db.query("select count(*)::int as n from crm_organizations"))
          .rows[0].n,
        count,
      );
      await login(internal);
      assert.equal(
        (await db.query("select id from crm_leads")).rows[0].id,
        oldLead,
      );
      assert.equal((await db.query("select * from crm_tasks")).rows.length, 1);
      assert.equal(
        (await db.query("select * from crm_saved_views")).rows.length,
        1,
      );
      assert.equal(
        (await db.query("select * from crm_activities")).rows.length,
        1,
      );
      await assert.rejects(provision(stranger, "Unauthorised"));
      await assert.rejects(
        db.query("update crm_members set organization_id=$1 where id=$2", [
          orgA,
          internal,
        ]),
      );
    },
  );
  const firstStage = async () =>
    (
      await db.query(
        "select id from crm_stages where kind='open' order by position limit 1",
      )
    ).rows[0].id;
  await login(ownerA);
  const stageA = await firstStage();
  const insertLead = async (name, stage, owner) =>
    (
      await db.query(
        "insert into crm_leads(name,email,stage_id,owner_id) values($1,'same@example.com',$2,$3) returning id",
        [name, stage, owner],
      )
    ).rows[0].id;
  const leadA = await insertLead("Agency A lead", stageA, teamA);
  await db.query(
    "insert into crm_tasks(lead_id,title,due_at) values($1,'A task',now())",
    [leadA],
  );
  await db.query(
    "insert into crm_saved_views(member_id,name) values($1,'A view')",
    [ownerA],
  );
  await login(ownerB);
  const stageB = await firstStage();
  const leadB = await insertLead("Agency B lead", stageB, ownerB);
  await db.query(
    "insert into crm_tasks(lead_id,title,due_at) values($1,'B task',now())",
    [leadB],
  );
  await db.query(
    "insert into crm_saved_views(member_id,name) values($1,'B view')",
    [ownerB],
  );
  const clientB = (await db.query("select crm_convert_lead($1) as id", [leadB]))
    .rows[0].id;

  await t.test(
    "owners and admins cannot read, search, update, or convert another business records",
    async () => {
      for (const id of [ownerA, adminA]) {
        await login(id);
        for (const table of [
          "crm_members",
          "crm_stages",
          "crm_leads",
          "crm_tasks",
          "crm_activities",
          "crm_saved_views",
        ]) {
          const rows = (await db.query(`select * from ${table}`)).rows;
          assert.ok(
            rows.every((r) => r.organization_id === orgA),
            table,
          );
        }
        assert.equal(
          (await db.query("select * from crm_organizations")).rows[0].id,
          orgA,
        );
        assert.equal(
          (await db.query("select * from crm_clients")).rows.length,
          0,
        );
        assert.equal(
          (
            await db.query(
              "select id from crm_leads where name ilike '%Agency%' ",
            )
          ).rows.length,
          1,
        );
        assert.equal(
          (await db.query("select count(*)::int as n from crm_leads")).rows[0]
            .n,
          1,
        );
        assert.equal(
          (
            await db.query(
              "update crm_leads set name='Attack' where id=$1 returning id",
              [leadB],
            )
          ).rows.length,
          0,
        );
        assert.equal(
          (await db.query("select crm_lead_access($1) as ok", [leadB])).rows[0]
            .ok,
          false,
        );
        await assert.rejects(
          db.query("select crm_convert_lead($1)", [leadB]),
          /Lead unavailable/,
        );
        await assert.rejects(
          db.query(
            "insert into crm_tasks(lead_id,title,due_at) values($1,'Attack',now())",
            [leadB],
          ),
        );
        await assert.rejects(
          db.query(
            "insert into crm_activities(lead_id,body) values($1,'Attack')",
            [leadB],
          ),
        );
        assert.equal(
          (
            await db.query(
              "delete from crm_saved_views where member_id=$1 returning id",
              [ownerB],
            )
          ).rows.length,
          0,
        );
      }
    },
  );
  await t.test(
    "cross-organisation assignments and stages are rejected; bulk operations stay scoped",
    async () => {
      await login(ownerA);
      await assert.rejects(
        db.query("update crm_leads set owner_id=$1 where id=$2", [
          ownerB,
          leadA,
        ]),
      );
      await assert.rejects(
        db.query("update crm_leads set stage_id=$1 where id=$2", [
          stageB,
          leadA,
        ]),
      );
      await assert.rejects(
        db.query("update crm_leads set organization_id=$1 where id=$2", [
          orgB,
          leadA,
        ]),
      );
      await assert.rejects(
        db.query(
          "insert into crm_saved_views(organization_id,member_id,name) values($1,$2,'Forged')",
          [orgB, ownerA],
        ),
      );
      assert.deepEqual(
        (
          await db.query(
            "update crm_leads set notes='Own only' where id=any($1) returning id",
            [[leadA, leadB]],
          )
        ).rows,
        [{ id: leadA }],
      );
      await login("", "service_role");
      await assert.rejects(
        db.query("update crm_leads set client_id=$1 where id=$2", [
          clientB,
          leadA,
        ]),
      );
      await assert.rejects(
        db.query("update crm_leads set owner_id=$1 where id=$2", [
          ownerB,
          leadA,
        ]),
      );
      await assert.rejects(
        db.query("update crm_leads set stage_id=$1 where id=$2", [
          stageB,
          leadA,
        ]),
      );
      await assert.rejects(
        db.query(
          "insert into crm_tasks(organization_id,lead_id,title,due_at) values($1,$2,'Mismatch',now())",
          [orgA, leadB],
        ),
      );
    },
  );
  await t.test(
    "matching email addresses convert independently and member permissions remain intact",
    async () => {
      await login(teamA);
      const clientA = (
        await db.query("select crm_convert_lead($1) as id", [leadA])
      ).rows[0].id;
      assert.notEqual(clientA, clientB);
      assert.equal(
        (await db.query("select crm_convert_lead($1) as id", [leadA])).rows[0]
          .id,
        clientA,
      );
      assert.equal(
        (await db.query("select * from crm_clients")).rows[0].organization_id,
        orgA,
      );
      assert.ok(
        (await db.query("select * from crm_activities")).rows.every(
          (r) => r.organization_id === orgA,
        ),
      );
      await assert.rejects(
        db.query(
          "insert into crm_stages(name,position) values('Forbidden',10)",
        ),
      );
      await login(ownerA);
      const privateLead = await insertLead("Owner only", stageA, ownerA);
      await login(teamA);
      assert.equal(
        (await db.query("select * from crm_leads where id=$1", [privateLead]))
          .rows.length,
        0,
      );
      await assert.rejects(
        db.query("select crm_convert_lead($1)", [privateLead]),
      );
    },
  );
  await t.test(
    "unprovisioned users and anonymous users cannot access organisations",
    async () => {
      await login(stranger);
      for (const table of [
        "crm_organizations",
        "crm_members",
        "crm_stages",
        "crm_leads",
        "crm_clients",
        "crm_tasks",
        "crm_activities",
        "crm_saved_views",
      ])
        assert.equal((await db.query(`select * from ${table}`)).rows.length, 0);
      await assert.rejects(provision(stranger, "Not permitted"));
      await login("", "anon");
      await assert.rejects(db.query("select * from crm_organizations"));
      await assert.rejects(provision(stranger, "Not permitted"));
    },
  );
  await t.test(
    "server website capture stays internal, deduplicates, and logs activity to that organisation",
    async () => {
      const submission = crypto.randomUUID();
      const capture = () =>
        db.query(
          "select crm_capture_lead($1,'Website visitor','web@example.com','','','Hello') as inserted",
          [submission],
        );
      await login(ownerA);
      await assert.rejects(capture());
      await login(ownerB, "service_role"); // Even a caller JWT cannot redirect the internal ingestion RPC.
      assert.equal((await capture()).rows[0].inserted, true);
      assert.equal((await capture()).rows[0].inserted, false);
      const captured = (
        await db.query("select * from crm_leads where submission_id=$1", [
          submission,
        ])
      ).rows[0];
      assert.equal(
        captured.organization_id,
        "00000000-0000-4000-8000-000000000001",
      );
      assert.equal(
        (
          await db.query(
            "select organization_id from crm_activities where lead_id=$1",
            [captured.id],
          )
        ).rows[0].organization_id,
        captured.organization_id,
      );
      await login(ownerA);
      assert.equal(
        (
          await db.query("select * from crm_leads where submission_id=$1", [
            submission,
          ])
        ).rows.length,
        0,
      );
    },
  );
});
