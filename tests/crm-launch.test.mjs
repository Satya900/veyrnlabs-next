import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  parsePaidRazorpayEvent,
  createCheckoutSubscription,
} from "../src/lib/crm/razorpay.ts";
import { getFreeBusy } from "../src/lib/crm/google-calendar.ts";
import {
  connectWhatsApp,
  encryptWhatsAppToken,
  decryptWhatsAppToken,
} from "../src/lib/crm/whatsapp-connect.ts";

test("paid webhooks require captured payment identity and provider billing dates", () => {
  const event = {
    event: "subscription.charged",
    created_at: 1800000000,
    payload: {
      subscription: {
        entity: {
          id: "sub_a",
          status: "active",
          plan_id: "plan_a",
          current_start: 1800000000,
          current_end: 1802678400,
        },
      },
      payment: {
        entity: {
          id: "pay_a",
          amount: 400000,
          currency: "INR",
          status: "captured",
        },
      },
    },
  };
  assert.equal(parsePaidRazorpayEvent(event).paymentId, "pay_a");
  assert.throws(() =>
    parsePaidRazorpayEvent({
      ...event,
      payload: { subscription: event.payload.subscription },
    }),
  );
  event.payload.payment.entity.status = "authorized";
  assert.throws(() => parsePaidRazorpayEvent(event));
});
test("checkout refuses a mispriced provider plan before creating a subscription", async () => {
  let calls = 0;
  await assert.rejects(
    createCheckoutSubscription(
      {},
      "plan_x",
      1,
      3,
      1080000,
      "attempt",
      async () => {
        calls++;
        return Response.json({
          period: "monthly",
          interval: 3,
          item: { amount: 400000, currency: "INR" },
        });
      },
    ),
    /does not match/,
  );
  assert.equal(calls, 1);
});
test("freebusy fails closed when a calendar is missing or returns an individual error", async () => {
  for (const data of [
    {},
    { calendars: { primary: { errors: [{ reason: "notFound" }] } } },
  ])
    await assert.rejects(
      getFreeBusy("t", "primary", "a", "b", async () => Response.json(data)),
      /could not be verified/,
    );
});
test("WhatsApp token storage and Meta authorization reject mismatched assets", async () => {
  const env = {
    META_APP_ID: "123",
    META_WHATSAPP_CONFIG_ID: "456",
    WHATSAPP_APP_SECRET: "secret",
    CRM_WHATSAPP_TOKEN_KEY: "a".repeat(64),
  };
  const encrypted = encryptWhatsAppToken(env, "token");
  assert.equal(decryptWhatsAppToken(env, encrypted), "token");
  assert.throws(() =>
    decryptWhatsAppToken(
      { ...env, CRM_WHATSAPP_TOKEN_KEY: "b".repeat(64) },
      encrypted,
    ),
  );
  let mutations = 0;
  const request = async (url, init) => {
    if (init?.method === "POST") mutations++;
    if (url.includes("oauth/access_token"))
      return Response.json({ access_token: "token" });
    if (url.includes("debug_token"))
      return Response.json({
        data: {
          is_valid: true,
          app_id: "123",
          scopes: [
            "whatsapp_business_messaging",
            "whatsapp_business_management",
          ],
        },
      });
    return Response.json({
      data: [{ id: "wrong", display_phone_number: "123456789" }],
    });
  };
  await assert.rejects(
    connectWhatsApp(env, { code: "code", waba: "111", phone: "222" }, request),
    /not shared/,
  );
  assert.equal(mutations, 0);
});

test("launch migrations enforce prepaid continuity, paid seats, booking serialization and credential isolation", async (t) => {
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
      id + "@test.invalid",
    ]);
  const login = async (id = "", role = "authenticated") => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec(`set role ${role}`);
  };
  await login("", "service_role");
  const org = (
    await db.query(
      "select crm_provision_organization($1,'Agency','Owner') id",
      [owner],
    )
  ).rows[0].id;
  await db.query("select crm_provision_organization($1,'Other','Other')", [
    other,
  ]);
  await login(owner);
  const start = (
    await db.query("select crm_begin_checkout('base','pro_plus',3,1) j")
  ).rows[0].j;
  assert.equal(start.run, true);
  assert.equal(
    (await db.query("select crm_begin_checkout('base','pro_plus',3,1) j"))
      .rows[0].j.run,
    false,
  );
  await assert.rejects(
    db.query("select crm_start_subscription('pro',1,'fake','fake')"),
    /permission denied/,
  );
  await login("", "service_role");
  await db.query("select crm_finish_checkout($1,'sub_base','plan_base')", [
    start.id,
  ]);
  let n = 0;
  const event = (
    sub = "sub_base",
    plan = "plan_base",
    payment = "pay_base",
    amount = 1620000,
    months = 3,
  ) =>
    db.query(
      "select crm_apply_paid_event($1,$2,$3,'active',now(),$4,now()-interval '1 day',now()-interval '1 day'+make_interval(months=>$6),$5,'INR',50000,100,100)",
      [
        createHash("sha256").update(String(++n)).digest("hex"),
        sub,
        plan,
        payment,
        amount,
        months,
      ],
    );
  await assert.rejects(
    event("sub_base", "plan_base", "bad", 1),
    /amount mismatch/,
  );
  await event();
  await event();
  assert.equal(
    Number(
      (
        await db.query(
          "select count(*) from crm_usage_periods where organization_id=$1",
          [org],
        )
      ).rows[0].count,
    ),
    3,
  );
  const periods = (
    await db.query(
      "select starts_at,ends_at from crm_usage_periods where organization_id=$1 order by starts_at",
      [org],
    )
  ).rows;
  assert.equal(
    new Date(periods[0].ends_at).getTime(),
    new Date(periods[1].starts_at).getTime(),
  );
  assert.equal(
    new Date(periods[1].ends_at).getTime(),
    new Date(periods[2].starts_at).getTime(),
  );
  await login(owner);
  const seats = (
    await db.query("select crm_begin_checkout('seats',null,1,2) j")
  ).rows[0].j;
  await login("", "service_role");
  await db.query("select crm_finish_checkout($1,'sub_seats','plan_seats')", [
    seats.id,
  ]);
  await event("sub_seats", "plan_seats", "pay_seats", 100000, 1);
  assert.equal(
    (await db.query("select crm_paid_seats($1) n", [org])).rows[0].n,
    2,
  );
  await login(owner);
  assert.equal(
    (await db.query("select crm_usage_summary() j")).rows[0].j.purchased_seats,
    2,
  );
  await db.query("select crm_save_calendar_connection('primary','encrypted')");
  const stage = (await db.query("select id from crm_stages limit 1")).rows[0]
    .id;
  const leads = [];
  for (let i = 0; i < 2; i++)
    leads.push(
      (
        await db.query(
          "insert into crm_leads(name,owner_id,stage_id) values('Buyer',$1,$2) returning id",
          [owner, stage],
        )
      ).rows[0].id,
    );
  const reserve = (lead) =>
    db.query(
      "select crm_prepare_visit($1,date_trunc('hour',now())+interval '2 days',date_trunc('hour',now())+interval '2 days 30 minutes') j",
      [lead],
    );
  const reservation = (await reserve(leads[0])).rows[0].j;
  assert.equal(reservation.run, true);
  assert.equal((await reserve(leads[0])).rows[0].j.run, false);
  await assert.rejects(reserve(leads[1]), /already reserved/);
  await login(other);
  await assert.rejects(reserve(leads[0]), /unavailable|active subscription/i);
  await login("", "service_role");
  await db.query("select crm_complete_visit($1,'booked')", [
    reservation.booking_id,
  ]);
  await db.query("select crm_complete_visit($1,'booked')", [
    reservation.booking_id,
  ]);
  assert.equal(
    Number(
      (
        await db.query(
          "select count(*) from crm_activities where lead_id=$1 and kind='meeting'",
          [leads[0]],
        )
      ).rows[0].count,
    ),
    1,
  );
  await db.query(
    "select crm_save_whatsapp_connection($1,'111','222','+123456789','encrypted',null)",
    [owner],
  );
  await assert.rejects(
    db.query(
      "select crm_save_whatsapp_connection($1,'111','222','+123456789','other',null)",
      [other],
    ),
    /unique/,
  );
  await login(other);
  await assert.rejects(
    db.query("select * from crm_whatsapp_credentials"),
    /permission denied/,
  );
  await login(owner);
  await db.query("select crm_disconnect_whatsapp()");
  assert.equal(
    (await db.query("select active from crm_whatsapp_connections")).rows[0]
      .active,
    false,
  );
  await login("", "service_role");
  const staff = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  await db.exec("reset role");
  for (let i = 0; i < staff.length; i++) {
    await db.query("insert into auth.users values($1,$2,now())", [
      staff[i],
      staff[i] + "@test.invalid",
    ]);
    await db.query(
      "insert into crm_members(id,name,role,organization_id,joined_at) values($1,'Staff','team',$2,now()+make_interval(secs=>$3))",
      [staff[i], org, i],
    );
  }
  assert.equal(
    (await db.query("select crm_member_seat_active($1) active", [staff[2]]))
      .rows[0].active,
    true,
  );
  await db.query(
    "update crm_paid_cycles set starts_at=now()-interval '2 months',ends_at=now()-interval '1 month' where kind='seats'",
  );
  assert.equal(
    (await db.query("select crm_member_seat_active($1) active", [staff[2]]))
      .rows[0].active,
    false,
  );
  await login(staff[2]);
  assert.equal((await db.query("select crm_role() role")).rows[0].role, null);
  await login(owner);
  await db.query(
    "select crm_create_invitation('future@test.invalid','team',$1)",
    ["f".repeat(64)],
  );
  await db.query("select crm_transfer_ownership($1)", [staff[0]]);
  await login(staff[0]);
  await db.query("select crm_remove_member($1)", [owner]);
  await login("", "service_role");
  assert.equal(
    Number(
      (
        await db.query(
          "select count(*) from crm_calendar_bookings where id=$1",
          [reservation.booking_id],
        )
      ).rows[0].count,
    ),
    1,
  );
  assert.ok(
    (
      await db.query(
        "select revoked_at from crm_invitations where invited_by=$1",
        [owner],
      )
    ).rows[0].revoked_at,
  );
});

test("cancelling does not unlock a new checkout while paid access is still running", async (t) => {
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
  const owner = crypto.randomUUID();
  await db.query("insert into auth.users values($1,$2,now())", [
    owner,
    owner + "@test.invalid",
  ]);
  const login = async (id = "", role = "authenticated") => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec(`set role ${role}`);
  };
  await login("", "service_role");
  await db.query("select crm_provision_organization($1,'Agency','Owner') id", [owner]);
  await login(owner);
  const start = (
    await db.query("select crm_begin_checkout('base','pro',1,1) j")
  ).rows[0].j;
  await login("", "service_role");
  await db.query("select crm_finish_checkout($1,'sub_pro','plan_pro')", [start.id]);
  await db.query(
    "select crm_apply_paid_event($1,'sub_pro','plan_pro','active',now(),'pay_pro',now()-interval '1 day',now()-interval '1 day'+interval '1 month',400000,'INR',50000,100,50)",
    [createHash("sha256").update("evt1").digest("hex")],
  );
  // Cancel: crm_billing_subscriptions.status flips to 'cancelled' immediately, the same
  // way the real cancel action does, while the paid usage period it already bought keeps
  // running untouched.
  await db.query("update crm_billing_subscriptions set status='cancelled' where organization_id=(select organization_id from crm_members where id=$1)", [owner]);
  await login(owner);
  await assert.rejects(
    db.query("select crm_begin_checkout('base','pro_plus',1,1) j"),
    /already have paid access/,
  );
  // Once the paid period genuinely ends, checkout unlocks again.
  await login("", "service_role");
  await db.query(
    "update crm_usage_periods set ends_at=starts_at+interval '1 millisecond' where organization_id=(select organization_id from crm_members where id=$1)",
    [owner],
  );
  await login(owner);
  const retry = (
    await db.query("select crm_begin_checkout('base','pro_plus',1,1) j")
  ).rows[0].j;
  assert.equal(retry.run, true);
});

test("a booked site visit can be cancelled, freeing the slot and clearing the follow-up it set", async (t) => {
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
      id + "@test.invalid",
    ]);
  const login = async (id = "", role = "authenticated") => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec(`set role ${role}`);
  };
  await login("", "service_role");
  const org = (
    await db.query("select crm_provision_organization($1,'Agency','Owner') id", [owner])
  ).rows[0].id;
  await db.query("select crm_provision_organization($1,'Other','Owner')", [other]);
  await db.query(
    "select crm_open_usage_period($1,'pro',1,now(),now()+interval '1 month',30000,60,30,0)",
    [org],
  );
  await login(owner);
  await db.query("select crm_save_calendar_connection('primary','enc')");
  const stage = (
    await db.query(
      "select id from crm_stages where organization_id=$1 and kind='open' order by position limit 1",
      [org],
    )
  ).rows[0].id;
  const lead = (
    await db.query(
      "insert into crm_leads(name,stage_id,owner_id) values('Buyer',$1,$2) returning id",
      [stage, owner],
    )
  ).rows[0].id;
  const start = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const end = new Date(Date.now() + 2 * 86_400_000 + 1_800_000).toISOString();
  const reservation = (
    await db.query("select crm_prepare_visit($1,$2,$3) j", [lead, start, end])
  ).rows[0].j;
  await login("", "service_role");
  await db.query("select crm_complete_visit($1,'booked')", [reservation.booking_id]);
  await login(owner);
  assert.equal(
    (await db.query("select crm_lead_visit($1) v", [lead])).rows[0].v.status,
    "booked",
  );
  assert.equal(
    (
      await db.query("select follow_up from crm_leads where id=$1", [lead])
    ).rows[0].follow_up.toISOString(),
    start,
  );
  // Another org can never even find this booking to cancel it.
  await login(other);
  await assert.rejects(
    db.query("select crm_prepare_visit_cancellation($1)", [reservation.booking_id]),
    /unavailable/,
  );
  await login(owner);
  const prep = (
    await db.query("select crm_prepare_visit_cancellation($1) j", [
      reservation.booking_id,
    ])
  ).rows[0].j;
  assert.equal(prep.event_id, reservation.event_id);
  assert.ok(prep.refresh_token_encrypted);
  await db.query("select crm_finish_visit_cancellation($1)", [reservation.booking_id]);
  // Idempotent: finishing an already-cancelled booking is a silent no-op, not an error,
  // matching a retried request after a client-side timeout.
  await db.query("select crm_finish_visit_cancellation($1)", [reservation.booking_id]);
  await login("", "service_role");
  assert.equal(
    (
      await db.query("select status from crm_calendar_bookings where id=$1", [
        reservation.booking_id,
      ])
    ).rows[0].status,
    "cancelled",
  );
  await login(owner);
  assert.equal(
    (await db.query("select crm_lead_visit($1) v", [lead])).rows[0].v,
    null,
  );
  assert.equal(
    (await db.query("select follow_up from crm_leads where id=$1", [lead])).rows[0]
      .follow_up,
    null,
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from crm_activities where lead_id=$1 and body like '%cancelled%'",
        [lead],
      )
    ).rows[0].n,
    1,
  );
  // Cancelling a visit that is not currently booked is rejected outright.
  await assert.rejects(
    db.query("select crm_prepare_visit_cancellation($1)", [reservation.booking_id]),
    /not currently booked/,
  );
  // The freed slot can be booked again.
  const rebooked = (
    await db.query("select crm_prepare_visit($1,$2,$3) j", [lead, start, end])
  ).rows[0].j;
  assert.equal(rebooked.run, true);
});
