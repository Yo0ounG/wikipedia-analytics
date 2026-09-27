/** Structured content of the one-page report. The PDF renderer only lays this out. */
export interface ReportMetricRow {
  language: string;
  article: string;
  averageDaily: string;
  baselineToLatest: string;
  change: string;
  yearOverYear: string;
  trend: string;
  evidence: string;
}

export interface ReportChart {
  title: string;
  svg: string;
}

export interface ReportContent {
  title: string;
  subtitle: string;
  meta: { label: string; value: string }[];
  keyFindings: string[];
  charts: ReportChart[];
  metricsTable: ReportMetricRow[];
  evidence: { strength: string; points: string[] };
  limitations: string[];
  dataSource: string;
  generatedAt: string;
}
