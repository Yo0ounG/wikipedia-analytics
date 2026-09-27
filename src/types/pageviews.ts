/** Canonical internal pageview models. Raw Wikimedia response objects never reach this layer. */

export const ACCESS_TYPES = ['all-access', 'desktop', 'mobile-app', 'mobile-web'] as const;
export type AccessType = (typeof ACCESS_TYPES)[number];

/**
 * `user` = human traffic after Wikimedia's spider and automated-traffic filtering.
 * `all-agents` includes identified spiders and automated agents.
 */
export const AGENT_TYPES = ['user', 'all-agents'] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

export interface PageviewPoint {
  date: string;
  views: number;
}

export interface TimeSeries {
  language: string;
  project: string;
  qid: string;
  articleTitle: string;
  startDate: string;
  endDate: string;
  access: AccessType;
  agent: AgentType;
  points: PageviewPoint[];
}

export interface MonthlyPoint {
  month: string;
  views: number;
  reportedDays: number;
  expectedDays: number;
  /** Mean views per reported day; null when no day was reported. */
  averageDailyViews: number | null;
  /** True when every calendar day of the month is inside the analysis period and reported. */
  complete: boolean;
}

export interface WeeklyPoint {
  weekStart: string;
  views: number;
  reportedDays: number;
  expectedDays: number;
  averageDailyViews: number | null;
  complete: boolean;
}

export interface RollingPoint {
  date: string;
  value: number | null;
}
