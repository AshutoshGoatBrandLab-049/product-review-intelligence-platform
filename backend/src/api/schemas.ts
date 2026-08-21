import { z } from "zod";
import { THEME_VOCABULARY } from "../database/appStore/models/reviewTheme.js";

/**
 * Phase 6 Step 2 — §21's "path/query params, especially platform_product_key
 * and window enums, strictly whitelisted" applied literally. Every schema
 * here is the single source of truth for what a request is allowed to look
 * like — no controller inspects req.params/req.query directly.
 */
export const PlatformSchema = z.enum(["flipkart", "myntra"]);
export const NamedWindowSchema = z.enum(["7d", "30d", "60d", "90d", "6m", "12m"]);
export const ThemeSchema = z.enum(THEME_VOCABULARY);

const sourceProductIdField = z.string().trim().min(1).max(200);

export const ProductParamsSchema = z.object({
  platform: PlatformSchema,
  sourceProductId: sourceProductIdField,
});

export const BrandParamsSchema = z.object({
  brand: z.string().trim().min(1).max(200),
});

export const FamilyParamsSchema = z.object({
  familyId: z.string().trim().uuid(),
});

/** YYYY-MM-DD, the same shape review_date uses. */
const isoDateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

/**
 * Analysis window: either one of the six named windows, or an explicit
 * `from`/`to` range.
 *
 * `from` and `to` must be supplied together — half a range is a client bug, and
 * silently falling back to the named window would answer a different question
 * than the one asked without saying so. `to` must not precede `from`.
 */
export const WindowQuerySchema = z
  .object({
    window: NamedWindowSchema.default("30d"),
    from: isoDateField.optional(),
    to: isoDateField.optional(),
  })
  .refine((q) => (q.from === undefined) === (q.to === undefined), {
    message: "from and to must be provided together",
    path: ["from"],
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: "from must be on or before to",
    path: ["from"],
  });

export const RankingsQuerySchema = z.object({
  window: NamedWindowSchema.default("30d"),
  sort: z.enum(["health", "rating"]).default("health"),
  platform: PlatformSchema.optional(),
  brand: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export const ProblemsQuerySchema = z.object({
  window: NamedWindowSchema.default("30d"),
  platform: PlatformSchema.optional(),
  theme: ThemeSchema.optional(),
});

export const EarlyWarningsQuerySchema = z.object({
  window: NamedWindowSchema.default("30d"),
  platform: PlatformSchema.optional(),
  brand: z.string().trim().min(1).max(200).optional(),
});

export const EvidenceReviewsQuerySchema = z.object({
  canonicalReviewIds: z.string().min(1),
  window: NamedWindowSchema.optional(),
});

export const AnalystQuerySchema = z.object({
  question: z.string().min(1).max(500),
  window: NamedWindowSchema.optional(),
  // Phase 10 AI Product Analyst intent/context correction — optional
  // conversation to load prior-turn context from, for resolving ambiguous
  // follow-ups ("show me", "why?"). Absence just means no context is used.
  conversationId: z.string().trim().uuid().optional(),
});

export const ProductReviewsQuerySchema = z.object({
  window: NamedWindowSchema.default("30d"),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  sentiment: z.enum(["positive", "neutral", "negative"]).optional(),
  theme: ThemeSchema.optional(),
});

export type ProductParams = z.infer<typeof ProductParamsSchema>;
export type BrandParams = z.infer<typeof BrandParamsSchema>;
export type FamilyParams = z.infer<typeof FamilyParamsSchema>;
export type WindowQuery = z.infer<typeof WindowQuerySchema>;
export type RankingsQuery = z.infer<typeof RankingsQuerySchema>;
export type ProblemsQuery = z.infer<typeof ProblemsQuerySchema>;
export type EarlyWarningsQuery = z.infer<typeof EarlyWarningsQuerySchema>;
export type EvidenceReviewsQuery = z.infer<typeof EvidenceReviewsQuerySchema>;
export type AnalystQuery = z.infer<typeof AnalystQuerySchema>;
export type ProductReviewsQuery = z.infer<typeof ProductReviewsQuerySchema>;
