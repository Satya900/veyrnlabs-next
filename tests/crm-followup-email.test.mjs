import test from "node:test";
import assert from "node:assert/strict";
import { emailConfig, sendFollowUpEmail } from "../src/lib/crm/email-send.ts";

test("emailConfig requires every field and rejects a non-positive cost", () => {
  const env = {
    EMAIL_SEND_ENABLED: "true",
    RESEND_API_KEY: "re_test",
    CRM_FOLLOWUP_FROM_EMAIL: "Veyrn Labs <hello@veyrnlabs.com>",
    EMAIL_REPLY_COST_PAISE: "1",
  };
  assert.ok(emailConfig(env));
  for (const key of Object.keys(env)) assert.equal(emailConfig({ ...env, [key]: "" }), null);
});

test("sendFollowUpEmail maps provider outcomes to accepted/rejected/unknown", async () => {
  const accepted = await sendFollowUpEmail(
    "key",
    "Veyrn Labs <hello@veyrnlabs.com>",
    "lead@example.com",
    "Following up",
    "Still interested in the property?",
    async (url, init) => {
      assert.equal(url, "https://api.resend.com/emails");
      const body = JSON.parse(init.body);
      assert.equal(body.to, "lead@example.com");
      assert.equal(body.subject, "Following up");
      return Response.json({ id: "email-1" });
    },
  );
  assert.deepEqual(accepted, { status: "accepted", messageId: "email-1" });
  assert.equal(
    (
      await sendFollowUpEmail("k", "a@b.com", "lead@example.com", "Sub", "Body", async () =>
        Response.json({ message: "invalid" }, { status: 422 }),
      )
    ).status,
    "rejected",
  );
  assert.equal(
    (
      await sendFollowUpEmail("k", "a@b.com", "lead@example.com", "Sub", "Body", async () => {
        throw new Error("timeout");
      })
    ).status,
    "unknown",
  );
  await assert.rejects(
    sendFollowUpEmail("k", "a@b.com", "not-an-email", "Sub", "Body", async () =>
      Response.json({}),
    ),
  );
});
