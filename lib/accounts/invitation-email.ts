import "server-only";
import { Resolver } from "node:dns/promises";
import { domainToASCII } from "node:url";

const unavailable = "This email domain does not exist or cannot receive email. Check the email address.";
const retry = "Could not check the email domain right now. Please try again.";

function noRecord(error: unknown) {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOTFOUND" || code === "ENODATA";
}

/** Checks mail routing only. A working domain does not prove that a mailbox exists. */
export async function getInvitationEmailDomainError(email: string): Promise<string | null> {
  const domain = domainToASCII(email.slice(email.lastIndexOf("@") + 1));
  if (!domain || domain.length > 253 || !domain.includes(".") ||
    domain.split(".").some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) {
    return "Enter a valid email address.";
  }

  const resolver = new Resolver({ timeout: 1200, tries: 1 });
  // Bound the entire lookup, including the A/AAAA fallback, without changing global DNS settings.
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; resolver.cancel(); }, 2500);
  try {
    try {
      const records = await resolver.resolveMx(domain);
      if (records.length) {
        // An empty exchange (null MX) explicitly says this domain does not accept mail.
        return records.some(record => record.exchange && record.exchange !== ".") ? null : unavailable;
      }
    } catch (error) {
      if (!noRecord(error)) return retry;
      if ((error as NodeJS.ErrnoException).code === "ENOTFOUND") return unavailable;
    }

    if (timedOut) return retry;
    // SMTP permits delivery to the domain's address when it has no MX record.
    const addresses = await Promise.allSettled([resolver.resolve4(domain), resolver.resolve6(domain)]);
    if (addresses.some(result => result.status === "fulfilled" && result.value.length > 0)) return null;
    return addresses.every(result => result.status === "fulfilled" || noRecord(result.reason)) ? unavailable : retry;
  } finally {
    clearTimeout(timer);
  }
}

export function invitationSendError(error: { code?: string; message: string }): string {
  if (error.code === "email_exists" || error.code === "user_already_exists" || /already/i.test(error.message)) {
    return "An account already uses this email.";
  }
  if (error.code === "email_address_invalid") {
    return "This email address is invalid or cannot receive invitations. Check the email address.";
  }
  if (error.code === "email_address_not_authorized") {
    return "The email service is not configured to send to this address. Contact your system administrator.";
  }
  if (/\b5\.1\.1\b|mailbox (?:does not exist|not found)|user unknown|no such (?:user|recipient)/i.test(error.message)) {
    return "This mailbox does not exist or is unavailable. Check the email address.";
  }
  if (error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit") {
    return "Too many invitations were sent. Please wait a few minutes and try again.";
  }
  return "Could not send the invitation. Check the email delivery configuration and try again.";
}
