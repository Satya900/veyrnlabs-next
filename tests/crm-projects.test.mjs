import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("projects feed the AI live inventory and stay inside their workspace", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema public,auth to anon,authenticated,service_role;",
  );
  for (const file of (await readdir(new URL("../supabase/migrations/", import.meta.url))).filter((f) => f.endsWith(".sql")).sort())
    await db.exec(await readFile(new URL("../supabase/migrations/" + file, import.meta.url), "utf8"));
  const [owner, team, other] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  for (const id of [owner, team, other]) await db.query("insert into auth.users values($1,$2,now())", [id, `${id}@example.com`]);
  const login = async (id = "", role = "authenticated") => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec(`set role ${role}`);
  };
  await login("", "service_role");
  const org = (await db.query("select crm_provision_organization($1,'Sunrise Realty','Owner') id", [owner])).rows[0].id;
  await db.query("select crm_provision_organization($1,'Other Realty','Other')", [other]);
  await db.query("insert into crm_subscriptions(organization_id,plan,billing_months,active) values($1,'pro_plus',1,true)", [org]);
  await db.query("insert into crm_members(id,name,role,organization_id) values($1,'Agent','team',$2)", [team, org]);

  const project = (await db.query(
    "insert into crm_projects(organization_id,name,location,status,possession,rera,amenities) values($1,'Prestige Lakeside','Whitefield, Bengaluru','under_construction','Dec 2027','PRM/KA/1251','Clubhouse, pool') returning id",
    [org],
  )).rows[0].id;
  await db.query(
    `insert into crm_project_units(organization_id,project_id,name,size,price_min,price_max,availability,position) values
     ($1,$2,'2BHK','1,150 sq ft',8500000,9200000,'available',0),
     ($1,$2,'3BHK','1,650 sq ft',12500000,null,'few_left',1),
     ($1,$2,'4BHK','',null,null,'sold_out',2)`,
    [org, project],
  );
  await db.query(
    "insert into crm_project_files(organization_id,project_id,kind,name,storage_path,mime,size_bytes) values($1,$2,'brochure','Lakeside brochure',$3,'application/pdf',2048)",
    [org, project, `${org}/${project}/brochure.pdf`],
  );
  await db.query("insert into crm_projects(organization_id,name,archived) values($1,'Old Project',true)", [org]);

  const text = (await db.query("select crm_inventory_text($1) t", [org])).rows[0].t;
  assert.match(text, /PROJECTS AND AVAILABILITY/);
  assert.match(text, /Prestige Lakeside, Whitefield, Bengaluru \[under construction\] Possession: Dec 2027\. RERA: PRM\/KA\/1251\./);
  assert.match(text, /2BHK 1,150 sq ft ₹85 L–92 L \(available\); 3BHK 1,650 sq ft ₹1\.25 Cr \(few left\); 4BHK price on request \(sold out\)\./);
  assert.match(text, /Brochure available/);
  assert.doesNotMatch(text, /Old Project/); // archived
  assert.equal((await db.query("select crm_inventory_text($1) t", [crypto.randomUUID()])).rows[0].t, "");

  // AI replies and drafts read it with the company knowledge.
  await login(owner);
  await db.query("select crm_save_ai_settings('We sell homes in Bengaluru. Ask for budget.',true)");
  await login("", "service_role");
  await db.query("insert into crm_whatsapp_connections(organization_id,waba_id,phone_number_id,display_phone,active) values($1,'111','222','Test',true)", [org]);
  await db.query("select crm_receive_whatsapp($1::jsonb)", [JSON.stringify([{ waba_id: "111", phone_number_id: "222", message_id: "m1", sender: "919111111111", contact_name: "Buyer", message_type: "text", body: "3BHK price?", sent_at: new Date().toISOString() }])]);
  await db.query("select crm_open_usage_period($1,'pro_plus',1,now()-interval '1 day',now()+interval '27 days',10000,5,20)", [org]);
  const chat = (await db.query("select id from crm_whatsapp_conversations where organization_id=$1", [org])).rows[0].id;
  await db.query("update crm_leads set project_id=$1 where id=(select lead_id from crm_whatsapp_conversations where id=$2)", [project, chat]);
  const job = (await db.query("select crm_start_ai_draft($1,$2,'test-model',100) j", [owner, chat])).rows[0].j;
  assert.match(job.knowledge, /\n- \[This customer's project\] Prestige Lakeside/);
  // Settings text is no longer read: the AI answers from Projects only.
  assert.match(job.knowledge, /^PROJECTS AND AVAILABILITY/);
  assert.doesNotMatch(job.knowledge, /We sell homes/);
  assert.match(job.knowledge, /3BHK 1,650 sq ft ₹1\.25 Cr \(few left\)/);

  // Leads can be tagged; deleting a project only clears the tag.
  const stage = (await db.query("select id from crm_stages where organization_id=$1 and kind='open' limit 1", [org])).rows[0].id;
  const lead = (await db.query("insert into crm_leads(organization_id,name,stage_id,project_id) values($1,'Priya',$2,$3) returning id", [org, stage, project])).rows[0].id;
  const otherProject = (await db.query("insert into crm_projects(organization_id,name) select organization_id,'Theirs' from crm_members where id=$1 returning id", [other])).rows[0].id;
  await assert.rejects(db.query("update crm_leads set project_id=$1 where id=$2", [otherProject, lead]), /foreign key/);

  // Every member reads their own workspace's inventory, nobody else's, and can't write it.
  await login(team);
  // Members tag leads with a project from the lead form, on new and existing leads.
  await db.query("update crm_leads set project_id=null where id=$1", [lead]);
  await db.query("update crm_leads set project_id=$1 where id=$2", [project, lead]);
  assert.equal((await db.query("select project_id from crm_leads where id=$1", [lead])).rows[0].project_id, project);
  const added = (await db.query("insert into crm_leads(name,stage_id,owner_id,project_id) values('Ravi',$1,$2,$3) returning project_id", [stage, team, project])).rows[0];
  assert.equal(added.project_id, project);
  assert.equal((await db.query("select count(*)::int n from crm_projects")).rows[0].n, 2);
  assert.equal((await db.query("select count(*)::int n from crm_project_units")).rows[0].n, 3);
  assert.equal((await db.query("select count(*)::int n from crm_project_files")).rows[0].n, 1);
  await assert.rejects(db.query("insert into crm_projects(organization_id,name) values($1,'X')", [org]), /permission denied/);
  await assert.rejects(db.query("select crm_inventory_text($1)", [org]), /permission denied/);
  await login(other);
  assert.deepEqual((await db.query("select name from crm_projects")).rows, [{ name: "Theirs" }]);

  // The lead's own project comes first and is marked, ahead of projects sorted before it.
  await login("", "service_role");
  await db.query("insert into crm_projects(organization_id,name) values($1,'Aaa Heights')", [org]);
  const focused = (await db.query("select crm_inventory_text($1,$2) t", [org, project])).rows[0].t;
  assert.match(focused, /^PROJECTS AND AVAILABILITY[^\n]*\n- \[This customer's project\] Prestige Lakeside/);
  assert.match((await db.query("select crm_inventory_text($1) t", [org])).rows[0].t, /\n- Aaa Heights/);
  // Reply suggestions read Projects (with the chat lead's project first), not the Settings text.
  const context = (await db.query("select crm_lead_insight_context($1,$2) c", [owner, chat])).rows[0].c;
  assert.match(context.knowledge, /^PROJECTS AND AVAILABILITY[^\n]*\n- \[This customer's project\] Prestige Lakeside/);
  assert.doesNotMatch(context.knowledge, /We sell homes/);

  // Drafts need no Settings text; automatic replies need an active project.
  await db.query("update crm_projects set archived=true where name='Theirs'");
  await login(other);
  await db.query("select crm_set_ai_drafts(true)");
  await assert.rejects(db.query("select crm_set_auto_replies(true)"), /Add at least one project/);
  await login(team);
  await assert.rejects(db.query("select crm_set_ai_drafts(true)"), /Admin access/);

  await login("", "service_role");
  await db.query("delete from crm_projects where id=$1", [project]);
  assert.deepEqual((await db.query("select project_id,organization_id is not null as org from crm_leads where id=$1", [lead])).rows[0], { project_id: null, org: true });
  assert.equal((await db.query("select count(*)::int n from crm_project_units")).rows[0].n, 0);
});

test("project inputs, prices and brochure sends", async () => {
  const { validateUnits, priceRange, storagePath, publicFileUrl, validateProject } = await import("../src/lib/crm/projects.ts");
  const { sendGupshupMedia } = await import("../src/lib/crm/whatsapp-gupshup.ts");
  const units = validateUnits([
    { name: "2BHK", size: "1,150 sq ft", price_min: "85 L", price_max: "92 L", availability: "available" },
    { name: "3BHK", price_min: "1.6 Cr", price_max: "1.25 Cr" }, // swapped
    { name: "Villa", price_min: "", availability: "nonsense" },
  ]);
  assert.deepEqual(units.map((u) => [u.price_min, u.price_max, u.availability, u.position]), [
    [8500000, 9200000, "available", 0],
    [12500000, 16000000, "available", 1],
    [null, null, "available", 2],
  ]);
  assert.equal(priceRange(units[0]), "₹85 L–92 L");
  assert.equal(priceRange(units[1]), "₹1.25 Cr–1.6 Cr");
  assert.equal(priceRange(units[2]), "Price on request");
  assert.throws(() => validateUnits([{ name: "" }]), /unit type/);
  assert.throws(() => validateUnits([{ name: "2BHK", price_min: "call us" }]), /Couldn't read the price/);
  assert.throws(() => validateProject({ name: " " }), /project name/);
  assert.equal(validateProject({ name: "Lakeside", status: "bogus" }).status, "launched");

  const org = crypto.randomUUID(), project = crypto.randomUUID();
  const path = storagePath(org, project, "Lakeside Brochure (Final).PDF", "application/pdf");
  assert.match(path, new RegExp(`^${org}/${project}/[0-9a-f]{8}-lakeside-brochure-final\\.pdf$`));
  assert.throws(() => storagePath(org, project, "x.exe", "application/x-msdownload"), /PDF, JPG/);
  assert.equal(publicFileUrl("https://abc.supabase.co/", "a/b/c d.pdf"), "https://abc.supabase.co/storage/v1/object/public/crm-files/a/b/c%20d.pdf");

  // A PDF goes as a file with its name; an image as an image with a caption.
  const sent = [];
  const request = async (url, init) => {
    sent.push(JSON.parse(new URLSearchParams(init.body).get("message")));
    return Response.json({ status: "submitted", messageId: "gs-9" });
  };
  const doc = await sendGupshupMedia("key", "app", "916372506476", "919876543210", { url: "https://x.co/b.pdf", filename: "Lakeside - Brochure.pdf", caption: "Here you go", image: false }, request);
  await sendGupshupMedia("key", "app", "916372506476", "919876543210", { url: "https://x.co/p.jpg", filename: "p.jpg", caption: "Clubhouse", image: true }, request);
  assert.deepEqual(doc, { status: "accepted", messageId: "gs-9" });
  assert.deepEqual(sent[0], { type: "file", url: "https://x.co/b.pdf", filename: "Lakeside - Brochure.pdf" });
  assert.deepEqual(sent[1], { type: "image", originalUrl: "https://x.co/p.jpg", previewUrl: "https://x.co/p.jpg", caption: "Clubhouse" });
  await assert.rejects(sendGupshupMedia("key", "app", "916372506476", "919876543210", { url: "http://insecure/b.pdf", filename: "b.pdf", caption: "", image: false }, request), /Invalid file/);
});
