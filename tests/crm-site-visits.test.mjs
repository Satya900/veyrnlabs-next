import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("site visits: scheduling, WhatsApp reminders, feedback and calendar visits", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema public,auth to anon,authenticated,service_role;",
  );
  for (const file of (await readdir(new URL("../supabase/migrations/", import.meta.url))).filter((f) => f.endsWith(".sql")).sort())
    await db.exec(await readFile(new URL("../supabase/migrations/" + file, import.meta.url), "utf8"));
  const [owner, other] = [crypto.randomUUID(), crypto.randomUUID()];
  for (const id of [owner, other]) await db.query("insert into auth.users values($1,$2,now())", [id, `${id}@example.com`]);
  const login = async (id = "", role = "authenticated") => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec(`set role ${role}`);
  };
  const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
  await login("", "service_role");
  const org = (await one("select crm_provision_organization($1,'Sunrise Realty','Owner') id", [owner])).id;
  await db.query("select crm_provision_organization($1,'Other Realty','Other')", [other]);
  await db.query("insert into crm_subscriptions(organization_id,plan,billing_months,active) values($1,'pro',1,true)", [org]);
  await db.query("select crm_open_usage_period($1,'pro',1,now()-interval '1 day',now()+interval '27 days',10000,5,20)", [org]);
  await db.query(
    "insert into crm_whatsapp_connections(organization_id,waba_id,phone_number_id,display_phone,active,provider,provider_app,callback_token) values($1,'0','919000000000','+919000000000',true,'gupshup','SunriseApp',$2)",
    [org, "a".repeat(64)],
  );
  const project = (await one("insert into crm_projects(organization_id,name) values($1,'Sunrise Lakeside') returning id", [org])).id;
  const stage = (await one("select id from crm_stages where organization_id=$1 and kind='open' limit 1", [org])).id;
  const lead = (await one(
    "insert into crm_leads(organization_id,name,phone,stage_id,owner_id,project_id) values($1,'Priya Sharma','98765 43210',$2,$3,$4) returning id",
    [org, stage, owner, project],
  )).id;

  // Templates can be filled with visit details; unknown fields are still refused.
  const reminder = (await one(
    "insert into crm_whatsapp_templates(organization_id,label,provider_template_id,body,params) values($1,'Visit reminder','visit_reminder','Hi {{1}}, a reminder of your site visit to {{2}} on {{3}} at {{4}}.',array['lead_first_name','project_name','visit_date','visit_time']) returning id",
    [org],
  )).id;
  const feedback = (await one(
    "insert into crm_whatsapp_templates(organization_id,label,provider_template_id,body,params) values($1,'Visit feedback','visit_feedback','Hi {{1}}, how was your visit to {{2}}?',array['lead_first_name','project_name']) returning id",
    [org],
  )).id;
  await assert.rejects(
    db.query("insert into crm_whatsapp_templates(organization_id,label,provider_template_id,body,params) values($1,'Bad','bad','{{1}}',array['bogus'])", [org]),
    /check constraint/,
  );
  await db.query(
    "insert into crm_whatsapp_followup_settings(organization_id,visit_reminder_template_id,visit_feedback_template_id) values($1,$2,$3)",
    [org, reminder, feedback],
  );

  // When each message is due, in IST.
  const due = async (startsIst, kind) =>
    (await one("select to_char(crm_visit_message_due(($1||' Asia/Kolkata')::timestamptz,$2) at time zone 'Asia/Kolkata','YYYY-MM-DD HH24:MI') d", [startsIst, kind])).d;
  assert.equal(await due("2026-12-10 10:30", "day"), "2026-12-09 18:00");
  assert.equal(await due("2026-12-10 10:30", "soon"), "2026-12-10 08:30");
  assert.equal(await due("2026-12-10 10:30", "feedback"), "2026-12-10 13:30");
  assert.equal(await due("2026-12-10 19:00", "feedback"), "2026-12-11 10:00");
  assert.equal(await due("2026-12-10 05:00", "feedback"), "2026-12-10 10:00");

  // The owner schedules a visit; past times are refused; the lead's history says so.
  await login(owner);
  await assert.rejects(db.query("select crm_schedule_visit($1,now()-interval '1 hour',$2,'')", [lead, project]), /future date/);
  const visit = (await one("select crm_schedule_visit($1,now()+interval '30 hours',$2,'Bring ID') id", [lead, project])).id;
  assert.equal((await one("select count(*)::int n from crm_site_visits")).n, 1);
  await login(other);
  assert.equal((await one("select count(*)::int n from crm_site_visits")).n, 0);
  await assert.rejects(db.query("select crm_schedule_visit($1,now()+interval '1 day',null,'')", [lead]), /Lead unavailable/);
  await login("", "service_role");
  assert.match((await one("select body from crm_activities where lead_id=$1 and kind='meeting' order by created_at desc limit 1", [lead])).body, /^Site visit scheduled for .+ IST at Sunrise Lakeside\.$/);

  // 2 hours before: the reminder is claimed once, rendered with the visit's details.
  await db.query("update crm_site_visits set starts_at=now()+interval '90 minutes', created_at=now()-interval '2 days' where id=$1", [visit]);
  const claim = async () => (await one("select crm_claim_visit_message(50) c")).c;
  const soon = await claim();
  assert.equal(soon.run, true);
  assert.equal(soon.recipient, "919876543210");
  assert.equal(soon.template, "visit_reminder");
  assert.equal(soon.params[0], "Priya");
  assert.equal(soon.params[1], "Sunrise Lakeside");
  assert.match(soon.body, /^Hi Priya, a reminder of your site visit to Sunrise Lakeside on \d{1,2} \w{3} at \d{1,2}:\d{2} [AP]M\.$/);
  assert.equal((await one("select visit_kind from crm_whatsapp_followup_jobs where id=$1", [soon.job])).visit_kind, "soon");
  assert.equal(await claim(), null);
  await db.query("select crm_end_whatsapp_followup($1,$2,'sent','ok')", [soon.job, soon.token]);
  assert.equal((await one("select body from crm_activities where lead_id=$1 order by created_at desc limit 1", [lead])).body, "Site visit reminder sent (Visit reminder).");

  // A rescheduled visit gets fresh reminders; a cancelled one gets none.
  await login(owner);
  await db.query("select crm_update_visit($1,'scheduled',now()+interval '100 minutes')", [visit]);
  await login("", "service_role");
  await db.query("update crm_site_visits set created_at=now()-interval '2 days' where id=$1", [visit]);
  const again = await claim();
  assert.equal(again.run, true);
  await db.query("select crm_end_whatsapp_followup($1,$2,'sent','ok')", [again.job, again.token]);
  await login(owner);
  await db.query("select crm_update_visit($1,'cancelled')", [visit]);
  await db.query("select crm_update_visit($1,'scheduled',now()+interval '110 minutes')", [visit]);
  await db.query("select crm_update_visit($1,'cancelled')", [visit]);
  await login("", "service_role");
  await db.query("update crm_site_visits set created_at=now()-interval '2 days' where id=$1", [visit]);
  assert.equal(await claim(), null);

  // After the visit: "how was it?", and the customer's reply is saved as feedback.
  await login(owner);
  const past = (await one("select crm_schedule_visit($1,now()+interval '1 hour',$2,'') id", [lead, project])).id;
  await login("", "service_role");
  let start = null;
  for (let k = 6; k < 54 && !start; k++) {
    const row = await one(
      "select now()-make_interval(mins=>$1*30) s, crm_visit_message_due(now()-make_interval(mins=>$1*30),'feedback') between now()-interval '23 hours' and now() ok",
      [k],
    );
    if (row.ok) start = row.s;
  }
  await db.query("update crm_site_visits set starts_at=$1, status='done' where id=$2", [start, past]);
  const ask = await claim();
  assert.equal(ask.run, true);
  assert.equal(ask.template, "visit_feedback");
  assert.equal(ask.body, "Hi Priya, how was your visit to Sunrise Lakeside?");
  await db.query("select crm_end_whatsapp_followup($1,$2,'sent','ok')", [ask.job, ask.token]);
  assert.equal((await one("select body from crm_activities where lead_id=$1 order by created_at desc limit 1", [lead])).body, "Site visit feedback request sent (Visit feedback).");
  await db.query("select crm_receive_whatsapp($1::jsonb)", [JSON.stringify([{ waba_id: "0", phone_number_id: "919000000000", message_id: "wamid.fb1", sender: "919876543210", contact_name: "Priya", message_type: "text", body: "Loved the clubhouse, price is a bit high", sent_at: new Date().toISOString() }])]);
  assert.equal((await one("select feedback from crm_site_visits where id=$1", [past])).feedback, "Loved the clubhouse, price is a bit high");
  assert.ok((await one("select count(*)::int n from crm_activities where lead_id=$1 and body='Site visit feedback: Loved the clubhouse, price is a bit high'", [lead])).n === 1);
  // Only the first reply is the feedback.
  await db.query("select crm_receive_whatsapp($1::jsonb)", [JSON.stringify([{ waba_id: "0", phone_number_id: "919000000000", message_id: "wamid.fb2", sender: "919876543210", contact_name: "Priya", message_type: "text", body: "Also, is parking included?", sent_at: new Date().toISOString() }])]);
  assert.equal((await one("select feedback from crm_site_visits where id=$1", [past])).feedback, "Loved the clubhouse, price is a bit high");

  // Visits booked through Google Calendar become site visits, and follow its cancellation.
  const booking = (await one(
    "insert into crm_calendar_bookings(organization_id,lead_id,member_id,starts_at,ends_at,status,event_id) values($1,$2,$3,now()+interval '3 days',now()+interval '3 days 30 minutes','booked','evt1') returning id",
    [org, lead, owner],
  )).id;
  const calendarVisit = await one("select id,status,project_id from crm_site_visits where booking_id=$1", [booking]);
  assert.equal(calendarVisit.status, "scheduled");
  assert.equal(calendarVisit.project_id, project);
  await login(owner);
  await assert.rejects(db.query("select crm_update_visit($1,'cancelled')", [calendarVisit.id]), /Google Calendar/);
  await db.query("select crm_update_visit($1,'done')", [calendarVisit.id]);
  await login("", "service_role");
  await db.query("update crm_calendar_bookings set status='cancelled' where id=$1", [booking]);
  assert.equal((await one("select status from crm_site_visits where id=$1", [calendarVisit.id])).status, "done");
});
