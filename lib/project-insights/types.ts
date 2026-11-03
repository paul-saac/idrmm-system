export type ProjectInsightDestination = "schedule" | "resources" | "progress" | "costs" | "documents";

export type InsightFact = {
  id: string;
  title: string;
  evidence: string;
  destination: ProjectInsightDestination;
  /** Data-readiness actions are supplied by the server, not inferred by AI. */
  recommendedAction?: string;
};

export type ProjectInsights = {
  projectId: number;
  generatedAt: string;
  asOfDate: string;
  summary: string;
  findings: (InsightFact & { recommendation: string })[];
  schedule?: {
    risk: "low" | "medium" | "high" | "unassessed" | "completed";
    reason: string;
    targetDate: string | null;
    forecastDate: string | null;
    differenceDays: number | null;
    delayedTasks: number;
  };
};

export type ProjectInsightsResult = { data?: ProjectInsights; error?: string; empty?: boolean };
