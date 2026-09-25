import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  decryptCalendarToken,
  encryptCalendarToken,
} from "../src/lib/crm/calendar-crypto.ts";
import {
  createCalendarEvent,
  exchangeCode,
  getFreeBusy,
  googleAuthorizeUrl,
  googleCalendarConfigured,
  refreshAccessToken,
} from "../src/lib/crm/google-calendar.ts";

const env = {
  GOOGLE_CALENDAR_CLIENT_ID: "client-id.apps.googleusercontent.com",
  GOOGLE_CALENDAR_CLIENT_SECRET: "client-secret",
  CRM_CALENDAR_TOKEN_KEY:
    "32d80a02527971dca689b65277bc3827361f1a5386b0e199edf97af01c9097a4",
};

test("googleCalendarConfigured requires all three server-only values", () => {
  assert.ok(googleCalendarConfigured(env));
  for (const key of Object.keys(env))
    assert.equal(googleCalendarConfigured({ ...env, [key]: "" }), false);
});

test("encryptCalendarToken/decryptCalendarToken round-trip and reject tampering", () => {
  const token = "1//09-refresh-token-example";
  const encrypted = encryptCalendarToken(env, token);
  assert.equal(decryptCalendarToken(env, encrypted), token);
  assert.notEqual(encrypted, token);
  // Flip a byte in the ciphertext: auth tag must reject it, not decrypt to garbage.
  const raw = Buffer.from(encrypted, "base64");
  raw[raw.length - 1] ^= 0xff;
  assert.throws(() => decryptCalendarToken(env, raw.toString("base64")));
  assert.throws(() => encryptCalendarToken({ ...env, CRM_CALENDAR_TOKEN_KEY: "" }, token));
  assert.throws(() => decryptCalendarToken({ ...env, CRM_CALENDAR_TOKEN_KEY: "short" }, encrypted));
});

test("googleAuthorizeUrl requests offline access, forces consent, and carries state", () => {
  const url = new URL(
    googleAuthorizeUrl(env, "https://crm.example.com/api/crm/calendar/callback", "abc123"),
  );
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("client_id"), env.GOOGLE_CALENDAR_CLIENT_ID);
  assert.equal(
    url.searchParams.get("redirect_uri"),
    "https://crm.example.com/api/crm/calendar/callback",
  );
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("state"), "abc123");
  assert.match(url.searchParams.get("scope") ?? "", /calendar\.events/);
  assert.match(url.searchParams.get("scope") ?? "", /calendar\.freebusy/);
});

test("exchangeCode and refreshAccessToken send the right grant and surface Google's error", async () => {
  let calls = 0;
  const tokens = await exchangeCode(
    env,
    "auth-code",
    "https://crm.example.com/api/crm/calendar/callback",
    async (url, init) => {
      calls++;
      assert.equal(url, "https://oauth2.googleapis.com/token");
      const body = new URLSearchParams(init.body);
      assert.equal(body.get("grant_type"), "authorization_code");
      assert.equal(body.get("code"), "auth-code");
      assert.equal(body.get("client_secret"), env.GOOGLE_CALENDAR_CLIENT_SECRET);
      return Response.json({ access_token: "at", refresh_token: "rt", expires_in: 3600 });
    },
  );
  assert.equal(calls, 1);
  assert.equal(tokens.refresh_token, "rt");

  const refreshed = await refreshAccessToken(env, "rt", async (url, init) => {
    const body = new URLSearchParams(init.body);
    assert.equal(body.get("grant_type"), "refresh_token");
    assert.equal(body.get("refresh_token"), "rt");
    return Response.json({ access_token: "at2", expires_in: 3600 });
  });
  assert.equal(refreshed.access_token, "at2");

  await assert.rejects(
    exchangeCode(env, "bad-code", "https://x/callback", async () =>
      Response.json({ error: "invalid_grant", error_description: "Bad code" }, { status: 400 }),
    ),
    /Bad code/,
  );
});

test("getFreeBusy and createCalendarEvent call the right endpoints and surface errors", async () => {
  const busy = await getFreeBusy(
    "access-token",
    "primary",
    "2026-10-01T00:00:00.000Z",
    "2026-10-02T00:00:00.000Z",
    async (url, init) => {
      assert.equal(url, "https://www.googleapis.com/calendar/v3/freeBusy");
      assert.equal(init.headers.Authorization, "Bearer access-token");
      const body = JSON.parse(init.body);
      assert.deepEqual(body.items, [{ id: "primary" }]);
      return Response.json({
        calendars: { primary: { busy: [{ start: "a", end: "b" }] } },
      });
    },
  );
  assert.deepEqual(busy, [{ start: "a", end: "b" }]);

  const created = await createCalendarEvent(
    "access-token",
    "primary",
    {
      summary: "Site visit: Test Lead",
      startIso: "2026-10-01T09:00:00.000Z",
      endIso: "2026-10-01T09:30:00.000Z",
      attendeeEmail: "lead@example.com",
    },
    async (url, init) => {
      assert.equal(
        url,
        "https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all",
      );
      const body = JSON.parse(init.body);
      assert.equal(body.summary, "Site visit: Test Lead");
      assert.deepEqual(body.attendees, [{ email: "lead@example.com" }]);
      return Response.json({ id: "evt_1", htmlLink: "https://calendar.google.com/evt_1" });
    },
  );
  assert.equal(created.eventId, "evt_1");

  await assert.rejects(
    getFreeBusy("token", "primary", "a", "b", async () =>
      Response.json({ error: { message: "Calendar not found" } }, { status: 404 }),
    ),
    /Calendar not found/,
  );
});

test("calendar connection and lead-scoped access enforce ownership, tenancy, and an active subscription", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;`);
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

  const ids = Object.fromEntries(
    ["ownerA", "agentA", "ownerB"].map((k) => [k, crypto.randomUUID()]),
  );
  for (const id of Object.values(ids))
    await db.query("insert into auth.users values($1)", [id]);
  const login = async (id = "", role = "authenticated") => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec(`set role ${role}`);
  };
  const provision = async (id, name) =>
    (
      await db.query("select crm_provision_organization($1,$2,$2) as id", [id, name])
    ).rows[0].id;
  await login("", "service_role");
  const orgA = await provision(ids.ownerA, "A");
  const orgB = await provision(ids.ownerB, "B");
  const openProPlus = (org) =>
    db.query(
      "select crm_open_usage_period($1,'pro_plus',1,now(),now()+interval '1 month',50000,100,50,0)",
      [org],
    );
  const openPro = (org) =>
    db.query(
      "select crm_open_usage_period($1,'pro',1,now(),now()+interval '1 month',30000,60,30,0)",
      [org],
    );
  const addMember = (id, org, name) =>
    db.query(
      "insert into crm_members(id,organization_id,name,role) values($1,$2,$3,'team')",
      [id, org, name],
    );

  await t.test(
    "connecting requires an active subscription (any plan) and rejects invalid input",
    async () => {
      // A solo Free-tier owner (no teammates, no subscription yet) cannot connect a
      // calendar: the seat-allowance trigger means orgA has no second member to test
      // this with until it subscribes, so the owner proves the entitlement gate here.
      await login(ids.ownerA);
      await assert.rejects(
        db.query("select crm_save_calendar_connection('primary','enc')"),
        /active subscription/,
      );
      await login("", "service_role");
      await openProPlus(orgA);
      await addMember(ids.agentA, orgA, "Agent");
      await login(ids.agentA);
      await assert.rejects(
        db.query("select crm_save_calendar_connection('','enc')"),
      );
      await db.query("select crm_save_calendar_connection('primary','enc-token-1')");
      await login("", "service_role");
      const row = (
        await db.query(
          "select calendar_id,refresh_token_encrypted from crm_calendar_connections where member_id=$1",
          [ids.agentA],
        )
      ).rows[0];
      assert.deepEqual(row, { calendar_id: "primary", refresh_token_encrypted: "enc-token-1" });
    },
  );

  await t.test("reconnecting updates the existing row rather than duplicating it", async () => {
    await login(ids.agentA);
    await db.query("select crm_save_calendar_connection('primary','enc-token-2')");
    await login("", "service_role");
    const rows = await db.query(
      "select refresh_token_encrypted from crm_calendar_connections where member_id=$1",
      [ids.agentA],
    );
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0].refresh_token_encrypted, "enc-token-2");
  });

  await t.test("a lead's calendar connection is scoped to tenant, access, and entitlement", async () => {
    await login(ids.ownerA);
    const stage = (
      await db.query(
        "select id from crm_stages where organization_id=$1 and kind='open' order by position limit 1",
        [orgA],
      )
    ).rows[0].id;
    const lead = (
      await db.query(
        "insert into crm_leads(name,stage_id,owner_id) values('Prospect',$1,$2) returning id",
        [stage, ids.agentA],
      )
    ).rows[0].id;
    const conn = (
      await db.query("select crm_calendar_connection_for_lead($1) as c", [lead])
    ).rows[0].c;
    assert.equal(conn.member_id, ids.agentA);
    assert.equal(conn.refresh_token_encrypted, "enc-token-2");

    // Org B has no subscription at all yet: the entitlement gate fires before lead
    // access is even considered, regardless of whose lead is named.
    await login(ids.ownerB);
    await assert.rejects(
      db.query("select crm_calendar_connection_for_lead($1)", [lead]),
      /active subscription/,
    );

    // A plain Pro subscription (not Pro Plus) is enough for manual scheduling, matching
    // the pricing page's promise of manual site-visit scheduling on Pro. Pro's seat
    // allowance is 1, already used by ownerB, so this proves tenancy without a second
    // member of orgB.
    await login("", "service_role");
    await openPro(orgB);
    await login(ids.ownerB);
    await assert.rejects(
      db.query("select crm_calendar_connection_for_lead($1)", [lead]),
      /Lead unavailable/,
    );
  });

  await t.test("crm_calendar_status never exposes the token and reflects only the caller's own row", async () => {
    await login(ids.agentA);
    const connected = (await db.query("select crm_calendar_status() as s")).rows[0].s;
    assert.equal(connected.connected, true);
    assert.ok(connected.connected_at);
    assert.equal(Object.hasOwn(connected, "refresh_token_encrypted"), false);
    await login(ids.ownerB);
    const notConnected = (await db.query("select crm_calendar_status() as s")).rows[0].s;
    assert.equal(notConnected.connected, false);
  });

  await t.test("an unassigned lead fails with a distinct, actionable message", async () => {
    await login(ids.ownerA);
    const stage = (
      await db.query(
        "select id from crm_stages where organization_id=$1 and kind='open' order by position limit 1",
        [orgA],
      )
    ).rows[0].id;
    const lead = (
      await db.query(
        "insert into crm_leads(name,stage_id,owner_id) values('Unassigned lead',$1,null) returning id",
        [stage],
      )
    ).rows[0].id;
    await assert.rejects(
      db.query("select crm_calendar_connection_for_lead($1)", [lead]),
      /Assign this lead to an agent/,
    );
  });

  await t.test("a lead whose owner never connected a calendar fails clearly", async () => {
    await login(ids.ownerA);
    const stage = (
      await db.query(
        "select id from crm_stages where organization_id=$1 and kind='open' order by position limit 1",
        [orgA],
      )
    ).rows[0].id;
    const lead = (
      await db.query(
        "insert into crm_leads(name,stage_id,owner_id) values('Unassigned agent lead',$1,$2) returning id",
        [stage, ids.ownerA],
      )
    ).rows[0].id;
    await assert.rejects(
      db.query("select crm_calendar_connection_for_lead($1)", [lead]),
      /has not connected/,
    );
  });

  await t.test("disconnect only ever removes the caller's own connection", async () => {
    await login(ids.ownerB);
    await db.query("select crm_disconnect_calendar()"); // no-op, nothing connected
    await login(ids.agentA);
    await db.query("select crm_disconnect_calendar()");
    const status = (await db.query("select crm_calendar_status() as s")).rows[0].s;
    assert.equal(status.connected, false);
  });

  await t.test("anonymous callers cannot reach any calendar function", async () => {
    await login("", "anon");
    await assert.rejects(db.query("select crm_calendar_status()"));
    await assert.rejects(db.query("select crm_save_calendar_connection('primary','x')"));
    await assert.rejects(db.query("select crm_disconnect_calendar()"));
  });
});
