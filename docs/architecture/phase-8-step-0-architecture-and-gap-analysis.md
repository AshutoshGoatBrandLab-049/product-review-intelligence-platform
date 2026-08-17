# Phase 8 — Step 0 — Architecture & Gap Analysis

**This is a read-only document.** No code was written, no files besides this one were created or modified, no dependencies were installed, no database was written to, no AI provider was called, and nothing was deployed.

Status vocabulary: **PROVEN BY EXECUTION** / **UNIT-TEST PROVEN** / **OBSERVED** / **NOT MEASURED** / **INFERRED**.

---

## 1. Executive summary

Phase 7 is complete: all 9 planned frontend pages are implemented, tested, and validated against real data. The repository's own documentation defines Phase 8 in exactly one place — Phase 2's original roadmap (written before any implementation existed) — as **"Hardening": observability wiring, load testing at 1M/10M synthetic scale, a security review, and finalized documentation**, gated on "all Phase 1 §20 readiness gates met." No later phase document (3 through 7) ever revises, expands, or re-confirms this definition; instead, every subsequent phase accumulates its own deferred items ("later phase," "future," "when this becomes real") without ever assigning them a phase number.

This narrow original definition is not, on its own, safely implementable today: Phase 2.5's own audit explicitly states an unresolved hosting/deployment-target decision **"blocks Phase 8 planning."** Two more of Phase 8's three named sub-items carry their own unresolved design questions (§7). Per your own hard-stop conditions, this is **Outcome B — partially defined, with open architectural decisions that must be resolved before implementation begins.** No Step 1 is proposed as ready to start. §12 offers a narrowed, safely-scoped first slice conditional on your answers to §7, but does not begin it.

## 2. Original roadmap evidence for Phase 8

The **only** place in the repository that names "Phase 8" with actual content is `docs/architecture/phase-2-technical-architecture.md` §24 (line ~673), written at the very start of the project, before Phase 1 implementation began:

> **Phase 8 — Hardening**
> - **Work:** Full observability wiring (§22), load testing at 1M/10M synthetic scale, security review, documentation finalized
> - **Completion criteria:** All Phase 1 §20 readiness gates met

That is the entire original definition — one work bullet with four clauses, one completion gate.

The second and only other place Phase 8 is named with substance is `docs/architecture/phase-2.5-final-audit.md`, Q8 (line ~397):

> | Q8 | Hosting/deploy target | No strong recommendation without infra context | NOT VERIFIED — no docker/PM2/deploy config found in either sibling crawler repo to infer a convention from | **Blocks Phase 8 planning, not earlier** |

No phase-3, phase-4, phase-4.1, phase-5, phase-6, or phase-7 document (architecture or implementation report, including all 9 Phase 7 step reports) names "Phase 8" at all — confirmed by a repo-wide search. Every one of them instead defers items using phase-number-less language: "later phase," "future," "out of scope for this phase," "when this becomes real." None of those un-numbered deferrals are ever claimed for Phase 8 specifically, and Phase 8's own definition never mentions any of them (the 3 deferred endpoints, `product_family_mapping` population, the severity formula, or the Myntra AI-coverage gap are absent from §24's text). Treating those items as implicitly "Phase 8" would be an inference beyond what the documentation states, not a documented fact — so this report does not do so.

## 3. Current architecture (OBSERVED)

**Backend** — Node/TypeScript/Express/Sequelize/PostgreSQL. 11 API routes, all `GET`, all read-only (`src/api/router.ts`); role gate is `anyRole` on 9 of them, `adminOnly` on the 2 System routes. Two databases: a local writable app store (migrated, 13 numbered migrations with paired `.up.sql`/`.down.sql`, though nothing in the repo ever executes a `.down.sql`) and a separate, deliberately narrow production-read-only surface (`src/database/prodReadOnly/index.ts` — exactly 4 hardcoded query functions against 2 fixed source tables, no generic executor, DB-role-enforced via a `SELECT`-only Postgres role, boot-time-asserted distinct from the app store connection). Category C response caching is an in-process `Map`-based `TtlCache` (60s TTL) — explicitly documented as not shared across instances. No Redis or other external cache anywhere. No scheduler, cron, job queue, or worker infrastructure exists anywhere in the codebase. AI provider selection (`mock`/`gemini`/`anthropic`) defaults to `mock`; a persisted, hash-keyed insights cache avoids redundant provider calls; retries use exponential backoff with a 30s cap. `helmet()` and a global, IP-keyed `express-rate-limit` (default 120 req/60s) are both wired in `app.ts`; `cors()` is called with no options (default: any origin, no allowlist). `JWT_SECRET` has no default and boot refuses to start without it (`server.ts` only — not `createApp()`, used by tests). Token issuance is a local CLI script (`issueDevToken.ts`) keyed only on possession of `JWT_SECRET` — no login endpoint exists anywhere. A PII-redaction guard (`FORBIDDEN_LOG_KEYS`) throws in non-production and strips-with-warning in production on any attempt to log raw review text/author fields.

**Frontend** — React 19 / Vite 8 / TypeScript / TanStack Query 5 / React Router 7 / Tailwind v4 + shadcn. All 9 planned pages are real, fully implemented (`Dashboard`, `Products`, `ProductDetail`, `Warnings`, `Problems`, `BrandComparison`, `ProductComparison`, `System`); `BrandsIndex.tsx` (the `/marketplace/brands` landing page, an intentional Phase 7 addition beyond the original 9) remains a `StubPage` with no brand search/selection UI. Auth is dev-token-only: a `VITE_DEV_TOKEN` env var, decoded client-side for role display only, held in an in-memory module (deliberately not `localStorage`), with no login form and no identity-provider integration anywhere. The API client (`apiGet`) has no retry logic and no request timeout of its own; TanStack Query's own retry is globally disabled (`retry: false`). All 9 pages are statically imported in `router.tsx` — no route-level code-splitting — producing the single ~865 KB bundle flagged by the build warning since Phase 7 Step 3. No error-tracking/monitoring integration (Sentry or similar), no analytics/telemetry, no PWA/service-worker code exists anywhere in the frontend.

**Infrastructure** — No `Dockerfile`, no `docker-compose.yml`, no CI/CD configuration of any kind (`.github/workflows`, `.gitlab-ci.yml`, etc.), and no hosting/PaaS configuration file (Vercel, Netlify, Render, Fly, Procfile) exist anywhere in the repository. `NODE_ENV` is the only environment-tier signal; there is no separate `.env.production`/`.env.staging` file for either app — one flat variable set each. No secrets-manager integration (plain env vars only). Observability is limited to structured `pino` logs plus per-ingestion-job `jobId`/`status`/`durationMs` fields; there is a static `/healthz` liveness endpoint with no dependency/readiness check, and no metrics endpoint, tracing, or alerting of any kind.

## 4. Completed phases (OBSERVED)

| Phase | Content | Status |
|---|---|---|
| 1 | Ingestion (Track A/B), identity/dedup, prod-read-only foundation | Complete |
| 2 / 2.5 / 2.9 | Original architecture, audits, final pre-implementation design | Complete (documentation only) |
| 3 | Deterministic analytics (core metrics, health score, trends) | Complete — health score formula explicitly a "hypothesis," never business-approved |
| 4 / 4.1 | AI intelligence (narrator, evidence packages) + remediation | Complete |
| 5 | Early warning + marketplace comparison analytics | Complete — severity formula descoped, `product_family_mapping` shipped empty by design |
| 6 | REST API (11 endpoints, JWT/RBAC, caching) | Complete |
| 7 (Steps 1–9) | Full 9-page frontend | Complete — 205/205 tests, this session's own execution |

## 5. Remaining gaps

| Area | Current state | Original intended state | Gap | Phase 8 relevance |
|---|---|---|---|---|
| 3 deferred backend endpoints (`PATCH /early-warnings/:id`, `POST .../insights/regenerate`, `POST /analyst/query`) | Absent from router (OBSERVED) | Recommended for "a later phase" (Phase 6 architecture doc) | No write endpoints exist anywhere in the API | Not named in Phase 8's §24 definition; no doc claims them for it |
| `product_family_mapping` | 0 rows (OBSERVED, re-verified this step) | "A separate, future business decision," never auto-populated by design | Product-level marketplace comparison always shows `no_mapping` for real data | Not named in Phase 8's §24 definition |
| Severity / health-score formula | `severityScore`/`totalScore` always `null`; `healthScore.ts` weights explicitly labeled `"health-v0-hypothesis"` | Formula to be validated against real outcomes before being called authoritative | No approved formula exists at all | Not named in Phase 8's §24 definition |
| Myntra AI-classification coverage | 36 AI-classified reviews vs. 8,897 for Flipkart in the real dataset (per Phase 5/7 reports) | Roughly proportional coverage across platforms | Upstream ingestion/crawler gap outside this repo's control | Explicitly flagged as *not* this repo's or any named phase's fix |
| Hosting/deployment target | Not chosen (OBSERVED — no Docker/CI/PaaS config anywhere) | "Still open since Phase 1," per Phase 7 architecture §19 | No deployment target decided | **Explicitly named as blocking Phase 8 planning** (Phase 2.5 audit Q8) |
| Real identity provider / login | Dev-token-only, CLI-issued | "A real, unresolved item for whenever 'production' becomes real" (Phase 7 §19 Q9) | No login flow, no IdP integration | Not named in §24's Phase 8 definition, but relevant to any "hardening" that touches auth |
| Multi-instance cache sharing | In-process `TtlCache`, per-instance | Flagged in Phase 6 report as a known limitation for "a future multi-instance deployment" | No Redis/shared cache | Relevant if Phase 8 hardening includes horizontal scaling |
| Scheduler/job queue | None exists | Deferred "until an endpoint actually needs it" (Phase 6) | No background-job infrastructure | Only relevant if the 3 deferred write endpoints are ever built (not in scope per §2) |
| Observability | Structured logs + per-job metadata only; no metrics/tracing/alerting | §24's Phase 8 text: "Full observability wiring (§22)" | Gap matches Phase 8's own stated scope | **Directly named in Phase 8 §24** |
| Load testing | Never performed (NOT MEASURED) | §24: "load testing at 1M/10M synthetic scale" | No synthetic-scale test has ever been run; no synthetic-data-generation strategy exists | **Directly named in Phase 8 §24**, but the generation strategy itself is an open decision (§7) |
| Security review | Individual controls exist (helmet, rate limiting, PII redaction, prod-read-only boundary) but have never been reviewed as a whole | §24: "security review" | No formal review has been performed | **Directly named in Phase 8 §24** |
| CORS | `cors()` with no options — any origin allowed | Not explicitly specified anywhere | Wide-open by default | Would likely surface in a security review |
| CI/CD | None | Not explicitly specified anywhere | No automated test/build gate on push | Implied by "documentation finalized"/"hardening" but not explicitly named |
| Migration rollback | `.down.sql` files exist on disk but are never executed by any script | Not explicitly specified | No functioning rollback mechanism | Would likely surface in a security/ops review |
| Backups | No backup/restore script or documented procedure for the local dataset (docs mention "snapshot" only in unrelated architectural narrative) | Not explicitly specified | No backup strategy | Would likely surface in a "hardening" review |

## 6. Phase 8 candidate scope

Per §2's evidence, the only documented candidate is Phase 2 §24's **"Hardening"**: (a) observability wiring, (b) load testing at 1M/10M synthetic scale, (c) security review, (d) documentation finalized — gated on Phase 1's own readiness criteria. This report does not substitute a different scope (e.g., "build the 3 deferred endpoints" or "populate product_family_mapping") because no document claims those for Phase 8; doing so would be inventing scope, which you explicitly prohibited.

## 7. Open architectural decisions (why this is Outcome B, not A)

Each of Phase 8's own three named work items carries at least one unresolved decision:

1. **Hosting/deployment target** — explicitly and directly named as blocking Phase 8 planning by Phase 2.5's own audit (§2). Nothing in the repo picks one (no Docker/CI/PaaS artifact exists anywhere, per §3/§8). This is also directly one of your hard-stop conditions ("deployment/hosting must be chosen").
2. **Load-testing methodology** — "1M/10M synthetic scale" requires a synthetic-data-generation strategy (how 1M–10M realistic reviews get produced), a target environment to run the load test against (the local dev machine is very unlikely to be the intended target for a 10M-row load test), and a decision on whether this touches the production-read-only boundary in any way. None of these are specified anywhere.
3. **Security review scope** — is this an audit-and-report exercise (documenting findings, no code changes), or does it include *implementing* fixes for what §3/§5 already show (CORS allowlist, secrets-manager integration, migration rollback, CI/CD, real identity provider)? The original text ("security review") reads as an audit; treating it as "implement every fix" would be scope invention.
4. **"Documentation finalized"** — finalized against what standard, and does it include documenting the still-open items in §5 as permanent limitations vs. resolving them first?

None of these can be safely resolved by inference. Per your instructions, this is **Outcome B**.

## 8. Production-readiness / security audit (OBSERVED, this step)

| Control | State |
|---|---|
| Production DB access | Read-only, 4 hardcoded queries, DB-role-enforced (`review_intel_ro`), boot-time-asserted distinct from the writable app store |
| Read/write boundaries | No write endpoint exists in the API at all; `checkNoWrites.ts` safety-check passed this step |
| AI provider configuration | Defaults to `mock`; real providers require an explicit env var + API key; persisted cache avoids redundant calls |
| API authentication | JWT, `HS256` (via `jsonwebtoken`), no default secret, boot refuses to start without one (`server.ts` only) |
| JWT/dev-token limitations | Token issuance is a local CLI script keyed only on `JWT_SECRET` possession — explicitly documented as never a production mechanism |
| Rate limiting | One global, IP-keyed limiter (120 req/60s default); no per-user/per-route limiting; no AI-call-specific budget cap |
| Secrets management | Plain env vars only; no secrets-manager integration anywhere |
| CORS | `cors()` default — any origin, no allowlist |
| Security headers | `helmet()` default config only, no custom CSP |
| Frontend environment variables | `VITE_API_BASE_URL`, `VITE_DEV_TOKEN` only; token held in-memory, not `localStorage` |
| Error leakage | `errorHandler.ts` strips internal messages on generic 500s (carried through unmodified since Phase 6) |
| Logging/PII | `FORBIDDEN_LOG_KEYS` guard, throws in non-prod / strips+warns in prod, test-covered |
| Persistent cache | None — in-process `TtlCache` only, explicitly documented as not multi-instance-safe |
| Multi-instance behavior | Not supported today (cache would diverge across instances); no code assumes multiple instances |
| Background jobs | None exist |
| Retries | AI calls only, exponential backoff, 30s cap; no retry on the API client itself |
| Monitoring | Structured logs + per-job metadata; no metrics/tracing/alerting |
| Deployment | Not configured anywhere (no Docker/CI/hosting artifact) |
| Rollback | Migration `.down.sql` files exist but are never executed by any script |
| Migrations | Local-only enforced (`assertLocalMigrationTarget.ts` blocks non-localhost targets) |
| Backups | No script or documented procedure found |

**Conclusion: Phase 8 would, by its own original definition, move the project toward production-readiness (that is literally what "hardening" means), but the repository today has made zero of the decisions (hosting, CI/CD, secrets management, identity provider) that a real production move requires.** This matches several of your hard-stop conditions directly.

## 9. Data/AI limitations (carried forward, unchanged this step)

- `product_family_mapping`: 0 rows (**OBSERVED**, re-verified this step by direct read-only query).
- Severity/health-score: no approved formula; `totalScore` always `null` (**OBSERVED**, unchanged since Phase 5).
- Myntra AI-classification coverage: 36 vs. 8,897 real classified reviews (**OBSERVED** as of the Phase 5/7 reports; not re-measured this step since it requires no new query beyond what those reports already ran, and re-running it was not necessary to answer the Step 0 question).
- `ai_insights`: 3 rows this step (`myntra/100406`, `flipkart/FKPID000006`, `flipkart/FKPID000252`) — unchanged from the Step 8/9 reports, **re-confirmed by this step's own read-only baseline query**.

## 10. Performance/scaling considerations

**NOT MEASURED** by this step (Step 0 is read-only; no load test was run, consistent with your instruction not to run anything that could modify production or real data, and load testing at any real scale is itself Phase 8's own undecided work item per §7). What is known: the Category C cache is in-process only and would not scale correctly across multiple instances without a shared cache being added first (**OBSERVED**, from source and prior phase reports). The frontend ships as a single ~865 KB bundle with no route-level code-splitting (**OBSERVED**, this step's audit). Neither of these has been benchmarked against any target load.

## 11. Baseline verification (PROVEN BY EXECUTION, this session)

| Check | Result | Expected | Match |
|---|---|---|---|
| Backend `tsc --noEmit` | Clean | Clean | ✅ |
| Backend test suite | 308/308 | 308/308 | ✅ |
| Backend `npm run safety-check` | `OK — no write-shaped SQL found` | OK | ✅ |
| Frontend `tsc -b` | Clean | Clean | ✅ |
| Frontend test suite | 205/205 | 205/205 | ✅ |
| Frontend `npm run build` | Succeeded (865.34 KB JS, same pre-existing chunk-size advisory) | Succeeded | ✅ |
| `normalized_reviews` count | 100,006 | 100,006 | ✅ |
| `normalized_reviews` checksum | `821903ac625da7ee6256e2b6344ce868` | `821903ac625da7ee6256e2b6344ce868` | ✅ |
| `ai_insights` count | 3 | 3 | ✅ |
| `product_family_mapping` count | 0 | 0 | ✅ |
| `review_sentiment` count (additional cross-check) | 5,035 | — | OBSERVED, consistent with all prior reports |
| `review_theme` count (additional cross-check) | 8,933 | — | OBSERVED, consistent with all prior reports |

All values matched the expected baseline exactly — no investigation was triggered. All database verification was read-only `SELECT` queries against the local dataset; zero writes, zero production access, zero AI calls.

## 12. Recommended Phase 8 Step 1 (conditional — not started)

Not proposed as ready to start, per §7/§13. If, after resolving the open decisions below, you want to proceed, the narrowest safe first slice consistent with §24's own text would be a **security-review-as-audit** (read-only: document every control in §8 against a standard checklist, produce a findings report, propose no code changes yet) — since that sub-item alone doesn't require the hosting or load-testing decisions to be made first. But this is offered only as an option for you to accept or reject, not a plan already in motion.

## 13. Explicit STOP condition

**STOPPING per Outcome B.** The following must be resolved by you before any Phase 8 Step 1 begins:

1. **Hosting/deployment target** — explicitly named as blocking Phase 8 planning; no artifact exists to infer one from.
2. **Load-testing approach** — synthetic-data generation strategy, target environment, and whether it may touch the production-read-only boundary in any way.
3. **Security-review scope** — audit-and-report only, or does it include implementing the fixes it finds (CORS allowlist, secrets manager, CI/CD, migration rollback, real identity provider)?
4. **Whether any of the un-numbered deferred items from Phases 3–7** (§5 — the 3 write endpoints, `product_family_mapping` population, the severity formula, real auth) should be pulled into Phase 8, or intentionally left for a later, still-undefined phase.

No implementation, dependency installation, database write, AI call, or deployment action has been taken. This document is the complete Step 0 deliverable.

---

**Phase 8 Step 0 is complete. No Phase 8 implementation has started. Waiting for explicit approval before Step 1.**
