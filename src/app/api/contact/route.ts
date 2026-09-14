import { after } from "next/server";
import { jsonBody, sameOrigin, supabase } from "@/lib/crm/server";
import { validateLead } from "@/lib/crm/model";
import { notifyNewLead } from "@/lib/crm/notify";

export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    return Response.json(
      {
        error:
          "Enquiry capture is not configured. Please email satyabrata@veyrnlabs.com.",
      },
      { status: 503 },
    );
  try {
    const body = await jsonBody(request, 12_000);
    if (body.website)
      return Response.json(
        { error: "Unable to accept this enquiry." },
        { status: 400 },
      );
    if (
      typeof body.submission_id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        body.submission_id,
      )
    )
      throw new Error("Refresh the form and try again.");
    const lead = validateLead(body);
    if (!lead.email || !lead.notes)
      throw new Error("Please include your email and project details.");
    const { data: inserted, error } = await supabase(undefined, true).rpc(
      "crm_capture_lead",
      {
        submission: body.submission_id,
        contact_name: lead.name,
        contact_email: lead.email,
        contact_company: lead.company,
        contact_service: lead.service,
        contact_notes: lead.notes,
      },
    );
    if (error)
      return Response.json(
        {
          error:
            "Your enquiry could not be saved. Please try again later or email satyabrata@veyrnlabs.com.",
        },
        { status: 503 },
      );
    // Only the first (non-retried) save of a given submission notifies.
    // Runs after the response is sent, so a slow/failed email never delays it.
    if (inserted)
      after(() =>
        notifyNewLead({
          name: String(lead.name),
          email: String(lead.email),
          company: String(lead.company),
          service: String(lead.service),
          notes: String(lead.notes),
        }),
      );
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Please check your enquiry.",
      },
      { status: 400 },
    );
  }
}
