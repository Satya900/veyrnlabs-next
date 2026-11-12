import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("email follow-ups can't be switched on and their worker is gone", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema public,auth to anon,authenticated,service_role;",
  );
  for (const file of (await readdir(new URL("../supabase/migrations/", import.meta.url))).filter((f) => f.endsWith(".sql")).sort())
    await db.exec(await readFile(new URL("../supabase/migrations/" + file, import.meta.url), "utf8"));
  const owner = crypto.randomUUID();
  await db.query("insert into auth.users values($1,$2,now())", [owner, `${owner}@example.com`]);
  await db.exec("set role service_role");
  await db.query("select crm_provision_organization($1,'Sunrise Realty','Owner')", [owner]);
  await db.exec("reset role");
  assert.deepEqual((await db.query("select id from crm_worker_health where id='followups'")).rows, []);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  await db.exec("set role authenticated");
  await assert.rejects(db.query("select crm_set_followups(true)"), /permission denied/);
  assert.equal((await db.query("select count(*)::int n from crm_ai_settings where followup_enabled")).rows[0].n, 0);
});
