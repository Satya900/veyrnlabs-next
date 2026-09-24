# Signup, verification, and invitations

## Implemented

- `/crm/signup`: business name, owner name, email, password, and verification-code entry.
- `/api/crm/account`: server-side signup, resend, verification, and sign-in completion. It never returns access tokens to browser JavaScript.
- Confirmed business accounts provision their organisation and real estate stages idempotently. A failed provisioning attempt can be retried by signing in again.
- Settings → Your team: owners/admins generate invitation links and list/revoke invitations. Owners can invite admins or team members; admins can invite team members only.
- `/crm/join#TOKEN`: invitees sign in or create and verify an account, then join the invited organisation. Invitation tokens are stored as SHA-256 hashes and expire after seven days. They are carried in the URL fragment to avoid request/access-log exposure.
- Invitation acceptance checks the current verified email in `auth.users`, inviter authority, expiry/revocation, and existing membership. Existing members retain their roles. An account belonging to another organisation cannot be moved by an invitation.
- No automatic invitation emails are sent. The owner copies the generated link and shares it with its intended recipient. Signup/verification email is sent by Supabase Auth in response to user actions.
- `/crm/reset`: requests a password reset code by email, then exchanges the code and a new password for a session, reusing the same OTP-by-code pattern as signup rather than a clickable recovery link. Never reveals whether an email has an account. A successful reset signs the member back in only if they still belong to a workspace; otherwise the password is changed but no session is created.
- Settings > Your team: the owner can transfer ownership to any other existing member (`crm_transfer_ownership`), which demotes the current owner to admin in the same atomic call. A partial unique index guarantees exactly one owner per organisation at all times. Owners and admins can remove members (`crm_remove_member`); admins may remove team members only, nobody can remove the owner without transferring first, and a non-owner may remove their own membership. Removal unassigns the member's leads and clients rather than deleting that history.

## Activation steps

1. Keep `CRM_SIGNUP_ENABLED` unset or `false` until ready. Existing member sign-in continues to work with registration disabled.
2. Apply `supabase/migrations/202609230001_crm_invitations.sql` after the organisation migration, then `supabase/migrations/202609240006_crm_member_lifecycle.sql` for ownership transfer and member removal. Both are only tested locally; neither has been applied by the development task.
3. In Supabase Auth, enable email/password signup and **Confirm email**. Configure production SMTP and appropriate Auth rate limits. Keep email confirmation enabled: the intended flow requires a code before workspace provisioning.
4. Update the Supabase **Confirm signup** email template to show the code, e.g. `Your Veyrn CRM verification code is {{ .Token }}`. The app uses OTP entry, not an implicit-flow link callback. Configure the sender and test code delivery/expiry in staging. Do not promise successful delivery based on the local tests. Update the **Reset Password** template the same way, e.g. `Your Veyrn CRM reset code is {{ .Token }}`; `/crm/reset` also expects a code, not a link.
5. Configure server-side `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. Never expose the service-role key through a public environment variable or browser bundle.
6. Set `CRM_SIGNUP_ENABLED=true` in the intended deployment and restart/redeploy. The gate covers signup, code verification/resend, invitation creation/revocation, and new-member provisioning from ordinary login.
7. Test a new owner signup with a real staging mailbox: no workspace before verification, correct code provisions one workspace, signing in again does not create a duplicate. Confirm existing owner sign-in still works.
8. Test invitation signup and existing-user acceptance with the exact invited mailbox. Check wrong-email, expired, revoked, replaced, and already-in-another-business cases. Test owner versus admin invitation roles and team-member denial.

## Test coverage and limits

`npm run test:crm` covers pure input validation, PostgreSQL RLS/provisioning/invitation rules, and existing CRM regressions. UI checks and production compilation are separate. Supabase email delivery and live Auth verification have not been exercised against a hosted project in this task. Do a staging end-to-end check before public activation.

Account creation grants access to the basic workspace; it does not activate a paid subscription, charge a customer, or implement AI features. The existing access-token cookie expires with the Supabase access token and requires a new sign-in; refresh-token rotation and paid entitlements remain follow-up work, deliberately out of scope for this phase. No production auth settings or database records were changed by this implementation.
