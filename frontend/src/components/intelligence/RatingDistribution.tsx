import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { RatingDistribution as RatingDistributionType } from "@/types/api";

/** Discrete 1-5 star counts (CoreMetrics.ratingDistribution) — a horizontal
 * bar chart, matching the real discrete categorical shape of the data
 * (never a line/area implying continuity that doesn't exist). */
export function RatingDistribution({ distribution }: { distribution: RatingDistributionType }) {
  const data = ([5, 4, 3, 2, 1] as const).map((star) => ({ star: `${star}★`, count: distribution[star] }));

  return (
    <BarChart width={320} height={180} data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
      <XAxis type="number" allowDecimals={false} />
      <YAxis type="category" dataKey="star" width={32} />
      <Bar dataKey="count" fill="var(--chart-1)" radius={[0, 4, 4, 0]} />
    </BarChart>
  );
}
