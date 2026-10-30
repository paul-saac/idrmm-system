export type ProjectInsightDestination = "schedule" | "resources" | "progress" | "costs" | "documents";

export type InsightFact = {
  id: string;
  title: string;
  evidence: string;
  destination: ProjectInsightDestination;
};

export type ProjectInsights = {
  projectId: number;
  generatedAt: string;
  asOfDate: string;
  summary: string;
  findings: (InsightFact & { recommendation: string })[];
};

export type ProjectInsightsResult = { data?: ProjectInsights; error?: string; empty?: boolean };
