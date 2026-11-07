import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { sendGupshupTemplate } from "../src/lib/crm/whatsapp-gupshup.ts";
import { processWhatsAppFollowUp } from "../src/lib/crm/whatsapp-followup-worker.ts";

async function workspace(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema public,auth to anon,authenticated,service_role;",
  );
  for (const file of (await readdir(new URL("../supabase/migrations/", import.meta.url))).filter((f) => f.endsWith(".sql")).sort())
    await db.exec(await readFile(new URL("../supabase/migrations/" + file, import.meta.url), "utf8"));
  const [owner, agent, other] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  for (const id of [owner, agent, other]) await db.query("insert into auth.users values($1,$2,now())", [id, id + "@test.invalid"]);
  await db.exec("set role service_role");
  const org = (await db.query("select crm_provision_organization($1,'Sunrise Realty','Owner') id", [owner])).rows[0].id;
  await db.query("insert into crm_subscriptions(organization_id,plan,billing_months,active) values($1,'pro_plus',1,true)", [org]);
  await db.query(
    "insert into crm_usage_periods(organization_id,starts_at,ends_at,revenue_paise,overhead_paise,ai_limit,whatsapp_limit) values($1,now()-interval '1 day',now()+interval '29 days',69900,10000,100,5)",
    [org],
  );
  await db.query("insert into crm_members(id,organization_id,name,role) values($1,$3,'Ramesh Kumar','team'),($2,$3,'Other Agent','team')", [agent, other, org]);
  await db.query("select crm_save_gupshup_connection($1,'veyrnlabsCHAT','916372506476','+916372506476','encrypted',$2)", [owner, "c".repeat(64)]);
  const connection = (await db.query("select id from crm_whatsapp_connections where organization_id=$1", [org])).rows[0].id;
  const stage = (await db.query("select id from crm_stages where organization_id=$1 and kind='open' order by position limit 1", [org])).rows[0].id;
  const lead = async (name, phone, followUp, ownerId = agent, service = "2BHK in Whitefield") =>
    (await db.query(
      "insert into crm_leads(organization_id,name,phone,owner_id,stage_id,follow_up,service) values($1,$2,$3,$4,$5,$6,$7) returning id",
      [org, name, phone, ownerId, stage, followUp, service],
    )).rows[0].id;
  return { db, org, owner, agent, other, connection, stage, lead };
}

test("typed replies follow the 24-hour window, access and opt-out rules", async (t) => {
  const { db, org, owner, agent, other, lead } = await workspace(t);
  const leadId = await lead("Priya Shah", "9876543210", null);
  const conversation = (await db.query(
    "insert into crm_whatsapp_conversations(organization_id,connection_id,lead_id,sender,last_message_at) select $1,id,$2,'919876543210',now() from crm_whatsapp_connections where organization_id=$1 returning id",
    [org, leadId],
  )).rows[0].id;
  const message = (body, at = "now()") =>
    db.query(`insert into crm_whatsapp_messages(organization_id,conversation_id,message_id,message_type,body,sent_at) values($1,$2,$3,'text',$4,${at})`, [org, conversation, crypto.randomUUID(), body]);
  const prepare = (actor, text, request = crypto.randomUUID()) =>
    db.query("select crm_prepare_manual_reply($1,$2,$3,$4,$5,'916372506476','0',12) j", [actor, conversation, text, request, org]).then((r) => r.rows[0].j);

  await message("Is it available?", "now()-interval '25 hours'");
  await assert.rejects(prepare(agent, "Yes!"), /Reply window closed/);
  await message("Hello?");
  const request = crypto.randomUUID();
  const job = await prepare(agent, "  Yes, it is. Visit on Saturday?  ", request);
  assert.deepEqual({ run: job.run, recipient: job.recipient, body: job.body, phone: job.phone },
    { run: true, recipient: "919876543210", body: "Yes, it is. Visit on Saturday?", phone: "916372506476" });
  // The same request id never sends twice.
  assert.equal((await prepare(agent, "Yes, it is. Visit on Saturday?", request)).run, false);
  assert.equal((await db.query("select origin from crm_whatsapp_outbox where id=$1", [job.id])).rows[0].origin, "manual");
  // A teammate who isn't the lead's agent can't reply; the owner can.
  await assert.rejects(prepare(other, "Hi"), /Conversation unavailable/);
  assert.equal((await prepare(owner, "Hi from the owner")).run, true);
  await message("Please STOP messaging me");
  await assert.rejects(prepare(agent, "Sorry"), /requested no messages/);
  // Ordinary replies don't undo an opt-out; a later START does, and a new STOP blocks again.
  await message("No, yes interested now", "now()+interval '1 second'");
  await assert.rejects(prepare(agent, "Sorry"), /requested no messages/);
  await message("Start!", "now()+interval '2 seconds'");
  assert.equal((await prepare(agent, "Welcome back")).run, true);
  const listed = () =>
    db.query("select crm_whatsapp_opted_out_conversations(array[$1]::uuid[]) id", [conversation]).then((r) => r.rows.length);
  assert.equal(await listed(), 0);
  await message("unsubscribe", "now()+interval '3 seconds'");
  await assert.rejects(prepare(agent, "Sorry"), /requested no messages/);
  assert.equal(await listed(), 1);
});

test("automatic follow-ups send once per due date and respect every guard", async (t) => {
  const { db, org, owner, agent, lead } = await workspace(t);
  const template = (await db.query(
    "insert into crm_whatsapp_templates(organization_id,label,provider_template_id,body,params) values($1,'Enquiry follow-up','tpl-1','Hi {{1}}, this is {{2}} from {{3}}. Following up on {{4}}.',array['lead_first_name','agent_name','business_name','service']) returning id",
    [org],
  )).rows[0].id;
  const claim = () => db.query("select crm_claim_whatsapp_followup(12) j").then((r) => r.rows[0].j);

  const due = await lead("Priya Shah", "98765 43210", new Date(Date.now() - 3600e3));
  await lead("Old Lead", "9876500001", new Date(Date.now() - 10 * 86400e3));
  const contacted = await lead("Called Already", "9876500002", new Date(Date.now() - 7200e3));
  await db.query("insert into crm_activities(organization_id,lead_id,kind,body) values($1,$2,'call','Spoke to them')", [org, contacted]);
  await lead("No Phone", "", new Date(Date.now() - 3600e3));

  // Off by default.
  assert.equal(await claim(), null);
  await db.query("insert into crm_whatsapp_followup_settings(organization_id,enabled,template_id) values($1,true,$2)", [org, template]);

  const job = await claim();
  assert.equal(job.run, true);
  assert.equal(job.recipient, "919876543210");
  assert.equal(job.phone, "916372506476");
  assert.equal(job.template, "tpl-1");
  assert.deepEqual(job.params, ["Priya", "Ramesh Kumar", "Sunrise Realty", "2BHK in Whitefield"]);
  assert.equal(job.body, "Hi Priya, this is Ramesh Kumar from Sunrise Realty. Following up on 2BHK in Whitefield.");
  const chat = (await db.query("select lead_id,sender from crm_whatsapp_conversations where sender='919876543210'")).rows[0];
  assert.deepEqual(chat, { lead_id: due, sender: "919876543210" });
  assert.equal((await db.query("select origin,approved_by from crm_whatsapp_outbox where id=$1", [job.outbox])).rows[0].origin, "followup");

  // Old follow-ups, contacted leads and leads without a number are never picked; nor is the same date twice.
  assert.equal(await claim(), null);

  await db.query("select crm_finish_whatsapp_reply($1,'accepted','gs-1',12)", [job.outbox]);
  await db.query("select crm_end_whatsapp_followup($1,$2,'sent','ok')", [job.job, job.token]);
  assert.equal((await db.query("select status from crm_whatsapp_followup_jobs where id=$1", [job.job])).rows[0].status, "sent");
  assert.match((await db.query("select body from crm_activities where lead_id=$1 order by created_at desc limit 1", [due])).rows[0].body, /Automatic WhatsApp follow-up sent/);

  // A new follow-up date on the same lead is due again, unless the customer opted out.
  await db.query("update crm_leads set follow_up=now()-interval '1 minute' where id=$1", [due]);
  await db.query("insert into crm_whatsapp_messages(organization_id,conversation_id,message_id,message_type,body,sent_at) select $1,id,'m-stop','text','stop',now()-interval '1 day' from crm_whatsapp_conversations where sender='919876543210'", [org]);
  assert.equal(await claim(), null);
  // "START" after the stop makes them reachable again. The conversation's last message time
  // stays before the follow-up, as it would for a START sent before the new follow-up date.
  await db.query("insert into crm_whatsapp_messages(organization_id,conversation_id,message_id,message_type,body,sent_at) select $1,id,'m-start','text','START',now()-interval '23 hours' from crm_whatsapp_conversations where sender='919876543210'", [org]);
  await db.exec("reset role");
  assert.equal((await db.query("select crm_whatsapp_followup_due($1,$2) d", [org, due])).rows[0].d, true);
  await db.exec("set role service_role");

  // When the WhatsApp allowance is used up, the job is parked for a person instead of retrying.
  await db.query("delete from crm_whatsapp_messages where message_id in ('m-stop','m-start')");
  await db.query("update crm_usage_periods set whatsapp_limit=1 where organization_id=$1", [org]);
  const parked = await claim();
  assert.equal(parked.run, false);
  assert.equal((await db.query("select status from crm_whatsapp_followup_jobs where id=$1", [parked.job])).rows[0].status, "needs_human");
  void owner;
  void agent;
});

test("sendGupshupTemplate posts the template form", async () => {
  let seen;
  const result = await sendGupshupTemplate("key", "veyrnlabsCHAT", "916372506476", "919876543210", "tpl-1", ["Priya", "Ramesh"], async (url, init) => {
    seen = { url, form: new URLSearchParams(init.body.toString()), key: init.headers.apikey };
    return Response.json({ status: "submitted", messageId: "gs-9" });
  });
  assert.deepEqual(result, { status: "accepted", messageId: "gs-9" });
  assert.equal(seen.url, "https://api.gupshup.io/wa/api/v1/template/msg");
  assert.equal(seen.key, "key");
  assert.deepEqual(JSON.parse(seen.form.get("template")), { id: "tpl-1", params: ["Priya", "Ramesh"] });
  assert.equal(seen.form.get("destination"), "919876543210");
});

test("the worker sends a claimed follow-up and records the outcome", async () => {
  const calls = [];
  const claimed = { job: "j1", token: "t1", run: true, outbox: "o1", organization: "org", recipient: "919876543210",
    phone: "916372506476", template: "tpl-1", params: ["Priya"] };
  const rpc = async (name, args) => {
    calls.push([name, args]);
    return { data: name === "crm_claim_whatsapp_followup" ? claimed : null, error: null };
  };
  const send = { provider: "gupshup", token: "key", app: "veyrnlabsCHAT", phone: "916372506476" };
  const result = await processWhatsAppFollowUp(12, rpc, async () => send, async () => Response.json({ status: "submitted", messageId: "gs-1" }));
  assert.deepEqual(result, { status: "accepted" });
  assert.deepEqual(calls.map((c) => c[0]), ["crm_claim_whatsapp_followup", "crm_finish_whatsapp_reply", "crm_end_whatsapp_followup"]);
  assert.equal(calls[2][1].outcome, "sent");

  // No usable connection: nothing is sent, the reservation is released, a person is asked.
  calls.length = 0;
  assert.deepEqual(await processWhatsAppFollowUp(12, rpc, async () => null), { status: "needs_human" });
  assert.equal(calls[1][1].outcome, "rejected");
  assert.equal(calls[2][1].outcome, "needs_human");
});
