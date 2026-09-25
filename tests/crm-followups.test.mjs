import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

async function freshDb(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema public,auth to anon,authenticated,service_role;",
  );
  for (const f of (
    await readdir(new URL("../supabase/migrations/", import.meta.url))
  )
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(
      await readFile(
        new URL("../supabase/migrations/" + f, import.meta.url),
        "utf8",
      ),
    );
  return db;
}

test("automated follow-ups: eligibility, drafting, dispatch and settlement", async (t) => {
  const db = await freshDb(t);
  const owner = crypto.randomUUID();
  await db.query("insert into auth.users values($1,$2,now())", [
    owner,
    owner + "@example.test",
  ]);
  const org = (
    await db.query("select crm_provision_organization($1,'Test','Owner') id", [
      owner,
    ])
  ).rows[0].id;
  const stageOpen = (
    await db.query(
      "select id from crm_stages where organization_id=$1 and kind='open' order by position limit 1",
      [org],
    )
  ).rows[0].id;
  const stageWon = (
    await db.query(
      "select id from crm_stages where organization_id=$1 and kind='won' limit 1",
      [org],
    )
  ).rows[0].id;

  // Enabling before knowledge/allowance exist must fail.
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner,
  ]);
  await assert.rejects(db.query("select crm_set_followups(true)"), /knowledge/);
  await db.query(
    "insert into crm_ai_settings(organization_id,knowledge,drafts_enabled) values($1,'Fictional company information for drafting outreach.',true)",
    [org],
  );
  await assert.rejects(db.query("select crm_set_followups(true)"), /allowance/);
  await db.query(
    "select crm_open_usage_period($1,'pro_plus',1,now(),now()+interval '28 days',100,25,3)",
    [org],
  );
  await db.query("select crm_set_followups(true)");
  assert.equal(
    (
      await db.query(
        "select followup_enabled,followup_actor from crm_ai_settings where organization_id=$1",
        [org],
      )
    ).rows[0].followup_enabled,
    true,
  );

  async function makeLead(overrides = {}) {
    const row = {
      name: "Lead " + crypto.randomUUID().slice(0, 8),
      phone: "9111111111",
      email: "lead@example.test",
      stage_id: stageOpen,
      follow_up: "now() - interval '1 hour'",
      ...overrides,
    };
    const { rows } = await db.query(
      `insert into crm_leads(organization_id,name,phone,email,stage_id,follow_up)
       values($1,$2,$3,$4,$5,${row.follow_up}) returning id`,
      [org, row.name, row.phone, row.email, row.stage_id],
    );
    return rows[0].id;
  }

  // Ineligible leads: future follow-up, wrong stage, no contact info, activity since follow-up.
  await makeLead({ follow_up: "now() + interval '1 hour'" });
  await makeLead({ stage_id: stageWon });
  await makeLead({ phone: "", email: "" });
  const contactedLead = await makeLead();
  await db.query(
    "insert into crm_activities(organization_id,lead_id,body,kind) values($1,$2,'Called them','call')",
    [org, contactedLead],
  );

  const dueLead = await makeLead();
  const claim = (
    await db.query("select crm_claim_followup($1) j", [100])
  ).rows[0].j;
  assert.equal(claim.lead.name, (await db.query("select name from crm_leads where id=$1", [dueLead])).rows[0].name);
  assert.equal(claim.lead.phone, "9111111111");

  // No second lead is eligible right now; claiming again returns null.
  assert.equal(
    (await db.query("select crm_claim_followup($1) j", [100])).rows[0].j,
    null,
  );
  // The same lead's follow-up value cannot be claimed twice even after the job completes.
  await db.query(
    "select crm_finish_followup_draft($1,$2,'SMS body','Subject','Email body','Nudge sent',5)",
    [claim.id, claim.token],
  );
  await db.query("select crm_end_followup($1,$2,'complete','Both channels attempted')", [
    claim.id,
    claim.token,
  ]);
  assert.equal(
    (await db.query("select crm_claim_followup($1) j", [100])).rows[0].j,
    null,
  );

  // A new follow-up value on the same lead is claimable again.
  await db.query(
    "update crm_leads set follow_up=now()-interval '1 minute' where id=$1",
    [dueLead],
  );
  const second = (
    await db.query("select crm_claim_followup($1) j", [100])
  ).rows[0].j;
  assert.ok(second.id !== claim.id);

  // Draft + dispatch flow: prepare send for sms and email, then settle each outcome.
  await db.query(
    "select crm_finish_followup_draft($1,$2,'Hi there, still interested?','Following up','Full email body here.','Routine nudge',7)",
    [second.id, second.token],
  );
  const smsSend = (
    await db.query(
      "select crm_prepare_followup_send($1,$2,'sms',20) j",
      [second.id, second.token],
    )
  ).rows[0].j;
  assert.equal(smsSend.run, true);
  assert.equal(smsSend.body, "Hi there, still interested?");
  const emailSend = (
    await db.query(
      "select crm_prepare_followup_send($1,$2,'email',1) j",
      [second.id, second.token],
    )
  ).rows[0].j;
  assert.equal(emailSend.subject, "Following up");
  // A channel already dispatched for this job cannot be prepared again.
  assert.equal(
    (
      await db.query("select crm_prepare_followup_send($1,$2,'sms',20) j", [
        second.id,
        second.token,
      ])
    ).rows[0].j.run,
    false,
  );

  await db.query(
    "select crm_finish_followup_send($1,$2,'accepted','provider-sms-1',20)",
    [smsSend.id, second.token],
  );
  await db.query(
    "select crm_finish_followup_send($1,$2,'rejected',null,1)",
    [emailSend.id, second.token],
  );
  const sends = (
    await db.query(
      "select channel,status from crm_followup_sends where job_id=$1 order by channel",
      [second.id],
    )
  ).rows;
  assert.deepEqual(sends, [
    { channel: "email", status: "rejected" },
    { channel: "sms", status: "accepted" },
  ]);
  // Rejected send cancels its reservation; accepted settles at actual cost.
  const usage = await db.query(
    "select kind,status,actual_paise from crm_usage_events where kind in ('sms','email') and organization_id=$1 order by kind",
    [org],
  );
  assert.deepEqual(
    usage.rows.map((r) => [r.kind, r.status, r.actual_paise]),
    [
      ["email", "cancelled", null],
      ["sms", "settled", 20],
    ],
  );
  await db.query("select crm_end_followup($1,$2,'complete','SMS delivered, email rejected')", [
    second.id,
    second.token,
  ]);

  // Replaying the same accepted outcome is a no-op; a genuinely different outcome is rejected.
  await db.query(
    "select crm_finish_followup_send($1,$2,'accepted','provider-sms-1',20)",
    [smsSend.id, second.token],
  );
  await assert.rejects(
    db.query("select crm_finish_followup_send($1,$2,'rejected',null,0)", [
      smsSend.id,
      second.token,
    ]),
    /already finalized/,
  );

  // Cross-tenant isolation: another organization cannot see these jobs.
  const stranger = crypto.randomUUID();
  await db.query("insert into auth.users values($1,$2,now())", [
    stranger,
    stranger + "@example.test",
  ]);
  await db.query("select crm_provision_organization($1,'Other','Owner')", [
    stranger,
  ]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    stranger,
  ]);
  await db.exec("set role authenticated");
  assert.equal(
    (await db.query("select id from crm_followup_jobs")).rows.length,
    0,
  );
  await db.exec("reset role");

  // A team member cannot enable follow-ups or read job history.
  const teamMember = crypto.randomUUID();
  await db.query("insert into auth.users values($1,$2,now())", [
    teamMember,
    teamMember + "@example.test",
  ]);
  await db.query(
    "insert into crm_members(id,name,role,organization_id) values($1,'Agent','team',$2)",
    [teamMember, org],
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    teamMember,
  ]);
  await db.exec("set role authenticated");
  await assert.rejects(db.query("select crm_set_followups(false)"), /Admin access/);
  assert.equal(
    (await db.query("select id from crm_followup_jobs")).rows.length,
    0,
  );
  await db.exec("reset role");

  // Owner can read job history (limited columns) once switched to their own session.
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner,
  ]);
  await db.exec("set role authenticated");
  const visible = await db.query(
    "select id,status,reason from crm_followup_jobs order by created_at",
  );
  assert.equal(visible.rows.length, 2);
  assert.equal(visible.rows[1].status, "complete");
  await db.exec("reset role");
});

test("maintenance function fails abandoned jobs and touches worker health", async (t) => {
  const db = await freshDb(t);
  const owner = crypto.randomUUID();
  await db.query("insert into auth.users values($1,$2,now())", [
    owner,
    owner + "@example.test",
  ]);
  const org = (
    await db.query("select crm_provision_organization($1,'Test','Owner') id", [
      owner,
    ])
  ).rows[0].id;
  const stage = (
    await db.query(
      "select id from crm_stages where organization_id=$1 and kind='open' order by position limit 1",
      [org],
    )
  ).rows[0].id;
  await db.query(
    "insert into crm_ai_settings(organization_id,knowledge,drafts_enabled) values($1,'Fictional company information for drafting outreach.',true)",
    [org],
  );
  await db.query(
    "select crm_open_usage_period($1,'pro_plus',1,now(),now()+interval '28 days',100,25,3)",
    [org],
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner,
  ]);
  await db.query("select crm_set_followups(true)");
  await db.query(
    "insert into crm_leads(organization_id,name,phone,email,stage_id,follow_up) values($1,'Stale lead','9111111111','stale@example.test',$2,now()-interval '1 hour')",
    [org, stage],
  );
  const claim = (
    await db.query("select crm_claim_followup($1) j", [100])
  ).rows[0].j;
  await db.query(
    "update crm_followup_jobs set created_at=now()-interval '10 minutes' where id=$1",
    [claim.id],
  );
  await db.query("select crm_followup_maintenance()");
  assert.equal(
    (
      await db.query("select status,reason from crm_followup_jobs where id=$1", [
        claim.id,
      ])
    ).rows[0].status,
    "failed",
  );
  const health = (
    await db.query(
      "select last_seen from crm_worker_health where id='followups'",
    )
  ).rows[0];
  assert.ok(health);
});
