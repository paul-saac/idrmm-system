import { redirect } from "next/navigation";

/** A super admin's end is the admin's own now — everything in it, with
 * Administrator accounts under Accounts — so an old link here goes there. */
export default function SuperAdminPage() {
  redirect("/admin");
}
