import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("the owner chooses whether team members see all leads or only their own", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema public,auth to anon,authenticated,service_role;",
  );
  for (const file of (await readdir(new URL("../supabase/migrations/", import.meta.url)))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(await readFile(new URL("../supabase/migrations/" + file, import.meta.url), "utf8"));

  const [owner, agentA, agentB, outsider] = Array.from({ length: 4 }, () => crypto.randomUUID());
  for (const id of [owner, agentA, agentB, outsider])
    await db.query("insert into auth.users values($1,$2,now())", [id, id + "@test.invalid"]);
  const login = async (id = "", role = "authenticated") => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec(`set role ${role}`);
  };
  const ids = async (sql, params = []) => (await db.query(sql, params)).rows.map((r) => r.id).sort();

  await login("", "service_role");
  const org = (await db.query("select crm_provision_organization($1,'Agency','Owner') id", [owner])).rows[0].id;
  await db.query("select crm_provision_organization($1,'Other','Outsider')", [outsider]);
  await db.query("insert into crm_subscriptions(organization_id,plan,billing_months,active) values($1,'pro_plus',1,true)", [org]);
  await db.query("insert into crm_members(id,organization_id,name,role) values($1,$3,'A','team'),($2,$3,'B','team')", [agentA, agentB, org]);
  const stage = (await db.query("select id from crm_stages where organization_id=$1 and kind='open' order by position limit 1", [org])).rows[0].id;
  const lead = async (name, ownerId) =>
    (await db.query("insert into crm_leads(organization_id,name,owner_id,stage_id) values($1,$2,$3,$4) returning id", [org, name, ownerId, stage])).rows[0].id;
  const leadA = await lead("A's lead", agentA);
  const leadB = await lead("B's lead", agentB);
  const open = await lead("Unassigned", null);
  const connection = (await db.query(
    "insert into crm_whatsapp_connections(organization_id,waba_id,phone_number_id,display_phone,active) values($1,'111','222','+91 98000 00000',true) returning id",
    [org],
  )).rows[0].id;
  const conversation = (await db.query(
    "insert into crm_whatsapp_conversations(organization_id,connection_id,lead_id,sender,last_message_at) values($1,$2,$3,'919800000000',now()) returning id",
    [org, connection, leadB],
  )).rows[0].id;

  // Default: all leads.
  await login(agentA);
  assert.deepEqual(await ids("select id from crm_leads"), [leadA, leadB, open].sort());
  assert.deepEqual(await ids("select id from crm_whatsapp_conversations"), [conversation]);
  // A teammate's lead can be worked on, but not taken or handed off.
  await db.query("insert into crm_activities(lead_id,kind,body) values($1,'note','Called them')", [leadB]);
  await db.query("insert into crm_tasks(lead_id,title,due_at) values($1,'Send brochure',now()+interval '1 day')", [leadB]);
  await db.query("update crm_leads set notes='Prefers mornings' where id=$1", [leadB]);
  await assert.rejects(db.query("update crm_leads set owner_id=$1 where id=$2", [agentA, leadB]), /Only owners and admins can reassign/);
  await assert.rejects(db.query("update crm_leads set owner_id=$1 where id=$2", [agentB, leadA]), /Only owners and admins can reassign/);
  await assert.rejects(db.query("update crm_leads set owner_id=null where id=$1", [leadA]), /Only owners and admins can reassign/);
  // An unassigned lead can be claimed, but only by the person claiming it.
  await assert.rejects(db.query("update crm_leads set owner_id=$1 where id=$2", [agentB, open]), /Only owners and admins can reassign/);
  await db.query("update crm_leads set owner_id=$1 where id=$2", [agentA, open]);
  // Team members can't change the setting.
  await assert.rejects(db.query("select crm_set_team_visibility(false)"), /Only the workspace owner/);

  // Owner restricts to assigned only.
  await login(owner);
  await db.query("select crm_set_team_visibility(false)");
  await db.query("update crm_leads set owner_id=$1 where id=$2", [agentB, open]);
  await login(agentA);
  assert.deepEqual(await ids("select id from crm_leads"), [leadA]);
  assert.deepEqual(await ids("select id from crm_whatsapp_conversations"), []);
  assert.equal((await db.query("select id from crm_activities where lead_id=$1", [leadB])).rows.length, 0);
  await assert.rejects(
    db.query("insert into crm_activities(lead_id,kind,body) values($1,'note','x')", [leadB]),
  );
  // Owners and admins always see everything; another business sees none of it.
  await login(owner);
  assert.equal((await db.query("select id from crm_leads")).rows.length, 3);
  await login(outsider);
  assert.equal((await db.query("select id from crm_leads where organization_id=$1", [org])).rows.length, 0);
});
