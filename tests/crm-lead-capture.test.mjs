import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { parseBudget, parseEnquiry } from "../src/lib/crm/lead-capture.ts";
import { processWhatsAppFollowUp } from "../src/lib/crm/whatsapp-followup-worker.ts";

test("enquiries from forms, Lead Ads and portals map to lead fields", () => {
  assert.equal(parseBudget("80 lakh"), 8_000_000);
  assert.equal(parseBudget("80L"), 8_000_000);
  assert.equal(parseBudget("1.2 Cr"), 12_000_000);
  assert.equal(parseBudget("₹75,00,000"), 7_500_000);
  assert.equal(parseBudget("60-80 lakhs"), 8_000_000);
  assert.equal(parseBudget("not sure"), null);

  // Zapier's Facebook Lead Ads fields, plus a custom question.
  const meta = parseEnquiry({
    full_name: "Priya Shah",
    phone_number: "+91 98765 43210",
    email: "Priya@Example.com",
    "What's your budget?": "x",
    budget: "1.5 crore",
    campaign_name: "Sarjapur Launch",
    when_do_you_plan_to_buy: "3 months",
  }, "Facebook Lead Ads");
  assert.equal(meta.name, "Priya Shah");
  assert.equal(meta.phone, "+91 98765 43210");
  assert.equal(meta.email, "priya@example.com");
  assert.equal(meta.budget, 15_000_000);
  assert.equal(meta.source, "Facebook Lead Ads");
  assert.match(meta.notes, /Campaign: Sarjapur Launch/);
  assert.match(meta.notes, /when do you plan to buy: 3 months/);

  const form = parseEnquiry({ "First Name": "Ravi", "Last Name": "K", Mobile: "9876500000", Requirement: "3BHK", City: "Pune", source: "Website" });
  assert.deepEqual([form.name, form.phone, form.lookingFor, form.source], ["Ravi K", "9876500000", "3BHK", "Website"]);
  assert.match(form.notes, /Location: Pune/);

  const fieldData = parseEnquiry({ field_data: [{ name: "full_name", values: ["Asha"] }, { name: "phone_number", values: ["9000000001"] }] });
  assert.deepEqual([fieldData.name, fieldData.phone], ["Asha", "9000000001"]);
  assert.equal(parseEnquiry({ name: "Bot", website: "http://spam" }).spam, true);
});

async function workspace(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema public,auth to anon,authenticated,service_role;",
  );
  for (const file of (await readdir(new URL("../supabase/migrations/", import.meta.url))).filter((f) => f.endsWith(".sql")).sort())
    await db.exec(await readFile(new URL("../supabase/migrations/" + file, import.meta.url), "utf8"));
  const [owner, agent] = [crypto.randomUUID(), crypto.randomUUID()];
  for (const id of [owner, agent]) await db.query("insert into auth.users values($1,$2,now())", [id, id + "@test.invalid"]);
  await db.exec("set role service_role");
  const org = (await db.query("select crm_provision_organization($1,'Sunrise Realty','Owner') id", [owner])).rows[0].id;
  await db.query("insert into crm_subscriptions(organization_id,plan,billing_months,active) values($1,'pro_plus',1,true)", [org]);
  await db.query(
    "insert into crm_usage_periods(organization_id,starts_at,ends_at,revenue_paise,overhead_paise,ai_limit,whatsapp_limit) values($1,now()-interval '1 day',now()+interval '29 days',69900,10000,100,50)",
    [org],
  );
  await db.query("insert into crm_members(id,organization_id,name,role) values($1,$2,'Ramesh Kumar','team')", [agent, org]);
  await db.query("select crm_save_gupshup_connection($1,'veyrnlabsCHAT','916372506476','+916372506476','encrypted',$2)", [owner, "c".repeat(64)]);
  const template = (await db.query(
    "insert into crm_whatsapp_templates(organization_id,label,provider_template_id,body,params) values($1,'Welcome','tpl-welcome','Hi {{1}}, thanks for your enquiry about {{2}} with {{3}}. I''m {{4}}.',array['lead_first_name','service','business_name','agent_name']) returning id",
    [org],
  )).rows[0].id;
  const token = "tok_" + "a".repeat(24);
  await db.query("insert into crm_lead_capture(organization_id,token,welcome_template_id,assign_to) values($1,$2,$3,$4)", [org, token, template, agent]);
  const capture = (fields) =>
    db.query("select crm_capture_workspace_lead($1,$2,$3,$4,$5,$6,$7,$8) r", [
      fields.token ?? token, fields.name ?? "", fields.phone ?? "", fields.email ?? "", fields.lookingFor ?? "", fields.budget ?? null, fields.notes ?? "", fields.source ?? "",
    ]).then((r) => r.rows[0].r);
  return { db, org, owner, agent, token, template, capture };
}

test("every way of typing a phone number gives one WhatsApp number", async (t) => {
  const { db } = await workspace(t);
  await db.exec("reset role"); // internal helper: only the database's own functions call it
  const cases = {
    "8127158503": "918127158503",
    "+918127158503": "918127158503",
    "918127158503": "918127158503",
    "+91 81271 58503": "918127158503",
    "08127158503": "918127158503",
    "(+91) 81271-58503": "918127158503",
    "+91-0-8127158503": "918127158503",
    "0091 8127158503": "918127158503",
    "+8127158503": "918127158503",
    // A local number that starts with 91 is never cut short.
    "9127158503": "919127158503",
    "+91 9127158503": "919127158503",
    "9198765432": "919198765432",
    // Several numbers in one field, or words around it: the first number.
    "98765 43210 / 91234 56789": "919876543210",
    "9876543210, 9123456789": "919876543210",
    "Call 98765-43210 after 6": "919876543210",
    // Other countries, written with + or 00.
    "+1 415 555 0100": "14155550100",
    "001 415 555 0100": "14155550100",
    "+44 7911 123456": "447911123456",
    // Can't be right: never messaged.
    "91987654321": null,
    "+91 51234 56789": null,
    "12345": null,
    "": null,
  };
  for (const [typed, expected] of Object.entries(cases))
    assert.equal((await db.query("select crm_whatsapp_number($1,'91') n", [typed])).rows[0].n, expected, typed);
});

test("captured enquiries become assigned leads, repeats merge, and floods are capped", async (t) => {
  const { db, org, agent, capture } = await workspace(t);
  const first = await capture({ name: "Priya Shah", phone: "+91 98765 43210", lookingFor: "3BHK in Sarjapur", budget: 8000000, source: "Instagram" });
  assert.equal(first.status, "created");
  const lead = (await db.query("select name,phone,service,value,source,owner_id,welcome_at from crm_leads where id=$1", [first.lead])).rows[0];
  assert.deepEqual([lead.name, lead.service, Number(lead.value), lead.source, lead.owner_id], ["Priya Shah", "3BHK in Sarjapur", 8000000, "Instagram", agent]);
  assert.ok(lead.welcome_at);
  assert.match((await db.query("select string_agg(body,'|') b from crm_activities where lead_id=$1", [first.lead])).rows[0].b, /Captured from Instagram/);

  // Same number in another format: added to the open lead, no duplicate, no second welcome.
  const again = await capture({ name: "Priya", phone: "9876543210", email: "priya@example.com", notes: "Is there a 4BHK?", source: "Website form" });
  assert.deepEqual(again, { status: "existing", lead: first.lead });
  assert.equal((await db.query("select count(*)::int n from crm_leads where organization_id=$1 and phone<>''", [org])).rows[0].n, 1);
  assert.equal((await db.query("select email from crm_leads where id=$1", [first.lead])).rows[0].email, "priya@example.com");
  assert.match((await db.query("select body from crm_activities where lead_id=$1 and body like 'Enquired again%'", [first.lead])).rows[0].body, /Website form: Is there a 4BHK/);
  await capture({ phone: "9876543210" });
  assert.equal((await capture({ phone: "9876543210" })).status, "ignored"); // 4th in an hour

  // A different number with the same email is a new person, not a repeat.
  const sharedEmail = await capture({ name: "Anil", phone: "9123456789", email: "priya@example.com" });
  assert.equal(sharedEmail.status, "created");
  assert.notEqual(sharedEmail.lead, first.lead);
  // Email never links enquiries: without a number it's always a new lead.
  const byEmail = await capture({ name: "Priya", email: "PRIYA@example.com" });
  assert.equal(byEmail.status, "created");
  assert.ok(![first.lead, sharedEmail.lead].includes(byEmail.lead));
  // Any way of writing the same number is the same person.
  for (const phone of ["+91 91234 56789", "091234-56789"])
    assert.deepEqual(await capture({ name: "Anil", phone }), { status: "existing", lead: sharedEmail.lead });

  // Email-only enquiries work (no welcome without a number); a missing contact is refused.
  const mailOnly = await capture({ name: "Ravi", email: "ravi@example.com" });
  assert.equal(mailOnly.status, "created");
  assert.equal((await db.query("select welcome_at from crm_leads where id=$1", [mailOnly.lead])).rows[0].welcome_at, null);
  await assert.rejects(capture({ name: "No contact" }), /name and a phone number or email/);
  await assert.rejects(capture({ token: "tok_" + "b".repeat(24), name: "X", phone: "9000000000" }), /not available/);
  await db.query("update crm_lead_capture set enabled=false where organization_id=$1", [org]);
  await assert.rejects(capture({ name: "X", phone: "9000000000" }), /not available/);
  await db.query("update crm_lead_capture set enabled=true where organization_id=$1", [org]);

  // Customers can't call it, or read another workspace's capture settings.
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [agent]);
  await db.exec("set role authenticated");
  await assert.rejects(capture({ name: "X", phone: "9000000000" }), /permission denied/);
  assert.equal((await db.query("select count(*)::int n from crm_lead_capture")).rows[0].n, 0); // team members don't see it
});

test("a new lead gets one WhatsApp welcome from the worker", async (t) => {
  const { db, org, capture } = await workspace(t);
  const { lead } = await capture({ name: "Priya Shah", phone: "9876543210", lookingFor: "3BHK in Sarjapur" });
  const rpc = (name, args) =>
    db.query(`select ${name}(${Object.keys(args).map((_, i) => `$${i + 1}`).join(",")}) r`, Object.values(args)).then(
      (r) => ({ data: r.rows[0].r, error: null }),
      (e) => ({ data: null, error: { message: e.message } }),
    );
  const sent = [];
  const send = { provider: "gupshup", phone: "916372506476", token: "t", app: "veyrnlabsCHAT" };
  const result = await processWhatsAppFollowUp(12, rpc, async () => send, async (url, init) => {
    sent.push(new URLSearchParams(init.body));
    return Response.json({ status: "submitted", messageId: "gs-1" });
  }, "crm_claim_lead_welcome");
  assert.equal(result.status, "accepted");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].get("destination"), "919876543210");
  const outbox = (await db.query("select o.body,o.origin from crm_whatsapp_outbox o join crm_whatsapp_conversations c on c.id=o.conversation_id where c.lead_id=$1", [lead])).rows[0];
  assert.equal(outbox.body, "Hi Priya, thanks for your enquiry about 3BHK in Sarjapur with Sunrise Realty. I'm Ramesh Kumar.");
  assert.match((await db.query("select string_agg(body,'|') b from crm_activities where lead_id=$1", [lead])).rows[0].b, /Welcome WhatsApp sent \(Welcome\)/);
  // Nothing more is due: never sent twice.
  assert.equal((await processWhatsAppFollowUp(12, rpc, async () => send, async () => assert.fail("sent twice"), "crm_claim_lead_welcome")).status, "idle");

  // A lead already chatting on WhatsApp isn't welcomed.
  const second = await capture({ name: "Ravi", phone: "9000000002" });
  await db.query(
    "insert into crm_whatsapp_conversations(organization_id,connection_id,lead_id,sender,last_message_at) select $1,id,$2,'919000000002',now()+interval '1 second' from crm_whatsapp_connections where organization_id=$1",
    [org, second.lead],
  );
  assert.equal((await processWhatsAppFollowUp(12, rpc, async () => send, async () => assert.fail("sent"), "crm_claim_lead_welcome")).status, "skipped");
  assert.equal((await db.query("select status,reason from crm_whatsapp_followup_jobs where lead_id=$1", [second.lead])).rows[0].reason, "Already chatting on WhatsApp");
});
