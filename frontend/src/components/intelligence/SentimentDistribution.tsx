import { Cell, Pie, PieChart } from "recharts";

const COLORS = {
  positive: "var(--chart-1)",
  neutral: "var(--chart-3)",
  negative: "var(--destructive)",
} as const;

export interface SentimentDistributionProps {
  positivePercentage: number | null;
  negativePercentage: number | null;
  neutralPercentage: number | null;
}

/**
 * CoreMetrics (analytics/coreMetrics.ts) carries positive/negative/neutral
 * as three separate NULLABLE percentages — there is no nested
 * "sentimentDistribution" object on any of the 11 endpoint responses. All
 * three null together (no validated review_sentiment rows yet) renders
 * InsufficientDataState instead of a fabricated empty chart.
 */
export function SentimentDistribution({ positivePercentage, negativePercentage, neutralPercentage }: SentimentDistributionProps) {
  if (positivePercentage === null && negativePercentage === null && neutralPercentage === null) {
    return null; // caller is expected to render InsufficientDataState in this case
  }

  const data: Array<{ name: keyof typeof COLORS; value: number }> = [
    { name: "positive", value: positivePercentage ?? 0 },
    { name: "neutral", value: neutralPercentage ?? 0 },
    { name: "negative", value: negativePercentage ?? 0 },
  ];

  return (
    <div className="flex items-center gap-4">
      <PieChart width={120} height={120}>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={32} outerRadius={56} paddingAngle={2}>
          {data.map((entry: { name: keyof typeof COLORS; value: number }) => (
            <Cell key={entry.name} fill={COLORS[entry.name]} />
          ))}
        </Pie>
      </PieChart>
      <ul className="space-y-1 text-sm">
        {data.map((entry) => (
          <li key={entry.name} className="flex items-center gap-2">
            <span className="inline-block size-2 rounded-full" style={{ backgroundColor: COLORS[entry.name] }} />
            <span className="capitalize">{entry.name}</span>
            <span className="tabular-nums text-muted-foreground">{entry.value}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
