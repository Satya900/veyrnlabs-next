import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { processAutoReply } from "../src/lib/crm/auto-worker.ts";
test("worker never sends uncertain or human-required replies and never retries Meta", async () => {
  const env = {
    CRM_AUTO_REPLIES_ENABLED: "true",
    CRM_AI_ENABLED: "true",
    CRM_AI_PROVIDER: "groq",
    GROQ_API_KEY: "offline",
    CRM_AI_MODEL: "openai/gpt-oss-120b",
    CRM_AI_INPUT_PAISE_PER_MILLION: "2000",
    CRM_AI_OUTPUT_PAISE_PER_MILLION: "8000",
    WHATSAPP_SEND_ENABLED: "true",
    WHATSAPP_ACCESS_TOKEN: "offline",
    WHATSAPP_SEND_ORGANIZATION_ID: crypto.randomUUID(),
    WHATSAPP_SEND_PHONE_ID: "222",
    WHATSAPP_SEND_WABA_ID: "111",
    WHATSAPP_REPLY_COST_PAISE: "100",
  };
  assert.equal(
    (
      await processAutoReply(
        { ...env, CRM_AUTO_REPLIES_ENABLED: "false" },
        () => {
          throw new Error("Must not run");
        },
      )
    ).status,
    "disabled",
  );
  for (const scenario of [
    "human",
    "malformed",
    "timeout",
    "success",
    "uncertain-send",
  ]) {
    const calls = [];
    let meta = 0;
    const rpc = async (name, args) => {
      calls.push({ name, args });
      return {
        error: null,
        data:
          name === "crm_claim_auto_reply"
            ? { id: "job", token: "claim" }
            : name === "crm_start_auto_reply"
              ? {
                  id: "draft",
                  run: true,
                  knowledge: "Fictional company facts",
                  history: [{ text: "Looking for an apartment" }],
                }
              : name === "crm_prepare_auto_reply"
                ? {
                    id: "outbox",
                    run: true,
                    phone: "222",
                    recipient: "919111111111",
                    body: "Which location?",
                  }
                : null,
      };
    };
    const request = async (url) => {
      if (url.includes("graph.facebook")) {
        meta++;
        if (scenario === "uncertain-send") throw new Error("timeout");
        return Response.json({ messages: [{ id: "wamid.test" }] });
      }
      if (scenario === "timeout") throw new Error("timeout");
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content:
                scenario === "malformed"
                  ? "bad json"
                  : JSON.stringify({
                      reply: "Which location?",
                      needs_human: scenario === "human",
                      reason: "Qualify",
                      booking_request: { requested: false, date: "", time: "" },
                    }),
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 10 },
      });
    };
    const result = await processAutoReply(env, rpc, request);
    assert.equal(
      meta,
      ["success", "uncertain-send"].includes(scenario) ? 1 : 0,
    );
    assert.equal(
      result.status,
      scenario === "success"
        ? "accepted"
        : scenario === "uncertain-send"
          ? "unknown"
          : scenario === "timeout"
            ? "failed"
            : "needs_human",
    );
    if (scenario === "timeout")
      assert.equal(
        calls.find((c) => c.name === "crm_finish_ai_draft").args.actual_cost,
        null,
      );
  }
});
test("worker auto-books a clean, available slot and hands off busy, ambiguous or ineligible ones", async () => {
  const { encryptCalendarToken } = await import("../src/lib/crm/calendar-crypto.ts");
  const calendarEnv = {
    GOOGLE_CALENDAR_CLIENT_ID: "client",
    GOOGLE_CALENDAR_CLIENT_SECRET: "secret",
    CRM_CALENDAR_TOKEN_KEY:
      "32d80a02527971dca689b65277bc3827361f1a5386b0e199edf97af01c9097a4",
  };
  const env = {
    CRM_AUTO_REPLIES_ENABLED: "true",
    CRM_AI_ENABLED: "true",
    CRM_AI_PROVIDER: "groq",
    GROQ_API_KEY: "offline",
    CRM_AI_MODEL: "openai/gpt-oss-120b",
    CRM_AI_INPUT_PAISE_PER_MILLION: "2000",
    CRM_AI_OUTPUT_PAISE_PER_MILLION: "8000",
    WHATSAPP_SEND_ENABLED: "true",
    WHATSAPP_ACCESS_TOKEN: "offline",
    WHATSAPP_SEND_ORGANIZATION_ID: crypto.randomUUID(),
    WHATSAPP_SEND_PHONE_ID: "222",
    WHATSAPP_SEND_WABA_ID: "111",
    WHATSAPP_REPLY_COST_PAISE: "100",
    ...calendarEnv,
  };
  const encryptedToken = encryptCalendarToken(calendarEnv, "refresh-token");
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toLocaleDateString(
    "en-CA",
    { timeZone: "Asia/Kolkata" },
  );
  for (const scenario of ["booked", "busy", "ambiguous", "ineligible"]) {
    const calls = [];
    const rpc = async (name, args) => {
      calls.push({ name, args });
      if (name === "crm_claim_auto_reply")
        return { error: null, data: { id: "job", token: "claim" } };
      if (name === "crm_start_auto_reply")
        return {
          error: null,
          data: {
            id: "draft",
            run: true,
            knowledge: "facts",
            history: [{ text: "Book me a visit" }],
          },
        };
      if (name === "crm_prepare_auto_booking") {
        if (scenario === "ineligible")
          return {
            error: { message: "The assigned agent has not connected a calendar" },
            data: null,
          };
        return {
          error: null,
          data: {
            run: true,
            calendar_id: "primary",
            refresh_token_encrypted: encryptedToken,
            lead_name: "Test Lead",
            lead_company: "",
            lead_email: "",
          },
        };
      }
      if (name === "crm_finish_auto_booking") return { error: null, data: null };
      if (name === "crm_prepare_auto_reply")
        return {
          error: null,
          data: {
            id: "outbox",
            run: true,
            phone: "222",
            recipient: "919111111111",
            body: "You're all set...",
          },
        };
      return { error: null, data: null };
    };
    let metaCalls = 0;
    const request = async (url) => {
      const u = String(url);
      if (u.includes("oauth2.googleapis.com/token"))
        return Response.json({ access_token: "gtoken", expires_in: 3600 });
      if (u.includes("freeBusy"))
        return Response.json({
          calendars: {
            primary: {
              busy:
                scenario === "busy"
                  ? [
                      {
                        start: `${tomorrow}T05:00:00.000Z`,
                        end: `${tomorrow}T06:00:00.000Z`,
                      },
                    ]
                  : [],
            },
          },
        });
      if (u.includes("/events"))
        return Response.json({
          id: "evt_1",
          htmlLink: "https://calendar.google.com/evt_1",
        });
      if (u.includes("graph.facebook")) {
        metaCalls++;
        return Response.json({ messages: [{ id: "wamid.test" }] });
      }
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                reply: "Let me check that for you.",
                needs_human: false,
                reason: "Scheduling",
                booking_request:
                  scenario === "ambiguous"
                    ? { requested: true, date: "", time: "" }
                    : { requested: true, date: tomorrow, time: "11:00" },
              }),
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 10 },
      });
    };
    const result = await processAutoReply(env, rpc, request);
    const finishDraft = calls.find((c) => c.name === "crm_finish_ai_draft");
    if (scenario === "booked") {
      assert.equal(result.status, "accepted");
      assert.equal(metaCalls, 1);
      assert.match(finishDraft.args.answer, /booked/i);
      assert.equal(finishDraft.args.human_required, false);
      assert.ok(finishDraft.args.proposed_at);
      assert.ok(
        calls.some(
          (c) => c.name === "crm_finish_auto_booking" && c.args.outcome === "booked",
        ),
      );
    } else {
      assert.equal(result.status, "needs_human");
      assert.equal(metaCalls, 0);
      assert.equal(finishDraft.args.human_required, true);
      if (scenario === "busy")
        assert.ok(
          calls.some(
            (c) =>
              c.name === "crm_finish_auto_booking" && c.args.outcome === "unavailable",
          ),
        );
      if (scenario === "ambiguous") assert.equal(finishDraft.args.proposed_at, null);
    }
  }
});
test("crm_prepare_auto_booking and crm_finish_auto_booking enforce entitlement, ownership, calendar connection and idempotency", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema public,auth to anon,authenticated,service_role;",
  );
  for (const file of (
    await readdir(new URL("../supabase/migrations/", import.meta.url))
  )
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(
      await readFile(
        new URL("../supabase/migrations/" + file, import.meta.url),
        "utf8",
      ),
    );
  const owner = crypto.randomUUID(),
    agent = crypto.randomUUID();
  for (const id of [owner, agent])
    await db.query("insert into auth.users values($1,$2,now())", [
      id,
      id + "@example.test",
    ]);
  const login = async (id = "", role = "authenticated") => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec(`set role ${role}`);
  };
  await login("", "service_role");
  const org = (
    await db.query(
      "select crm_provision_organization($1,'Company','Owner') id",
      [owner],
    )
  ).rows[0].id;
  await db.query(
    "select crm_open_usage_period($1,'pro_plus',1,now(),now()+interval '1 month',50000,100,50,0)",
    [org],
  );
  await db.query(
    "insert into crm_members(id,name,role,organization_id) values($1,'Agent','team',$2)",
    [agent, org],
  );
  await db.query(
    "insert into crm_whatsapp_connections(organization_id,waba_id,phone_number_id,display_phone,active)values($1,'111','222','Test',true)",
    [org],
  );
  let seq = 0;
  const incoming = async (body = "Book a visit") =>
    db.query("select crm_receive_whatsapp($1::jsonb)", [
      JSON.stringify([
        {
          waba_id: "111",
          phone_number_id: "222",
          message_id: "m-" + ++seq,
          sender: "919111111111",
          contact_name: "Test",
          message_type: "text",
          body,
          sent_at: new Date(Date.now() + seq * 1000).toISOString(),
        },
      ]),
    ]);
  await incoming();
  const chat = (
    await db.query("select id,lead_id from crm_whatsapp_conversations")
  ).rows[0];
  await login(owner);
  await db.query(
    "select crm_save_ai_settings('Facts about the company for AI testing purposes.',true)",
  );
  await db.query("select crm_set_auto_replies(true)");
  await login("", "service_role");
  const claim = async () =>
    (await db.query("select crm_claim_auto_reply($1) j", [org])).rows[0].j;
  const start = async (j) =>
    (
      await db.query("select crm_start_auto_reply($1,$2,'model',100) j", [
        j.id,
        j.token,
      ])
    ).rows[0].j;
  const start_iso = new Date(Date.now() + 3600_000).toISOString();
  const end_iso = new Date(Date.now() + 3600_000 + 30 * 60_000).toISOString();
  const prepare = (j) =>
    db.query(
      "select crm_prepare_auto_booking($1,$2,$3,$4) r",
      [j.id, j.token, start_iso, end_iso],
    );
  await t.test(
    "an unassigned lead is rejected before checking anything about a calendar",
    async () => {
      await incoming();
      const j = await claim();
      await start(j);
      await assert.rejects(prepare(j), /Assign this lead to an agent/);
      // Release the job (without pausing the conversation) so the next sub-test's claim
      // for this same conversation is not blocked by a job stuck in 'processing'.
      await db.query("select crm_end_auto_reply($1,$2,'skipped','test cleanup')", [
        j.id,
        j.token,
      ]);
    },
  );
  await t.test(
    "an assigned agent with no connected calendar is rejected distinctly",
    async () => {
      await login("", "service_role");
      await db.query("update crm_leads set owner_id=$1 where id=$2", [
        agent,
        chat.lead_id,
      ]);
      await incoming();
      const j = await claim();
      await start(j);
      await assert.rejects(prepare(j), /has not connected a calendar/);
      await db.query("select crm_end_auto_reply($1,$2,'skipped','test cleanup')", [
        j.id,
        j.token,
      ]);
    },
  );
  await t.test(
    "a clean prepare reserves the draft against a double booking attempt",
    async () => {
      await login("", "service_role");
      await db.query(
        "insert into crm_calendar_connections(member_id,organization_id,calendar_id,refresh_token_encrypted) values($1,$2,'primary','enc')",
        [agent, org],
      );
      await incoming();
      const j = await claim();
      const started = await start(j);
      const result = (await prepare(j)).rows[0].r;
      assert.equal(result.run, true);
      assert.equal(result.calendar_id, "primary");
      assert.equal(result.refresh_token_encrypted, "enc");
      assert.equal(
        (
          await db.query("select booking_status from crm_ai_drafts where id=$1", [
            started.id,
          ])
        ).rows[0].booking_status,
        "attempted",
      );
      assert.equal((await prepare(j)).rows[0].r.run, false);
      await db.query(
        "select crm_finish_auto_booking($1,$2,'booked',$3)",
        [j.id, j.token, start_iso],
      );
      assert.equal(
        (
          await db.query("select booking_status from crm_ai_drafts where id=$1", [
            started.id,
          ])
        ).rows[0].booking_status,
        "booked",
      );
      assert.equal(
        (
          await db.query("select follow_up from crm_leads where id=$1", [
            chat.lead_id,
          ])
        ).rows[0].follow_up.toISOString(),
        start_iso,
      );
      assert.equal(
        (
          await db.query(
            "select count(*)::int n from crm_activities where lead_id=$1 and kind='meeting'",
            [chat.lead_id],
          )
        ).rows[0].n,
        1,
      );
      // Finishing an already-terminal booking a second time (idempotent retry) is a no-op,
      // not a second activity entry or a thrown error.
      await db.query(
        "select crm_finish_auto_booking($1,$2,'booked',$3)",
        [j.id, j.token, start_iso],
      );
      assert.equal(
        (
          await db.query(
            "select count(*)::int n from crm_activities where lead_id=$1 and kind='meeting'",
            [chat.lead_id],
          )
        ).rows[0].n,
        1,
      );
    },
  );
});
test("automatic jobs require opt-in and revalidate takeover, knowledge, ownership and quotas", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema public,auth to anon,authenticated,service_role;",
  );
  for (const file of (
    await readdir(new URL("../supabase/migrations/", import.meta.url))
  )
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(
      await readFile(
        new URL("../supabase/migrations/" + file, import.meta.url),
        "utf8",
      ),
    );
  const owner = crypto.randomUUID(),
    other = crypto.randomUUID();
  for (const id of [owner, other])
    await db.query("insert into auth.users values($1,$2,now())", [
      id,
      id + "@example.test",
    ]);
  const org = (
    await db.query(
      "select crm_provision_organization($1,'Company','Owner') id",
      [owner],
    )
  ).rows[0].id;
  const otherOrg = (
    await db.query("select crm_provision_organization($1,'Other','Owner') id", [
      other,
    ])
  ).rows[0].id;
  await db.query(
    "insert into crm_whatsapp_connections(organization_id,waba_id,phone_number_id,display_phone,active)values($1,'111','222','Test',true)",
    [org],
  );
  await db.query("select crm_open_ai_trial($1)", [org]);
  await db.query("select crm_enable_trial_replies($1)", [org]);
  const login = async (id) => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec("set role authenticated");
  };
  await login(owner);
  await db.query(
    "select crm_save_ai_settings('Fictional company facts for testing.',true)",
  );
  await db.exec("reset role");
  let seq = 0;
  const incoming = async (body = "Looking for an apartment") =>
    db.query("select crm_receive_whatsapp($1::jsonb)", [
      JSON.stringify([
        {
          waba_id: "111",
          phone_number_id: "222",
          message_id: "m-" + ++seq,
          sender: "919111111111",
          contact_name: "Test",
          message_type: "text",
          body,
          sent_at: new Date(Date.now() + seq * 1000).toISOString(),
        },
      ]),
    ]);
  await incoming();
  assert.equal(
    (await db.query("select count(*)::int n from crm_auto_jobs")).rows[0].n,
    0,
  );
  const chat = (await db.query("select id from crm_whatsapp_conversations"))
    .rows[0].id;
  await login(owner);
  await db.query("select crm_set_auto_replies(true)");
  await db.exec("reset role");
  await incoming();
  await incoming();
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from crm_auto_jobs where status='queued'",
      )
    ).rows[0].n,
    1,
  );
  const claim = async (o = org) =>
    (await db.query("select crm_claim_auto_reply($1) j", [o])).rows[0].j;
  const start = async (j) =>
    (
      await db.query("select crm_start_auto_reply($1,$2,'model',100) j", [
        j.id,
        j.token,
      ])
    ).rows[0].j;
  const prepare = async (j) =>
    (
      await db.query(
        "select crm_prepare_auto_reply($1,$2,$3,'222','111',100) j",
        [j.id, j.token, org],
      )
    ).rows[0].j;
  const end = (j, outcome = "complete") =>
    db.query("select crm_end_auto_reply($1,$2,$3,'Test outcome')", [
      j.id,
      j.token,
      outcome,
    ]);
  assert.equal(await claim(otherOrg), null);
  let j = await claim();
  assert.equal(await claim(), null);
  const d = await start(j);
  assert.equal(d.run, true);
  await db.query(
    "select crm_finish_ai_draft($1,'What is your budget?',false,'Qualify',1)",
    [d.id],
  );
  await login(owner);
  await db.query("select crm_set_ai_handover($1,true)", [chat]);
  await db.exec("reset role");
  await assert.rejects(prepare(j), /takeover/);
  await end(j, "needs_human");
  await incoming();
  assert.equal(await claim(), null);
  await login(owner);
  await db.query("select crm_set_ai_handover($1,false)", [chat]);
  await db.exec("reset role");
  await incoming();
  j = await claim();
  const d2 = await start(j);
  await db.query(
    "select crm_finish_ai_draft($1,'What is your budget?',false,'Qualify',1)",
    [d2.id],
  );
  await login(owner);
  await db.query(
    "select crm_save_ai_settings('Changed company facts for testing.',true)",
  );
  await db.exec("reset role");
  await assert.rejects(prepare(j), /settings changed/);
  await end(j, "skipped");
  await incoming();
  j = await claim();
  const d3 = await start(j);
  await db.query(
    "select crm_finish_ai_draft($1,'What is your budget?',false,'Qualify',1)",
    [d3.id],
  );
  const sent = await prepare(j);
  assert.equal(sent.run, true);
  assert.equal((await prepare(j)).run, false);
  assert.equal(
    (
      await db.query("select origin from crm_whatsapp_outbox where id=$1", [
        sent.id,
      ])
    ).rows[0].origin,
    "automatic",
  );
  await db.query(
    "select crm_finish_whatsapp_reply($1,'accepted','receipt-id',100)",
    [sent.id],
  );
  await end(j);
  await incoming();
  j = await claim();
  const d4 = await start(j);
  assert.ok(d4.history.some((m) => m.text.startsWith("Assistant:")));
  await end(j, "failed");
  await login(owner);
  await db.query("select crm_set_ai_handover($1,false)", [chat]);
  await db.exec("reset role");
  await incoming();
  j = await claim();
  await db.query(
    "update crm_auto_jobs set claimed_at=now()-interval '6 minutes' where id=$1",
    [j.id],
  );
  assert.equal(await claim(), null);
  assert.equal(
    (await db.query("select status from crm_auto_jobs where id=$1", [j.id]))
      .rows[0].status,
    "failed",
  );
  await login(other);
  assert.equal((await db.query("select id from crm_auto_jobs")).rows.length, 0);
  await assert.rejects(
    db.query("select crm_claim_auto_reply($1)", [org]),
    /permission denied/,
  );
  await db.exec("reset role");
  await login(owner);
  await db.query("select crm_set_auto_replies(false)");
  await db.query("select crm_set_ai_handover($1,false)", [chat]);
  await db.exec("reset role");
  await incoming("Please let me speak to a human");
  assert.equal(
    (
      await db.query(
        "select ai_paused from crm_whatsapp_conversations where id=$1",
        [chat],
      )
    ).rows[0].ai_paused,
    true,
  );
});
