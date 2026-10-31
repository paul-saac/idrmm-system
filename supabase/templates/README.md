# IDR M&M authentication emails

These HTML files are ready to paste into the hosted Supabase project's email templates. Adding them to the repository or deploying the website does **not** update Supabase's hosted email templates.

## Invite user

In Supabase, open **Authentication → Email → Templates → Invite user** (some dashboard versions label this **Email Templates**).

- Subject: `You're invited to IDR M&M — Set up your account`
- Body/source: copy the entire contents of [invite-user.html](invite-user.html).
- Save the template.

The greeting uses the `first_name` metadata already supplied by account invitations. Without a name it displays “Hi there,”. Both the button and fallback URL use the current `/auth/confirm` token verification flow before opening `/accept-invite`.

## Reset password / verified invitation resends

The system uses a recovery email when an invited user has verified their email but has not finished account setup. To give those resends the same design, also update **Reset password**:

- Subject: `Continue to your IDR M&M account`
- Body/source: copy the entire contents of [reset-password.html](reset-password.html).
- Save the template.

This template checks the requested redirect: setup resends lead to `/accept-invite`; ordinary password resets lead to `/reset-password`. Both keep `type=recovery` for token verification.

## Logo and destination

- Logo: the existing public asset at `https://idrmm.online/logo.png`.
- Supabase **Authentication → URL Configuration → Site URL** must be `https://idrmm.online` (without a trailing slash).
- Keep the existing allowed redirect URLs for `/accept-invite` and `/auth/confirm?next=/reset-password`.
- No password policy, role assignment, account verification, SMTP, or expiry settings are changed by these templates.

## Check before using

Preview the templates in Supabase, then send a fresh invitation to a test recipient you control. Check the greeting, logo, button and fallback link, and complete account setup. Also check a verified invitation resend and an ordinary password reset. Use the newest email for each attempt; testing a link consumes its token.

Rendered examples under `deliverables/email-templates/` use fictional recipient details and a non-working preview token. They are previews, not the source to paste into Supabase.

Template variable reference: <https://supabase.com/docs/guides/auth/auth-email-templates>.
