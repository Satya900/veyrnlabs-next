import "server-only";

export function notifyConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.CRM_NOTIFY_EMAIL);
}

/**
 * Best-effort email notification for a newly captured website lead. Never
 * throws: the enquiry is already saved by the time this is called, and a
 * notification failure must not turn that into a visitor-facing error.
 */
export async function notifyNewLead(lead: {
  name: string;
  email: string;
  company: string;
  service: string;
  notes: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.CRM_NOTIFY_EMAIL;
  if (!apiKey || !to) return;
  const from = process.env.CRM_NOTIFY_FROM || "Veyrn Labs CRM <onboarding@resend.dev>";
  const lines = [
    `Name: ${lead.name}`,
    `Email: ${lead.email}`,
    lead.company ? `Company: ${lead.company}` : null,
    lead.service ? `Service: ${lead.service}` : null,
    "",
    "Notes:",
    lead.notes,
    "",
    "Open the workspace to assign this lead.",
  ].filter((line): line is string => line !== null);
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject: `New website enquiry: ${lead.name}`,
        text: lines.join("\n"),
      }),
    });
  } catch {
    // Notification is best-effort; the lead is already saved.
  }
}
