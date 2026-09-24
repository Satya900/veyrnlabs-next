import "server-only";
import { createHash } from "node:crypto";
import type { User, Session } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { configured, cookieName, supabase } from "./server";

export const accountsEnabled = () =>
  configured() &&
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) &&
  process.env.CRM_SIGNUP_ENABLED === "true";
export const hashInvitation = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export async function ensureMembership(user: User, invitation = "") {
  if (!user.email_confirmed_at)
    throw new Error("Verify your email before opening a workspace.");
  const service = supabase(undefined, true);
  const name =
    typeof user.user_metadata?.name === "string"
      ? user.user_metadata.name.trim().slice(0, 100)
      : user.email?.split("@")[0] || "Member";
  if (invitation) {
    if (!/^[a-f0-9]{64}$/.test(invitation))
      throw new Error("Invalid invitation link.");
    const { error } = await service.rpc("crm_accept_invitation", {
      hashed_token: hashInvitation(invitation),
      verified_user: user.id,
      member_name: name || "Member",
    });
    if (error?.code === "P0701")
      throw new Error(
        "This company's included seats are full. Ask the company admin to arrange an additional seat, then sign in through your invitation again.",
      );
    if (error)
      throw new Error(
        "Cannot accept this invitation. Check the invited email, expiry, and whether you already belong to another business.",
      );
    return;
  }
  const { data: member, error } = await service
    .from("crm_members")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();
  if (error)
    throw new Error("Workspace setup is unavailable. Please try again later.");
  if (member) return;
  const organization = user.user_metadata?.organization;
  if (
    user.user_metadata?.crm_signup !== true ||
    typeof organization !== "string" ||
    !organization.trim() ||
    organization.length > 150
  )
    throw new Error(
      "Open your invitation link to join your team, or register a business account.",
    );
  const { error: provisionError } = await service.rpc(
    "crm_provision_organization",
    {
      owner_user: user.id,
      organization_name: organization.trim(),
      owner_name: name,
    },
  );
  if (provisionError)
    throw new Error(
      "Your email is verified, but workspace setup could not finish. Sign in again to retry.",
    );
}

export async function saveAccountSession(session: Session) {
  (await cookies()).set(cookieName, session.access_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Lax, not strict: this cookie must survive the top-level redirect a third-party
    // OAuth provider (Google) sends the browser back with, which is a cross-site
    // navigation. CSRF protection on mutating requests comes from sameOrigin(), not
    // from Strict here.
    sameSite: "lax",
    path: "/",
    maxAge: session.expires_in,
  });
}

/** Signs the browser in only if the verified identity already belongs to a workspace. */
export async function signInIfMember(user: User, session: Session) {
  const { data: member } = await supabase(session.access_token)
    .from("crm_members")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();
  if (!member) return false;
  await saveAccountSession(session);
  return true;
}
