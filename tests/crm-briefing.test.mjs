import test from "node:test";
import assert from "node:assert/strict";
import { goingCold, myOpenLeads, rankLeads } from "../src/lib/crm/briefing.ts";

const DAY = 86_400_000;
const now = Date.parse("2026-11-11T04:00:00Z");
const ago = (days) => new Date(now - days * DAY).toISOString();
const stages = [
  { id: "open", kind: "open" },
  { id: "won", kind: "won" },
];
const lead = (id, extra = {}) => ({
  id, name: id, company: "", email: "", phone: "", service: "", value: 0, source: "Manual",
  stage_id: "open", owner_id: "me", notes: "", follow_up: null, created_at: ago(10), closed_at: null, client_id: null, ...extra,
});

test("each person sees their own open leads, plus unassigned ones for owners and admins", () => {
  const leads = [
    lead("mine"),
    lead("unassigned", { owner_id: null }),
    lead("colleague", { owner_id: "other" }),
    lead("won", { stage_id: "won" }),
    lead("client", { client_id: "c1" }),
  ];
  assert.deepEqual(myOpenLeads(leads, stages, "me", "owner").map((l) => l.id), ["mine", "unassigned"]);
  assert.deepEqual(myOpenLeads(leads, stages, "me", "team").map((l) => l.id), ["mine"]);
});

test("call-first ranking: waiting and hot leads lead, cold leads with nothing going on drop out", () => {
  const leads = [
    lead("hot", { value: 8_000_000 }),
    lead("waiting"),
    lead("overdue", { follow_up: ago(3) }),
    lead("new", { created_at: ago(0.5) }),
    lead("cold"),
    lead("quiet"),
  ];
  const insights = [
    { lead_id: "hot", score: "hot" },
    { lead_id: "cold", score: "cold" },
    { lead_id: "waiting", score: "warm" },
    { lead_id: "overdue", score: "warm" },
  ];
  const ranked = rankLeads(leads, insights, [], new Set(["waiting"]), {}, now, 10);
  // waiting 40+25=65, overdue 25+30+6=61, hot 50+8=58, new 10+20=30.
  assert.deepEqual(ranked.map((r) => r.lead.id), ["waiting", "overdue", "hot", "new"]);
  assert.deepEqual(ranked.find((r) => r.lead.id === "overdue").reasons, ["Warm lead", "follow-up 3 days overdue"]);
  assert.deepEqual(ranked.find((r) => r.lead.id === "waiting").reasons, ["waiting for your reply on WhatsApp", "Warm lead"]);
  assert.ok(ranked.find((r) => r.lead.id === "new").reasons.includes("new lead, not contacted yet"));
  // "quiet" has no score and nothing due (10 points) and "cold" has nothing going on: neither is listed.
  assert.equal(ranked.some((r) => ["cold", "quiet"].includes(r.lead.id)), false);
  assert.equal(rankLeads(leads, insights, [], new Set(["waiting"]), {}, now).length, 3);
});

test("going cold: no call, note, meeting, task or chat for 7+ days, quietest first", () => {
  const leads = [lead("called"), lead("chatted"), lead("silent", { created_at: ago(20) }), lead("fresh", { created_at: ago(3) }), lead("updated")];
  const activities = [
    { id: "a", lead_id: "called", kind: "call", created_at: ago(2), body: "" },
    // System entries like "Lead details updated" aren't contact.
    { id: "b", lead_id: "updated", kind: "updated", created_at: ago(1), body: "" },
  ];
  const cold = goingCold(leads, activities, { chatted: ago(1) }, now);
  assert.deepEqual(cold.map((c) => [c.lead.id, c.days]), [["silent", 20], ["updated", 10]]);
});
