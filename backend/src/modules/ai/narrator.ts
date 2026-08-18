import { z } from "zod";
import { THEME_VOCABULARY } from "../../database/appStore/models/reviewTheme.js";
import type { ProductEvidencePackage } from "./evidencePackage.js";
import type { AiProvider } from "./providers/aiProvider.js";
import type { AnalyticalIntent } from "./intentDetection.js";
import type { SemanticAspectData } from "./types.js";

/**
 * Phase 4.1 remediation (numerical-claim grounding) — the exact scalar
 * numeric fields on ProductEvidencePackage a narrator is allowed to cite by
 * name in `citedMetrics`. Deliberately scoped to top-level scalars only
 * (least invasive design) — sentimentDistribution's/ratingDistribution's/
 * topThemes' per-bucket numbers are NOT individually citable this way; see
 * the "known limitation" note on narrateProductEvidence() below.
 */
export const CITABLE_METRIC_FIELDS = [
  "reviewCount",
  "averageRating",
  "positivePercentage",
  "negativePercentage",
  "totalMatchingNegativeCount",
] as const;
export type CitableMetricField = (typeof CITABLE_METRIC_FIELDS)[number];

const NarratorOutputSchema = z.object({
  summary: z.string().min(1).max(1000),
  /**
   * Phase 4.1 remediation — optional structural channel for evidence-backed
   * numeric claims. A narrator that wants a number in `summary`/`explanation`/
   * `reason` to be verifiable should ALSO record it here, naming the exact
   * evidence-package field it came from — this is what narrateProductEvidence()
   * deterministically checks against the real package (never another model
   * judging correctness). Optional: existing narrator output with no
   * citedMetrics at all remains valid (backward compatible).
   */
  citedMetrics: z
    .array(
      z.object({
        field: z.string(),
        statedValue: z.number(),
      }),
    )
    .max(10)
    .optional(),
  rootCause: z
    .array(
      z.object({
        // Phase 10 AI Product Analyst intent/context correction — relaxed
        // from z.enum(THEME_VOCABULARY) to a bounded free string so a
        // genuinely-discovered semantic aspect (e.g. "zip broke", "battery
        // dies quickly") can be NAMED as the root cause, not just cited
        // under a mislabeled fixed theme. Deterministically re-validated
        // below (against THEME_VOCABULARY ∪ discovered aspects) — never
        // trusted as-is; an arbitrary invented string is still rejected.
        theme: z.string().min(1).max(80),
        explanation: z.string().min(1).max(500),
        evidenceReviewIds: z.array(z.string()).max(10),
      }),
    )
    .max(5),
  recommendations: z
    .array(
      z.object({
        reason: z.string().min(1).max(500),
        evidenceReviewIds: z.array(z.string()).max(10),
        confidence: z.number().min(0).max(1),
        // Phase 4.1 remediation item 1 — optional: a recommendation tied to a
        // specific theme gets the same deterministic relevance check as
        // rootCause; a recommendation with no theme (general advice) is
        // exempt from relevance filtering, still ID-existence checked only.
        theme: z.string().min(1).max(80).nullable().optional(),
      }),
    )
    .max(5),
});

export type NarratorOutput = z.infer<typeof NarratorOutputSchema>;

export interface NarratorResult {
  summary: string;
  rootCause: NarratorOutput["rootCause"];
  recommendations: NarratorOutput["recommendations"];
  /** IDs the model cited that were NOT in the evidence package at all — stripped, never silently trusted (Phase 4 §4). */
  rejectedCitations: string[];
  /**
   * Phase 4.1 remediation item 1 — IDs that WERE valid, real evidence-package
   * IDs, but were cited in support of a theme claim the evidence package's
   * reviewThemes mapping does NOT actually associate with that review. This is
   * the citation-*relevance* gap Step 10 of Phase 4.1 found (a real Gemini
   * narrator attributed themes to reviews with zero supporting theme
   * evidence) — distinguished from rejectedCitations (nonexistent IDs) so the
   * two failure modes stay individually auditable.
   */
  irrelevantCitations: string[];
  /**
   * A rootCause or recommendation entry whose evidenceReviewIds became empty
   * after relevance filtering (i.e. it had no grounded support left) is
   * dropped entirely, not just stripped of its bad citations — an unsupported
   * claim is not a partially-supported one. Counts how many were dropped.
   */
  droppedUnsupportedClaims: number;
  /**
   * Phase 4.1 remediation — citedMetrics entries that were deterministically
   * verified: field is a known citable field, and statedValue matches the
   * real evidencePackage[field] (within float-rounding tolerance). Only
   * verified metrics ever appear here — a mismatch or unknown field is
   * stripped into ungroundedMetrics instead, never silently kept.
   */
  citedMetrics: Array<{ field: CitableMetricField; statedValue: number }>;
  /**
   * citedMetrics entries that did NOT verify — either the field isn't a
   * recognized citable field ("unknown_field"), or the stated value doesn't
   * match the real evidence-package value ("value_mismatch"). This is the
   * exact original Step 10 scenario (evidence=42, narrator=45), now made
   * checkable — PROVIDED the narrator used citedMetrics for the claim in the
   * first place. A number stated only in free-form prose, with no
   * corresponding citedMetrics entry, is NOT covered by this check — see
   * narrateProductEvidence()'s doc comment for why this is a real, disclosed
   * boundary, not a gap in this specific mechanism.
   */
  ungroundedMetrics: Array<{ field: string; statedValue: number; reason: "unknown_field" | "value_mismatch" }>;
}

/**
 * Phase 4 §16-18 — the narrator receives ONLY the deterministic evidence
 * package (never raw reviews, never a fresh DB query of its own). Its
 * output is schema-validated, then every cited canonical_review_id is
 * checked against the package's own evidenceReviewIds — an ID the model
 * invents is stripped from the result, logged, and never persisted or
 * trusted as if it were real (Phase 4 §4's "never trust review IDs returned
 * by an LLM unless validated against the database" — validated here against
 * the package, which is itself sourced from the database).
 *
 * Phase 4.1 remediation (numerical-claim grounding, following the original
 * Step 10 finding that a wrong number in `summary` passes through
 * completely unflagged): `citedMetrics` entries are verified the same way —
 * deterministic comparison against the real evidencePackage field, never
 * another model judging correctness. A mismatch or unknown field is
 * stripped into `ungroundedMetrics`, never silently trusted.
 *
 * Phase 10 Step 3: userQuestion and analyticalIntent are optionally passed
 * to the provider so it can contextualize responses (e.g., answer "What's
 * the biggest issue?" differently than "What's the average rating?").
 *
 * IMPORTANT, DISCLOSED BOUNDARY: this ONLY verifies numbers the narrator
 * chose to also place in `citedMetrics`. A number written ONLY in free-form
 * prose (`summary`/`explanation`/`reason`), with no corresponding
 * citedMetrics entry, is NOT parsed out of that text and is NOT verified —
 * free text is fundamentally not fully constrainable without abandoning
 * free text entirely, which this design does not attempt. The prompts sent
 * to real providers instruct them to always populate citedMetrics for a
 * number they state, but that is a request, not a structural guarantee — a
 * non-compliant model output can still contain an unverified prose number.
 * Do not read "citedMetrics are grounded" as "every number in this result is
 * grounded" — it is not, and this comment exists so nobody claims otherwise.
 */
export async function narrateProductEvidence(
  evidencePackage: ProductEvidencePackage,
  provider: AiProvider,
  userQuestion?: string,
  analyticalIntent?: AnalyticalIntent,
): Promise<NarratorResult> {
  const raw = await provider.narrate(evidencePackage, userQuestion, analyticalIntent);
  const parsed = NarratorOutputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Narrator output failed schema validation: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  }

  // Phase 10 Step 3: Augment reviewThemes with semantic analysis results
  // so that semantic-discovered aspects pass Phase 4.1 validation
  const augmentedReviewThemes = { ...evidencePackage.reviewThemes };
  const semanticAnalysis = (evidencePackage as any).semanticAnalysis;
  if (semanticAnalysis && semanticAnalysis.aspects) {
    for (const aspect of semanticAnalysis.aspects) {
      for (const reviewId of aspect.reviewIds) {
        augmentedReviewThemes[reviewId] ??= [];
        if (!augmentedReviewThemes[reviewId].includes(aspect.aspect)) {
          augmentedReviewThemes[reviewId].push(aspect.aspect);
        }
      }
    }
  }

  const validIds = new Set(evidencePackage.evidenceReviewIds);
  const rejectedCitations: string[] = [];
  const irrelevantCitations: string[] = [];

  function filterIds(ids: string[]): string[] {
    return ids.filter((id) => {
      if (validIds.has(id)) return true;
      rejectedCitations.push(id);
      return false;
    });
  }

  /**
   * Phase 4.1 remediation item 1 — deterministic claim-to-evidence relevance
   * check. An ID that exists but whose reviewThemes entry doesn't contain the
   * claimed theme is exactly the Step 10 failure mode (real Gemini output,
   * zero theme evidence, confident attribution anyway) — stripped here, never
   * asked of another model to judge ("do not solve this by asking Gemini").
   *
   * Phase 10 Step 3: Now also includes semantic-discovered aspects, so that
   * semantic analysis results are trusted and not filtered out.
   */
  function filterRelevant(ids: string[], theme: string): string[] {
    return ids.filter((id) => {
      if ((augmentedReviewThemes[id] ?? []).includes(theme)) return true;
      irrelevantCitations.push(id);
      return false;
    });
  }

  let droppedUnsupportedClaims = 0;

  // Phase 10 AI Product Analyst intent/context correction — deterministic
  // theme-name validation. Now that `theme` is a bounded string rather than
  // a hard enum, the model is structurally able to name a discovered aspect
  // — but it is NOT trusted to invent an arbitrary string. A theme is only
  // accepted if it is either one of the fixed THEME_VOCABULARY values or a
  // name the backend's own semantic-analysis pass actually discovered for
  // THIS product/window (never another model judging plausibility).
  const knownThemes = new Set<string>(THEME_VOCABULARY as readonly string[]);
  const discoveredAspects: SemanticAspectData[] = semanticAnalysis?.aspects ?? [];
  const discoveredAspectNames = new Map<string, string>();
  for (const aspect of discoveredAspects) {
    discoveredAspectNames.set(aspect.aspect.toLowerCase(), aspect.aspect);
  }
  function validateThemeName(theme: string): string | null {
    if (knownThemes.has(theme)) return theme;
    const discovered = discoveredAspectNames.get(theme.toLowerCase());
    if (discovered) return discovered;
    return null;
  }

  const rootCause = parsed.data.rootCause
    .map((rc) => {
      const validatedTheme = validateThemeName(rc.theme);
      if (!validatedTheme) return null;
      return {
        ...rc,
        theme: validatedTheme,
        evidenceReviewIds: filterRelevant(filterIds(rc.evidenceReviewIds), validatedTheme),
      };
    })
    .filter((rc): rc is NonNullable<typeof rc> => {
      if (!rc) {
        droppedUnsupportedClaims++;
        return false;
      }
      if (rc.evidenceReviewIds.length > 0) return true;
      droppedUnsupportedClaims++;
      return false;
    });

  const recommendations = parsed.data.recommendations
    .map((r) => {
      const validatedTheme = r.theme ? validateThemeName(r.theme) : null;
      const idChecked = filterIds(r.evidenceReviewIds);
      const evidenceReviewIds = validatedTheme ? filterRelevant(idChecked, validatedTheme) : idChecked;
      // An invented (unvalidatable) theme is stripped to null rather than
      // trusted — falls back to "general advice" treatment (ID-existence
      // checked only, no relevance filter tied to a fabricated theme name).
      return { ...r, theme: validatedTheme, evidenceReviewIds };
    })
    .filter((r) => {
      if (r.evidenceReviewIds.length > 0) return true;
      droppedUnsupportedClaims++;
      return false;
    });

  // Phase 4.1 remediation — numerical-claim grounding. Deterministic
  // field-name lookup + numeric comparison; never another model judging
  // whether a number is "close enough" or plausible.
  const citedMetrics: NarratorResult["citedMetrics"] = [];
  const ungroundedMetrics: NarratorResult["ungroundedMetrics"] = [];
  const FLOAT_TOLERANCE = 0.005; // absorbs float/rounding noise; evidence-package percentages are already 2-decimal

  for (const metric of parsed.data.citedMetrics ?? []) {
    if (!(CITABLE_METRIC_FIELDS as readonly string[]).includes(metric.field)) {
      ungroundedMetrics.push({ ...metric, reason: "unknown_field" });
      continue;
    }
    const field = metric.field as CitableMetricField;
    const actual = evidencePackage[field];
    if (actual === null || typeof actual !== "number" || Math.abs(actual - metric.statedValue) > FLOAT_TOLERANCE) {
      ungroundedMetrics.push({ ...metric, reason: "value_mismatch" });
      continue;
    }
    citedMetrics.push({ field, statedValue: metric.statedValue });
  }

  return {
    summary: parsed.data.summary,
    rootCause,
    recommendations,
    rejectedCitations,
    irrelevantCitations,
    droppedUnsupportedClaims,
    citedMetrics,
    ungroundedMetrics,
  };
}
