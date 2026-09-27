import { usableMonths, usableWeeks, type UsablePoint } from '../data/aggregate.js';
import { groupByWeek } from '../data/aggregate.js';
import type { Comparison, Evidence, LanguageAnalysis } from '../types/analysis.js';
import { formatViews, formatSignedPercent, round } from '../utils/numbers.js';
import { weakest } from './evidence.js';
import { MIN_MONTHS_FOR_MONTHLY_WINDOWS } from './metrics.js';

/** Relative-growth differences below this (percentage points) are reported as not meaningful. */
export const SMALL_DIFFERENCE_PP = 10;

type Analyzed = LanguageAnalysis & { metrics: NonNullable<LanguageAnalysis['metrics']> };

function isAnalyzed(l: LanguageAnalysis): l is Analyzed {
  return l.metrics !== null;
}

/**
 * Normalised growth index: 100 = the language's own baseline-window average daily views.
 * The latest-window value is therefore exactly 100 + percentChange, which keeps the index,
 * the metrics table and the charts numerically consistent.
 */
export function normalizedIndexSeries(
  points: readonly UsablePoint[],
  baseline: number,
): { period: string; index: number | null }[] {
  return points.map((p) => ({
    period: p.period,
    index: baseline > 0 ? round((p.averageDailyViews / baseline) * 100, 2) : null,
  }));
}

function usablePeriods(l: LanguageAnalysis, granularity: 'month' | 'week'): UsablePoint[] {
  if (granularity === 'month') return usableMonths(l.monthly);
  const first = l.daily[0]?.date;
  const last = l.daily.at(-1)?.date;
  if (first === undefined || last === undefined) return [];
  return usableWeeks(groupByWeek(l.daily, first, last));
}

const STRENGTH_ORDER = { high: 2, moderate: 1, low: 0 } as const;

/** Order languages by a metric, highest first; languages without the metric are omitted. */
function rankBy(langs: readonly Analyzed[], value: (l: Analyzed) => number | null): string[] {
  return langs
    .flatMap((l) => {
      const v = value(l);
      return v === null ? [] : [{ language: l.language, v }];
    })
    .sort((a, b) => b.v - a.v)
    .map((x) => x.language);
}

export function buildRankings(langs: readonly Analyzed[]): Comparison['rankings'] {
  return {
    absoluteViews: rankBy(langs, (l) => l.metrics.averageDailyViews),
    relativeGrowth: rankBy(langs, (l) => l.metrics.percentChange),
    trendPerPeriod: rankBy(langs, (l) => l.trend.normalizedSlope),
    shareOfEditionChange: rankBy(langs, (l) => l.projectNormalized?.percentChange ?? null),
    evidenceStrength: rankBy(
      langs,
      (l) => STRENGTH_ORDER[l.evidence.strength] * 1000 + l.evidence.score,
    ),
  };
}

const EDITION_ORDER = {
  outperformed_edition: 2,
  in_line_with_edition: 1,
  declined_faster_than_edition: 0,
} as const;

export const RESEARCH_NOTE =
  'Order of candidates for further research, based only on Wikipedia attention: evidence strength (at least moderate first), movement relative to the whole edition, relative change, then audience size. It does not measure demand or market potential; validate with other data before deciding.';

/**
 * Deterministic "which audiences to research next" ordering with data-derived reasons, so an
 * agent can present a recommendation without inventing criteria, causes or market claims.
 */
export function researchCandidates(langs: readonly Analyzed[]): Comparison['researchCandidates'] {
  const n = langs.length;
  const pos = (ranking: readonly string[], lang: string): string =>
    `rank ${String(ranking.indexOf(lang) + 1)} of ${String(n)}`;
  const rankings = buildRankings(langs);
  const allDeclined = langs.every((l) => (l.metrics.percentChange ?? 0) < 0);
  const key = (l: Analyzed): number[] => [
    l.evidence.strength === 'low' ? 0 : 1,
    l.projectNormalized?.relativeToEdition
      ? EDITION_ORDER[l.projectNormalized.relativeToEdition]
      : 1,
    l.metrics.percentChange ?? Number.NEGATIVE_INFINITY,
    l.metrics.averageDailyViews,
  ];
  const sorted = [...langs].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) {
      const d = (kb[i] ?? 0) - (ka[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  });
  return sorted.map((l, i) => {
    const reasons = [
      `relative change ${formatSignedPercent(l.metrics.percentChange)} (${pos(rankings.relativeGrowth, l.language)})`,
      ...(l.projectNormalized?.interpretation ? [l.projectNormalized.interpretation] : []),
      `audience ${formatViews(l.metrics.averageDailyViews)} views/day (${pos(rankings.absoluteViews, l.language)}; reflects edition size)`,
      `evidence strength ${l.evidence.strength}`,
    ];
    const cautions = [
      ...(l.evidence.strength === 'low' ? ['low evidence: treat as a weak hint only'] : []),
      ...(l.outliers.influence?.material ? ['the change depends on spikes'] : []),
      ...(allDeclined
        ? ['all compared languages declined; this ranks relative resilience, not growth']
        : []),
      ...l.evidence.warnings.slice(0, 1),
    ];
    return { language: l.language, rank: i + 1, reasons, cautions };
  });
}

export function compareLanguages(all: readonly LanguageAnalysis[]): Comparison | null {
  const analyzed = all.filter(isAnalyzed);
  if (analyzed.length < 2) return null;

  const absolute = [...analyzed]
    .sort((a, b) => b.metrics.averageDailyViews - a.metrics.averageDailyViews)
    .map((l, i) => ({
      language: l.language,
      averageDailyViews: l.metrics.averageDailyViews,
      totalViews: l.metrics.totalViews,
      rank: i + 1,
    }));

  const withGrowth = analyzed.filter((l) => l.metrics.percentChange !== null);
  const growthSorted = [...withGrowth].sort(
    (a, b) => (b.metrics.percentChange ?? 0) - (a.metrics.percentChange ?? 0),
  );
  const relativeGrowth = [
    ...growthSorted.map((l, i) => ({
      language: l.language,
      percentChange: l.metrics.percentChange,
      rank: i + 1,
    })),
    ...analyzed
      .filter((l) => l.metrics.percentChange === null)
      .map((l) => ({ language: l.language, percentChange: null, rank: null })),
  ];

  const granularity = analyzed.every(
    (l) => usableMonths(l.monthly).length >= MIN_MONTHS_FOR_MONTHLY_WINDOWS,
  )
    ? 'month'
    : 'week';
  const series: Comparison['normalizedIndex']['series'] = {};
  const final: Comparison['normalizedIndex']['final'] = {};
  for (const l of analyzed) {
    series[l.language] = normalizedIndexSeries(
      usablePeriods(l, granularity),
      l.metrics.baseline.averageDailyViews,
    );
    final[l.language] =
      l.metrics.percentChange === null ? null : round(100 + l.metrics.percentChange, 2);
  }

  const projectShare = analyzed.map((l) => ({
    language: l.language,
    averagePerMillion: l.projectNormalized?.averagePerMillion ?? null,
    percentChange: l.projectNormalized?.percentChange ?? null,
  }));

  const highlights: string[] = [];
  const topAbs = absolute[0];
  if (topAbs) {
    highlights.push(
      `Largest absolute audience: ${topAbs.language} (${formatViews(topAbs.averageDailyViews)} average daily views). Absolute views reflect the size of each Wikipedia edition, not only interest in the topic.`,
    );
  }
  const topGrowth = growthSorted[0];
  const secondGrowth = growthSorted[1];
  if (topGrowth) {
    const change = topGrowth.metrics.percentChange ?? 0;
    const lead =
      change > 0
        ? 'Highest relative growth'
        : change < 0
          ? 'Smallest decline (all compared languages declined)'
          : 'Best relative change (no language grew)';
    highlights.push(
      `${lead} (baseline → latest window): ${topGrowth.language} (${formatSignedPercent(change)}; index ${String(final[topGrowth.language] ?? 'n/a')}).`,
    );
  }
  if (topGrowth && topAbs && topGrowth.language !== topAbs.language) {
    highlights.push('Absolute popularity and relative growth rank the languages differently.');
  }
  if (topGrowth && secondGrowth) {
    const gap = (topGrowth.metrics.percentChange ?? 0) - (secondGrowth.metrics.percentChange ?? 0);
    if (gap < SMALL_DIFFERENCE_PP) {
      highlights.push(
        `The growth difference between ${topGrowth.language} and ${secondGrowth.language} is small (${String(round(gap, 1))} percentage points) and should not be over-interpreted.`,
      );
    }
  }
  const rankings = buildRankings(analyzed);
  const byTrend = analyzed.filter((l) => l.trend.normalizedSlope !== null);
  if (byTrend.length >= 2) {
    const first = byTrend.find((l) => l.language === rankings.trendPerPeriod[0]);
    const last = byTrend.find((l) => l.language === rankings.trendPerPeriod.at(-1));
    const unit = (l: Analyzed | undefined): string => l?.trend.granularity ?? 'period';
    if (first && last) {
      highlights.push(
        `Trend per ${unit(first)} (log-linear): strongest ${first.language} (${formatSignedPercent(first.trend.normalizedSlope, 2)}), weakest ${last.language} (${formatSignedPercent(last.trend.normalizedSlope, 2)}).`,
      );
    }
  }
  for (const s of projectShare) {
    if (s.percentChange === null) continue;
    const l = analyzed.find((x) => x.language === s.language);
    const projectChange = l?.projectNormalized?.projectPercentChange ?? null;
    highlights.push(
      `${s.language}: share of all ${s.language}.wikipedia pageviews changed ${formatSignedPercent(s.percentChange)} (edition-wide traffic changed ${formatSignedPercent(projectChange)}).`,
    );
  }

  const levels = analyzed.map((l) => l.evidence.strength);
  const weakestLevel = weakest(levels);
  const evidence: Evidence = {
    strength: weakestLevel,
    score: Math.min(...analyzed.map((l) => l.evidence.score)),
    reasons: [
      `overall strength is the weakest language's (${analyzed.map((l) => `${l.language}: ${l.evidence.strength}`).join(', ')})`,
      ...analyzed.map((l) => `${l.language}: ${l.evidence.reasons.slice(0, 2).join('; ')}`),
    ],
    warnings: [
      ...analyzed.flatMap((l) => l.evidence.warnings.slice(0, 2).map((w) => `${l.language}: ${w}`)),
      'languages have differently sized audiences; compare relative growth (index) rather than absolute views when judging momentum',
      ...(all.length > analyzed.length
        ? [
            `not compared (no usable data): ${all
              .filter((l) => !isAnalyzed(l))
              .map((l) => l.language)
              .join(', ')}`,
          ]
        : []),
    ],
  };

  return {
    languages: analyzed.map((l) => l.language),
    absolute,
    relativeGrowth,
    rankings,
    researchCandidates: researchCandidates(analyzed),
    researchNote: RESEARCH_NOTE,
    normalizedIndex: {
      base: '100 = average daily views in each language’s baseline window',
      granularity,
      series,
      final,
    },
    projectShare,
    highlights,
    evidence,
  };
}
