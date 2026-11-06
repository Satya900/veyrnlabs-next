import "server-only";
import { createHash } from "node:crypto";
import type { User, Session } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import {
  configured,
  cookieName,
  organizationCookieName,
  supabase,
  type Membership,
} from "./server";

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
    const { data: organization, error } = await service.rpc("crm_accept_invitation", {
      hashed_token: hashInvitation(invitation),
      verified_user: user.id,
      member_name: name || "Member",
    });
    if (error?.code === "P0701")
      throw new Error(
        "This company's included seats are full. Ask the company admin to arrange an additional seat, then sign in through your invitation again.",
      );
    if (error?.message?.includes("Verified email required"))
      throw new Error("Verify your email before accepting this invitation.");
    if (error)
      throw new Error(
        "This invitation can't be used. It may have expired, been revoked or replaced, or been sent to a different email than the one you signed in with. Ask for a new link.",
      );
    // Open the business the person was just invited to, even if they belong to others.
    if (typeof organization === "string") await selectOrganization(organization);
    return;
  }
  const { data: members, error } = await service
    .from("crm_members")
    .select("id")
    .eq("user_id", user.id)
    .limit(1);
  if (error)
    throw new Error("Workspace setup is unavailable. Please try again later.");
  if (members.length) return;
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

/** True when the login has at least one membership with an active seat. */
export async function hasWorkspace(accessToken: string) {
  const { data } = await supabase(accessToken).rpc("crm_my_memberships");
  return ((data ?? []) as Membership[]).some((m) => m.active);
}

export async function selectOrganization(organizationId: string) {
  (await cookies()).set(organizationCookieName, organizationId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
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
export async function signInIfMember(session: Session) {
  if (!(await hasWorkspace(session.access_token))) return false;
  await saveAccountSession(session);
  return true;
}
