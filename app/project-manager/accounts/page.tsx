import { redirect } from "next/navigation";

/** Old bookmarked links must not expose an account or access-management page. */
export default function ProjectManagerAccountsPage() {
  redirect("/project-manager");
}
