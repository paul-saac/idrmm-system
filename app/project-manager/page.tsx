import type { Metadata } from "next";
import { DashboardView } from "@/components/admin/dashboard/dashboard-view";

export const metadata: Metadata = { title: "Project Manager Dashboard" };

export default function ProjectManagerPage() {
  return <DashboardView basePath="/project-manager" />;
}
