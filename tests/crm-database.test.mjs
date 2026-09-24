import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("CRM migration: roles, RLS, conversion, activity history, and capture idempotency", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;`);
  await db.exec(
    await readFile(
      new URL("../supabase/migrations/202609140001_crm.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/202609150001_crm_saved_views.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/202609150002_crm_capture_returns_inserted.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const ids = [
    "00000000-0000-0000-0000-000000000001",
    "00000000-0000-0000-0000-000000000002",
    "00000000-0000-0000-0000-000000000003",
    "00000000-0000-0000-0000-000000000004",
  ];
  for (const id of ids)
    await db.query("insert into auth.users values($1)", [id]);
  for (let i = 0; i < 3; i++)
    await db.query("insert into crm_members(id,name,role) values($1,$2,$3)", [
      ids[i],
      ["Owner", "Member", "Admin"][i],
      ["owner", "team", "admin"][i],
    ]);
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/202609220001_crm_organizations.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const stages = (await db.query("select * from crm_stages order by position"))
    .rows;
  const login = async (id, role = "authenticated") => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec(`set role ${role}`);
  };
  await login(ids[0]);
  const lead = (
    await db.query(
      "insert into crm_leads(name,email,stage_id,owner_id) values($1,$2,$3,$4) returning id",
      ["Test Lead", "lead@example.com", stages[0].id, ids[1]],
    )
  ).rows[0].id;
  const hidden = (
    await db.query(
      "insert into crm_leads(name,stage_id,owner_id) values($1,$2,$3) returning id",
      ["Private Lead", stages[0].id, ids[0]],
    )
  ).rows[0].id;
  await t.test(
    "team members cannot read or update other owners, forge clients, change roles, or configure stages",
    async () => {
      await login(ids[1]);
      assert.equal((await db.query("select id from crm_leads")).rows.length, 1);
      assert.equal(
        (
          await db.query(
            "update crm_leads set name=$1 where id=$2 returning id",
            ["Not allowed", hidden],
          )
        ).rows.length,
        0,
      );
      await assert.rejects(
        db.query("update crm_members set role=$1 where id=$2", [
          "owner",
          ids[1],
        ]),
      );
      await assert.rejects(
        db.query("update crm_leads set client_id=$1 where id=$2", [
          hidden,
          lead,
        ]),
      );
      await assert.rejects(
        db.query("insert into crm_stages(name,position,kind) values($1,2,$2)", [
          "Forbidden",
          "open",
        ]),
      );
      await assert.rejects(db.query("select crm_convert_lead($1)", [hidden]));
      await assert.rejects(
        db.query(
          "insert into crm_tasks(lead_id,title,due_at) values($1,$2,now())",
          [hidden, "Forbidden"],
        ),
      );
    },
  );
  await t.test(
    "conversion is atomic and repeat calls reuse the client while history survives",
    async () => {
      await login(ids[1]);
      await db.query(
        "insert into crm_activities(lead_id,body,kind) values($1,$2,$3)",
        [lead, "Discovery call completed", "call"],
      );
      await db.query(
        "insert into crm_tasks(lead_id,title,due_at) values($1,$2,now())",
        [lead, "Follow up"],
      );
      const client = (
        await db.query("select crm_convert_lead($1) as id", [lead])
      ).rows[0].id;
      assert.equal(
        (await db.query("select crm_convert_lead($1) as id", [lead])).rows[0]
          .id,
        client,
      );
      assert.equal(
        (await db.query("select * from crm_clients")).rows.length,
        1,
      );
      const saved = (
        await db.query("select * from crm_leads where id=$1", [lead])
      ).rows[0];
      assert.equal(saved.stage_id, stages[6].id);
      assert.ok(saved.closed_at);
      assert.equal(saved.client_id, client);
      assert.ok(
        (
          await db.query("select * from crm_activities where lead_id=$1", [
            lead,
          ])
        ).rows.some((r) => r.body === "Discovery call completed"),
      );
      assert.equal(
        (await db.query("select * from crm_tasks where lead_id=$1", [lead]))
          .rows.length,
        1,
      );
      await assert.rejects(
        db.query("update crm_leads set stage_id=$1 where id=$2", [
          stages[0].id,
          lead,
        ]),
      );
    },
  );
  await t.test(
    "users without membership cannot read workspace records",
    async () => {
      await login(ids[3]);
      for (const table of [
        "crm_leads",
        "crm_clients",
        "crm_tasks",
        "crm_members",
        "crm_stages",
        "crm_activities",
      ])
        assert.equal((await db.query(`select * from ${table}`)).rows.length, 0);
    },
  );
  await t.test(
    "admin can see all leads and configure an open stage",
    async () => {
      await login(ids[2]);
      assert.equal((await db.query("select * from crm_leads")).rows.length, 2);
      await db.query(
        "insert into crm_stages(name,position,kind) values($1,3,$2)",
        ["Review", "open"],
      );
      await assert.rejects(
        db.query("insert into crm_stages(name,position,kind) values($1,8,$2)", [
          "Extra won",
          "won",
        ]),
      );
    },
  );
  await t.test(
    "bulk stage update (used by the bulkStage action) only touches rows RLS allows",
    async () => {
      await login(ids[0]);
      const bulkOwn = (
        await db.query(
          "insert into crm_leads(name,stage_id,owner_id) values($1,$2,$3) returning id",
          ["Bulk Own", stages[0].id, ids[1]],
        )
      ).rows[0].id;
      const bulkOther = (
        await db.query(
          "insert into crm_leads(name,stage_id,owner_id) values($1,$2,$3) returning id",
          ["Bulk Other", stages[0].id, ids[0]],
        )
      ).rows[0].id;
      await login(ids[1]);
      const updated = (
        await db.query(
          "update crm_leads set stage_id=$1 where id = any($2) returning id",
          [stages[1].id, [bulkOwn, bulkOther]],
        )
      ).rows;
      assert.deepEqual(updated, [{ id: bulkOwn }]);
      await login(ids[0]);
      const otherStage = (
        await db.query("select stage_id from crm_leads where id=$1", [
          bulkOther,
        ])
      ).rows[0].stage_id;
      assert.equal(otherStage, stages[0].id);
    },
  );
  await t.test(
    "saved views (crm_saved_views) are private to the member who created them",
    async () => {
      await login(ids[1]);
      const view = (
        await db.query(
          "insert into crm_saved_views(member_id,name,source) values($1,$2,$3) returning id",
          [ids[1], "My open leads", "Website"],
        )
      ).rows[0].id;
      await assert.rejects(
        db.query("insert into crm_saved_views(member_id,name) values($1,$2)", [
          ids[0],
          "Forged for owner",
        ]),
      );
      await login(ids[0]);
      assert.equal(
        (await db.query("select * from crm_saved_views where id=$1", [view]))
          .rows.length,
        0,
      );
      await login(ids[1]);
      assert.equal(
        (await db.query("select * from crm_saved_views")).rows.length,
        1,
      );
    },
  );
  await t.test(
    "ILIKE search (used by /api/crm/search) stays bounded by RLS",
    async () => {
      await login(ids[1]);
      const found = (
        await db.query("select id from crm_leads where name ilike $1", [
          "%Lead%",
        ])
      ).rows;
      assert.equal(found.length, 1);
      assert.equal(found[0].id, lead);
    },
  );
  await t.test(
    "public visitors cannot read records or invoke capture directly",
    async () => {
      await login("", "anon");
      await assert.rejects(db.query("select * from crm_leads"));
      await assert.rejects(
        db.query("select crm_capture_lead($1,$2,$3,$4,$5,$6)", [
          crypto.randomUUID(),
          "Contact",
          "web@example.com",
          "",
          "",
          "Hello",
        ]),
      );
    },
  );
  await t.test(
    "server capture deduplicates retries and limits repeated enquiries",
    async () => {
      await login("", "service_role");
      const submission = crypto.randomUUID();
      const capture = (id) =>
        db.query("select crm_capture_lead($1,$2,$3,$4,$5,$6)", [
          id,
          "Contact",
          "web@example.com",
          "",
          "Website",
          "Hello",
        ]);
      assert.equal((await capture(submission)).rows[0].crm_capture_lead, true);
      assert.equal((await capture(submission)).rows[0].crm_capture_lead, false);
      assert.equal(
        (await db.query("select * from crm_leads where source='Website'")).rows
          .length,
        1,
      );
      await capture(crypto.randomUUID());
      await capture(crypto.randomUUID());
      await assert.rejects(capture(crypto.randomUUID()), /Too many/);
    },
  );
});
