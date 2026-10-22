import { test } from "node:test";
import assert from "node:assert/strict";
import { emailLinkDestination, isEmailLinkType } from "./email-link.ts";

test("invites always land on setup; recovery retains its local destination", () => {
  assert.equal(emailLinkDestination("invite", "/admin"), "/accept-invite");
  assert.equal(emailLinkDestination("recovery", "/reset-password"), "/reset-password");
});
test("email links cannot redirect off site", () => {
  for (const path of ["https://example.com", "//example.com", "/\\example.com", "/\n/example.com", null]) {
    assert.equal(emailLinkDestination("recovery", path), "/");
  }
  assert.equal(isEmailLinkType("invite"), true);
  assert.equal(isEmailLinkType("recovery"), true);
  assert.equal(isEmailLinkType("admin"), false);
  assert.equal(isEmailLinkType(null), false);
});
