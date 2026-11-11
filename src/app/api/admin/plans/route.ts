import { jsonBody, platformAdmin, sameOrigin, supabase } from "@/lib/crm/server";
import { CRM_PLANS, type PlanId } from "@/lib/crm/plans";
import { billingAllowances } from "@/lib/crm/razorpay";
import { requirePasswordLength } from "@/lib/crm/account-validation";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const when = (value: unknown) => {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new Error("Invalid date.");
  return new Date(value).toISOString();
};

/** Grants a plan to a workspace with the plan's own allowances (AI actions can be overridden). */
async function grantPlan(admin: string, organizationId: string, body: Record<string, unknown>) {
  const plan = body.plan as PlanId;
  if (!Object.hasOwn(CRM_PLANS, plan)) throw new Error("Choose Pro or Pro Plus.");
  const allowances = billingAllowances(process.env, plan);
  const ai = body.aiActions == null || body.aiActions === "" ? CRM_PLANS[plan].aiActions : Number(body.aiActions);
  if (!Number.isSafeInteger(ai) || ai < 1 || ai > 100_000) throw new Error("AI actions per month must be between 1 and 100,000.");
  const { data, error } = await supabase(undefined, true).rpc("crm_admin_grant_plan", {
    org: organizationId,
    grant_plan: plan,
    starts: when(body.startsAt),
    ends: when(body.endsAt),
    monthly_ai: ai,
    overhead: allowances.overheadPaise,
    whatsapp_allowance: allowances.whatsappAllowance,
    admin_email: admin,
    grant_note: text(body.note, 500) || null,
  });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Platform admin only (CRM_PLATFORM_ADMIN_EMAILS); everyone else gets a 404 like the page.
 * create: a new login (email already verified, password set here) with its own workspace and a granted plan.
 * grant:  a plan for an existing workspace.
 * revoke: ends a grant now.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const admin = await platformAdmin();
  if (!admin) return new Response(null, { status: 404 });
  try {
    const body = await jsonBody(request, 4000);
    const db = supabase(undefined, true);
    if (body.action === "grant") {
      const organizationId = text(body.organizationId, 64);
      if (!organizationId) throw new Error("Choose a workspace.");
      const grant = await grantPlan(admin.email, organizationId, body);
      return Response.json({ ok: true, grant }, { headers });
    }
    if (body.action === "revoke") {
      const { data, error } = await db.rpc("crm_admin_revoke_grant", {
        grant_id: text(body.grantId, 64),
        admin_email: admin.email,
      });
      if (error) throw new Error(error.message);
      return Response.json({ ok: true, grant: data }, { headers });
    }
    if (body.action === "create") {
      const email = text(body.email, 320).toLowerCase();
      const name = text(body.name, 100);
      const business = text(body.business, 150);
      if (!EMAIL.test(email)) throw new Error("Enter a valid email.");
      if (!name || !business) throw new Error("Enter the person's name and business name.");
      // Not trimmed: spaces are allowed in passwords.
      const password = typeof body.password === "string" ? body.password : "";
      requirePasswordLength(password);
      if (!Object.hasOwn(CRM_PLANS, body.plan as string)) throw new Error("Choose Pro or Pro Plus.");
      billingAllowances(process.env, body.plan as PlanId); // fail before creating anything
      const { data: created, error } = await db.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name, organization: business, crm_signup: true },
      });
      if (error || !created.user) {
        if (error?.code === "email_exists" || error?.status === 422)
          throw new Error("That email already has an account. Find their workspace below and use Grant plan.");
        if (error?.code === "weak_password") throw new Error("That password is too weak. Choose a longer one.");
        console.error("admin create user failed", { status: error?.status, code: error?.code });
        throw new Error("The account couldn't be created. Try again.");
      }
      const { data: organizationId, error: provisionError } = await db.rpc("crm_provision_organization", {
        owner_user: created.user.id,
        organization_name: business,
        owner_name: name,
      });
      if (provisionError || typeof organizationId !== "string")
        throw new Error("The login was created, but its workspace couldn't be set up. They can sign up to finish it.");
      try {
        const grant = await grantPlan(admin.email, organizationId, body);
        return Response.json({ ok: true, organizationId, grant }, { headers });
      } catch (err) {
        throw new Error(
          `The account and workspace were created, but the plan wasn't granted: ${err instanceof Error ? err.message : "unknown error"}. Grant it from the customer list.`,
        );
      }
    }
    throw new Error("Unknown action.");
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "That didn't work." },
      { status: 400, headers },
    );
  }
}
