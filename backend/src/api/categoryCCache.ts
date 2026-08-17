import { TtlCache, CATEGORY_C_DEFAULT_TTL_MS } from "../shared/ttlCache.js";

/** One shared cache instance for every Category C endpoint — see
 * ttlCache.ts for the TTL's evidence basis. Cache keys are namespaced per
 * route (e.g. "dashboard:...", "rankings:...") so different endpoints never
 * collide even though they share one Map. */
export const categoryCCache = new TtlCache<unknown>(CATEGORY_C_DEFAULT_TTL_MS);
