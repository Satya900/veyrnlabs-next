import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { aiConfig, generateLeadInsight, generateFollowUpDraft } from "../src/lib/crm/ai-provider.ts";

const env = {
  CRM_AI_ENABLED: "true",
  CRM_AI_PROVIDER: "anthropic",
  ANTHROPIC_API_KEY: "test-key",
  CRM_AI_MODEL: "claude-haiku-4-5-20251001",
  CRM_AI_INPUT_PAISE_PER_MILLION: "8800",
  CRM_AI_OUTPUT_PAISE_PER_MILLION: "44000",
};
const context = {
  business: "Sunrise Realty",
  knowledge: "We sell apartments in Whitefield.",
  lead: { name: "Priya Shah", service: "", value: 0, notes: "" },
  messages: [
    { from: "business", at: "2026-11-07T07:18:00Z", text: "Hi Priya, following up on your enquiry." },
    { from: "customer", at: "2026-11-07T07:20:00Z", text: "Yes interested, 2BHK under 80 lakh, can I visit Saturday?" },
  ],
};
const claude = (input, stop = "tool_use") => async (url, init) => {
  assert.equal(url, "https://api.anthropic.com/v1/messages");
  assert.equal(init.headers["x-api-key"], "test-key");
  assert.equal(init.headers["anthropic-version"], "2023-06-01");
  const body = JSON.parse(init.body);
  assert.equal(body.model, "claude-haiku-4-5-20251001");
  assert.equal(body.tool_choice.type, "tool");
  assert.equal(body.tools[0].name, body.tool_choice.name);
  return Response.json({
    stop_reason: stop,
    content: [{ type: "tool_use", name: body.tool_choice.name, input }],
    usage: { input_tokens: 2000, output_tokens: 300 },
  });
};

test("Claude returns a lead insight as a forced tool call, costed from token usage", async () => {
  const config = aiConfig(env);
  assert.equal(config.provider, "anthropic");
  assert.equal(aiConfig({ ...env, ANTHROPIC_API_KEY: "" }), null);
  const { insight, cost } = await generateLeadInsight(
    config,
    context,
    claude({
      summary: "Wants a 2BHK under ₹80L; asked to visit Saturday.",
      score: "hot",
      score_reason: "Clear budget and a visit request.",
      details: { budget: "80 lakh", budget_inr: 8000000, location: "", property_type: "2BHK", timeline: "", purpose: "", looking_for: "2BHK" },
      suggestions: ["Saturday works! 11 am or 4 pm?", "Which area do you prefer?", "Shall I share options under ₹80L?", "extra"],
    }),
  );
  // 2000 x 8800 / 1M + 300 x 44000 / 1M = 17.6 + 13.2, rounded up.
  assert.equal(cost, 31);
  assert.equal(insight.score, "hot");
  assert.equal(insight.details.budget_inr, 8000000);
  assert.equal(insight.suggestions.length, 3);

  // An unfinished or malformed answer is not used, but its cost still counts.
  assert.equal((await generateLeadInsight(config, context, claude({}, "max_tokens"))).insight, null);
  const bad = await generateLeadInsight(config, context, claude({ score: "lukewarm", suggestions: [] }));
  assert.equal(bad.insight, null);
  assert.equal(bad.cost, 31);
  // Missing usage means the cost can't be confirmed: the call throws and the reservation stays.
  await assert.rejects(
    generateLeadInsight(config, context, async () => Response.json({ stop_reason: "tool_use", content: [] })),
    /Invalid provider usage/,
  );
  // Existing AI features work on Claude too.
  const email = await generateFollowUpDraft(
    config,
    "Facts",
    { name: "Priya", company: "", service: "2BHK", notes: "" },
    claude({ email_subject: "Still looking?", email_body: "Hi Priya…", needs_human: false, reason: "Quiet lead" }),
  );
  assert.equal(email.emailSubject, "Still looking?");
});

test("insight context, saving and visibility follow workspace rules", async (t) => {
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
  await db.query("insert into crm_members(id,organization_id,name,role) values($1,$3,'Agent','team'),($2,$3,'Other','team')", [agent, other, org]);
  await db.query("update crm_organizations set team_sees_all_leads=false where id=$1", [org]);
  await db.query("select crm_save_gupshup_connection($1,'app','916372506476','+916372506476','enc',$2)", [owner, "e".repeat(64)]);
  const stage = (await db.query("select id from crm_stages where organization_id=$1 and kind='open' limit 1", [org])).rows[0].id;
  const lead = (await db.query("insert into crm_leads(organization_id,name,phone,owner_id,stage_id) values($1,'Priya Shah','9876543210',$2,$3) returning id", [org, agent, stage])).rows[0].id;
  const chat = (await db.query(
    "insert into crm_whatsapp_conversations(organization_id,connection_id,lead_id,sender,last_message_at) select $1,id,$2,'919876543210',now() from crm_whatsapp_connections where organization_id=$1 returning id",
    [org, lead],
  )).rows[0].id;
  await db.query("insert into crm_whatsapp_messages(organization_id,conversation_id,message_id,message_type,body,sent_at) values($1,$2,'m1','text','2BHK under 80 lakh?',now())", [org, chat]);
  await db.query(
    "insert into crm_usage_periods(organization_id,starts_at,ends_at,revenue_paise,overhead_paise,ai_limit,whatsapp_limit) values($1,now()-interval '1 day',now()+interval '29 days',69900,10000,100,5)",
    [org],
  );
  const reply = (await db.query("select crm_prepare_manual_reply($1,$2,'Hi Priya!',$3,$4,'916372506476','0',12) j", [agent, chat, crypto.randomUUID(), org])).rows[0].j;
  await db.query("select crm_finish_whatsapp_reply($1,'accepted','gs-1',12)", [reply.id]);

  const ctx = (await db.query("select crm_lead_insight_context($1,$2) c", [agent, chat])).rows[0].c;
  assert.equal(ctx.lead_id, lead);
  assert.equal(ctx.business, "Sunrise Realty");
  assert.deepEqual(ctx.messages.map((m) => m.from).sort(), ["business", "customer"]);

  const save = (service, value, details = {}) =>
    db.query("select crm_save_lead_insight($1,$2,$3,now(),'hot','Ready to visit','Wants 2BHK',$4,$5,$6,$7)", [
      org, lead, chat, JSON.stringify(details), JSON.stringify(["Visit Saturday?"]), service, value,
    ]);
  await save("2BHK in Whitefield", 8000000, { budget: "80 lakh" });
  let row = (await db.query("select service,value from crm_leads where id=$1", [lead])).rows[0];
  assert.deepEqual({ service: row.service, value: Number(row.value) }, { service: "2BHK in Whitefield", value: 8000000 });
  // Later insights never overwrite what's already filled in.
  await save("3BHK in HSR", 9000000);
  row = (await db.query("select service,value from crm_leads where id=$1", [lead])).rows[0];
  assert.deepEqual({ service: row.service, value: Number(row.value) }, { service: "2BHK in Whitefield", value: 8000000 });
  assert.equal((await db.query("select count(*)::int n from crm_lead_insights")).rows[0].n, 1);

  // The assigned agent and the owner can read it; a teammate can't while leads are private.
  const read = async (user) => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    await db.exec("set role authenticated");
    return (await db.query("select score from crm_lead_insights")).rows.length;
  };
  assert.equal(await read(agent), 1);
  assert.equal(await read(owner), 1);
  assert.equal(await read(other), 0);
  await assert.rejects(db.query("select crm_lead_insight_context($1,$2)", [other, chat]), /permission denied/);
});
