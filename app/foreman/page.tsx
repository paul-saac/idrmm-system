import type { Metadata } from "next";
import { DashboardView } from "@/components/admin/dashboard/dashboard-view";

export const metadata: Metadata = { title: "Dashboard" };

export default function ForemanDashboardPage() {
  return <DashboardView basePath="/foreman" />;
}
