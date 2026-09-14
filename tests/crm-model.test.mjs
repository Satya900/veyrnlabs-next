import test from "node:test";
import assert from "node:assert/strict";
import { sameOrigin } from "../src/lib/crm/origin.ts";
import {
  demoWorkspace,
  exportCsv,
  metrics,
  parseCsv,
  validateLead,
} from "../src/lib/crm/model.ts";

test("origin checks support Next localhost normalization and reject cross-origin writes", () => {
  const request = (origin, host = "127.0.0.1:3000") =>
    new Request("http://localhost:3000/api/crm", { headers: { origin, host } });
  assert.equal(sameOrigin(request("http://127.0.0.1:3000")), true);
  assert.equal(sameOrigin(request("https://untrusted.example")), false);
  assert.equal(sameOrigin(request("null")), false);
  assert.equal(sameOrigin(request("http://127.0.0.1:4000")), false);
  assert.equal(
    sameOrigin(
      new Request("https://crm.veyrnlabs.com/api/crm", {
        headers: {
          host: "crm.veyrnlabs.com",
          origin: "https://crm.veyrnlabs.com",
        },
      }),
    ),
    true,
  );
  assert.equal(
    sameOrigin(new Request("https://crm.veyrnlabs.com/api/crm")),
    false,
  );
});

test("lead validation rejects invalid values and strips protected fields", () => {
  assert.throws(() => validateLead({ name: "  " }), /name/);
  assert.throws(() => validateLead({ name: "Contact", email: "bad" }), /email/);
  assert.throws(() => validateLead({ name: "Contact", value: -1 }), /value/);
  assert.throws(
    () => validateLead({ name: "Contact", value: Infinity }),
    /value/,
  );
  assert.throws(
    () => validateLead({ name: "Contact", follow_up: "not a date" }),
    /date/,
  );
  const lead = validateLead({
    name: " Contact ",
    client_id: "forged",
    created_at: "forged",
    value: "500.50",
  });
  assert.equal(lead.name, "Contact");
  assert.equal(lead.value, 500.5);
  assert.equal(lead.client_id, undefined);
  assert.equal(lead.created_at, undefined);
});
test("CSV handles BOM, quoted commas, multiline notes, and escaped quotes", () => {
  const rows = parseCsv(
    '\uFEFFname,company,notes\r\n"Jane Doe","Company, Inc","Line one\nSaid ""hello"""\r\n',
  );
  assert.equal(rows[0].company, "Company, Inc");
  assert.equal(rows[0].notes, 'Line one\nSaid "hello"');
  assert.throws(() => parseCsv('name,notes\nJane,"oops'), /unclosed/);
  assert.throws(() => parseCsv("name,name\nA,B"), /unique/);
  assert.throws(() => parseCsv("name,email\nJane"), /columns/);
  assert.throws(
    () => parseCsv("name\n" + Array(501).fill("Jane").join("\n")),
    /500/,
  );
});
test("CSV neutralizes spreadsheet formulas", () => {
  const csv = exportCsv([
    { name: '=HYPERLINK("bad")', phone: "+919000000000", notes: "  @SUM(A1)" },
  ]);
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.includes("'+919"));
  assert.ok(csv.includes("'  @SUM"));
});
test("reports use closing dates, include the end date, and distinguish won value from open pipeline", () => {
  const data = demoWorkspace();
  data.leads = data.leads.slice(0, 3).map((lead, i) => ({
    ...lead,
    value: 100,
    created_at: "2026-08-01T00:00:00Z",
    stage_id: `stage-${i === 0 ? 0 : i === 1 ? 6 : 7}`,
    closed_at: i === 0 ? null : "2026-09-14T23:59:59.999Z",
  }));
  assert.deepEqual(metrics(data, "2026-09-01", "2026-09-14"), {
    newLeads: 0,
    pipeline: 100,
    won: 1,
    wonValue: 100,
    rate: 50,
  });
  assert.equal(metrics(data, "2026-10-01", "2026-10-31").rate, null);
});
