import { after } from "next/server";
import { supabase } from "@/lib/crm/server";
import { parseEnquiry } from "@/lib/crm/lead-capture";
import { processWhatsAppFollowUp } from "@/lib/crm/whatsapp-followup-worker";
import { tenantSendConfig } from "@/lib/crm/whatsapp-tenant";

export const runtime = "nodejs";
export const maxDuration = 30;

// Public on purpose: the capture token in the URL is the only credential, and it can only add
// enquiries. Any site may post here (website forms, Zapier, Pabbly, Make), so CORS is open and
// no cookies are read.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
};
const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

export function OPTIONS() {
  return new Response(null, { status: 204, headers: cors });
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 20_000) throw new Error("Enquiry too large.");
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const text = await request.text();
    if (text.length > 20_000) throw new Error("Enquiry too large.");
    const data = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Send the enquiry as a JSON object.");
    return data;
  }
  if (type.includes("form")) {
    const form = await request.formData();
    const data: Record<string, string> = {};
    for (const [k, v] of form.entries()) if (typeof v === "string") data[k] = v;
    return data;
  }
  throw new Error("Send the enquiry as JSON or a form.");
}

// A plain HTML form post (no JavaScript) gets a page back, or goes to its own thank-you page.
function htmlReply(body: Record<string, unknown>, ok: boolean, message: string) {
  const redirect = typeof body.redirect === "string" ? body.redirect : "";
  if (ok && /^https:\/\/[^\s"'<>]+$/.test(redirect)) return Response.redirect(redirect, 303);
  const safe = message.replace(/[<>&"]/g, "");
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${ok ? "Thank you" : "Not sent"}</title><body style="font:16px system-ui;max-width:480px;margin:15vh auto;padding:0 16px;text-align:center"><h1 style="font-size:22px">${ok ? "Thank you!" : "Not sent"}</h1><p>${safe}</p></body>`,
    { status: ok ? 200 : 400, headers: { ...cors, "Content-Type": "text/html; charset=utf-8" } },
  );
}

/** Sends the new lead's welcome right away instead of waiting for the next worker minute. */
function welcomeSoon() {
  const cost = Number(process.env.WHATSAPP_REPLY_COST_PAISE);
  if (process.env.WHATSAPP_SEND_ENABLED !== "true" || !Number.isSafeInteger(cost) || cost < 1 || cost > 10000) return;
  after(async () => {
    const db = supabase(undefined, true);
    try {
      await processWhatsAppFollowUp(
        cost,
        (name, args) => db.rpc(name, args),
        (organization) => tenantSendConfig(undefined, organization),
        fetch,
        "crm_claim_lead_welcome",
      );
    } catch (error) {
      // The scheduled worker retries anything still due.
      console.error("lead welcome failed", { message: error instanceof Error ? error.message : "unknown" });
    }
  });
}

export async function POST(request: Request, ctx: RouteContext<"/api/leads/[token]">) {
  const { token } = await ctx.params;
  const wantsHtml = (request.headers.get("accept") ?? "").includes("text/html");
  let body: Record<string, unknown> = {};
  try {
    if (!TOKEN.test(token)) throw Object.assign(new Error("This enquiry form is not available."), { status: 404 });
    body = await readBody(request);
    const enquiry = parseEnquiry(body, new URL(request.url).searchParams.get("source") ?? "");
    if (enquiry.spam) return wantsHtml ? htmlReply(body, true, "We'll be in touch soon.") : Response.json({ ok: true }, { headers: cors });
    const { data, error } = await supabase(undefined, true).rpc("crm_capture_workspace_lead", {
      capture_token: token,
      contact_name: enquiry.name,
      contact_phone: enquiry.phone,
      contact_email: enquiry.email,
      looking_for: enquiry.lookingFor,
      budget_inr: enquiry.budget,
      contact_notes: enquiry.notes,
      lead_source: enquiry.source,
    });
    if (error) {
      if (error.code === "P0404") throw Object.assign(new Error("This enquiry form is not available."), { status: 404 });
      if (/name and a phone|Too many enquiries/.test(error.message)) throw new Error(error.message);
      console.error("lead capture failed", { code: error.code, message: error.message });
      throw new Error("The enquiry couldn't be saved. Try again.");
    }
    if (data?.status === "created") welcomeSoon();
    return wantsHtml
      ? htmlReply(body, true, "We've received your enquiry and will contact you shortly.")
      : Response.json({ ok: true, status: data?.status }, { headers: cors });
  } catch (error) {
    const message = error instanceof SyntaxError ? "Invalid JSON." : error instanceof Error ? error.message : "Not saved.";
    const status = (error as { status?: number }).status ?? 400;
    return wantsHtml ? htmlReply(body, false, message) : Response.json({ error: message }, { status, headers: cors });
  }
}
