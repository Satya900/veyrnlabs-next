import {
  accountsEnabled,
  ensureMembership,
  saveAccountSession,
  signInIfMember,
} from "@/lib/crm/accounts";
import { jsonBody, sameOrigin, supabase } from "@/lib/crm/server";
import {
  accountFields,
  requirePasswordLength,
  signupFields,
} from "@/lib/crm/account-validation";

export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  if (!accountsEnabled())
    return Response.json(
      {
        error:
          "Account registration is not enabled yet. Please contact us for onboarding.",
      },
      { status: 503 },
    );
  try {
    const body = await jsonBody(request, 6000);
    const db = supabase();
    if (body.action === "signup") {
      const f = signupFields(body);
      const { error } = await db.auth.signUp({
        email: f.email,
        password: f.password,
        options: {
          data: {
            name: f.name,
            organization: f.invitation ? "" : f.organization,
            crm_signup: true,
          },
        },
      });
      // Never return user/session data or reveal whether the address already exists.
      if (error)
        return Response.json(
          {
            error:
              "Registration could not be completed. Try again later or sign in if you already have an account.",
          },
          { status: 400 },
        );
      return Response.json({
        ok: true,
        message:
          "Check your email for a verification code. If you already have an account, sign in instead.",
      });
    }
    const f = accountFields(body);
    if (body.action === "resend") {
      await db.auth.resend({ type: "signup", email: f.email });
      return Response.json({
        ok: true,
        message:
          "If verification is pending, a new code will be sent. Check your inbox and spam folder.",
      });
    }
    if (body.action === "request-reset") {
      // Never reveal whether the address has an account.
      await db.auth.resetPasswordForEmail(f.email);
      return Response.json({
        ok: true,
        message:
          "If that email has an account, a reset code is on its way. Check your inbox and spam folder.",
      });
    }
    if (body.action === "reset") {
      if (typeof body.code !== "string" || !/^\d{6,10}$/.test(body.code))
        throw new Error("Enter the reset code from your email.");
      requirePasswordLength(f.password);
      const { data, error } = await db.auth.verifyOtp({
        email: f.email,
        token: body.code,
        type: "recovery",
      });
      if (error || !data.session || !data.user)
        return Response.json(
          { error: "The code is invalid or expired. Request a new code." },
          { status: 401 },
        );
      const { error: updateError } = await db.auth.updateUser({
        password: f.password,
      });
      if (updateError)
        return Response.json(
          { error: "Unable to reset your password. Try again." },
          { status: 400 },
        );
      const signedIn = await signInIfMember(data.user, data.session);
      return Response.json({
        ok: true,
        ...(signedIn
          ? {}
          : {
              message:
                "Password updated. Ask your workspace owner for an invitation to regain access.",
            }),
      });
    }
    if (body.action !== "verify" && body.action !== "login")
      throw new Error("Unknown account action.");
    if (
      body.action === "verify" &&
      (typeof body.code !== "string" || !/^\d{6,10}$/.test(body.code))
    )
      throw new Error("Enter the verification code from your email.");
    if (body.action === "login" && (!f.password || f.password.length > 1000))
      throw new Error("Enter your password.");
    const { data, error } =
      body.action === "verify"
        ? await db.auth.verifyOtp({
            email: f.email,
            token: body.code as string,
            type: "signup",
          })
        : await db.auth.signInWithPassword({
            email: f.email,
            password: f.password,
          });
    if (error || !data.session || !data.user)
      return Response.json(
        {
          error:
            body.action === "verify"
              ? "The code is invalid or expired. Request a new code."
              : "Unable to sign in. Check your credentials and email verification.",
        },
        { status: 401 },
      );
    await ensureMembership(data.user, f.invitation);
    await saveAccountSession(data.session);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to complete account setup.",
      },
      { status: 400 },
    );
  }
}
