# Invitation onboarding setup

Run `0082_explicit_invitation_completion.sql` after 0081. It removes automatic completion on Auth updates: the server now clears the pending flag only after the setup/recovery form successfully saves a password. Email verification alone must leave the account Invited. Apply this migration before testing the new flow.

Previously completed accounts are not reset automatically because their setup history cannot be reliably inferred. For a test account already marked Active without a known password, use Send Reset Email to set a password. Test the mandatory onboarding gate using a fresh invited account after 0082.

Run `supabase/migrations/0081_invitation_onboarding.sql` after 0080 before deploying the application changes. Existing accounts keep their roles, passwords and access. New Auth users must be created through the app's Invite User action; direct Dashboard user creation/public signup is intentionally rejected by the profile trigger.

## Supabase configuration (required)

1. Authentication > Sign In / Providers: turn OFF **Allow new users to sign up**. Admin invitations remain the onboarding mechanism.
2. Set Authentication > URL Configuration > Site URL to the actual application origin. Set `NEXT_PUBLIC_SITE_URL` to the same origin in the application environment. Use HTTPS in production.
3. Add the exact `https://YOUR-DOMAIN/accept-invite` URL to Redirect URLs. Keep the existing password-recovery redirect URLs. Do not use broad production wildcard URLs.
4. Authentication > Email Templates > Invite user: use this link (the token hash is exchanged server-side, not sent as a browser-fragment session):

```html
<h2>You have been invited to IDR M&amp;M</h2>
<p>Your administrator has invited you to join the company workspace. Set your own password to get started.</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=invite&amp;next=/accept-invite">Set up my account</a></p>
<p>If you were not expecting this invitation, contact your company administrator.</p>
```

5. Configure a supported email delivery provider in Supabase SMTP settings to send to actual employees. The default email service is restricted; code alone does not guarantee delivery. Keep `SUPABASE_SECRET_KEY` server-only.
6. Keep the Reset password email template on the server-side verification flow too. This also supports invited users who verified their email but did not finish setting a password:

```html
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=recovery&amp;next=/reset-password">Set your password</a></p>
```

## Workflow

- Admin chooses name, email and permitted role. No password is collected or shared.
- The server creates a single-use role assignment record, then calls Supabase `inviteUserByEmail`. The profile trigger consumes that record; it never trusts a role from editable user metadata.
- The email link establishes the invited user's session and opens `/accept-invite`.
- Until email confirmation and password setup, the profile is marked `invitation_pending`; project/company data is blocked even if someone manually navigates away from setup.
- Setting a password completes the profile in the database and opens the role's portal. A deactivated account is not reactivated by setup.
- Open an invited account's row and use **Resend invitation**. Unconfirmed emails receive another invitation; already-confirmed emails receive a password-setup recovery email. Both preserve the account ID, role and pending status until password setup completes. Inactive or completed accounts cannot use this action. The button is disabled while sending; the server also checks the last send time and handles provider rate limits.

## Verification before launch

Use a dedicated test recipient, not an existing employee: send an invite, open it in a private browser, set a password, sign out and sign back in. Verify the assigned role, replay/expired links, pending-user access denial, deactivation during setup and admin-vs-super-admin invitation restrictions. Verify the password-reset email template still points to the existing recovery flow. Never log invitation tokens or passwords.

MFA, session-management changes and the other security stages are not included here.
