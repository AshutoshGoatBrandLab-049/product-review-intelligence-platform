import request from "supertest";
import { config } from "../src/config/index.js";
import { appSequelize } from "../src/database/appStore/client.js";
import { createApp } from "../src/api/app.js";
import { signToken } from "../src/api/auth/jwt.js";

// Phase 7 Step 2 — read-only validation of exactly the two endpoints the
// Executive Dashboard consumes (GET /v1/dashboard/executive, GET
// /v1/early-warnings), against the real local dataset. Same safety guards
// as scripts/phase6ApiRealDatasetValidation.ts: refuses to run against the
// isolated test fixture, and refuses to run unless AI_PROVIDER=mock —
// neither endpoint touches AI at all (verified by source: dashboard.ts and
// earlyWarnings.ts import no AI module), but this guard is kept anyway for
// defense in depth and consistency with the established pattern.
if (config.appStore.database === "pri_test_appstore") {
  throw new Error("Refusing to run: this script validates the real dataset, not the isolated test fixture");
}
if (config.ai.provider !== "mock") {
  throw new Error(`Refusing to run: config.ai.provider is "${config.ai.provider}", not "mock".`);
}

const app = createApp();
const viewerToken = signToken({ sub: "dashboard-validation-viewer", role: "viewer" });
const auth = (req: request.Test) => req.set("Authorization", `Bearer ${viewerToken}`);

async function main(): Promise<void> {
  console.log("=== Phase 7 Step 2 — Executive Dashboard real-data validation ===\n");

  for (const window of ["30d", "90d"] as const) {
    console.log(`--- window=${window} ---`);

    const dashboardRes = await auth(request(app).get(`/v1/dashboard/executive?window=${window}`));
    console.log(`GET /v1/dashboard/executive: status=${dashboardRes.status}`);
    if (dashboardRes.status !== 200) throw new Error(`Unexpected status: ${JSON.stringify(dashboardRes.body)}`);
    console.log(`  productCount=${dashboardRes.body.productCount}`);
    console.log(`  activeAlertCount=${dashboardRes.body.activeAlertCount}`);
    console.log(`  averageRatingScore=${dashboardRes.body.averageRatingScore} (null-safe: ${dashboardRes.body.averageRatingScore === null || typeof dashboardRes.body.averageRatingScore === "number"})`);
    console.log(`  topMovers.length=${dashboardRes.body.topMovers.length}, bottomMovers.length=${dashboardRes.body.bottomMovers.length}`);
    if (dashboardRes.body.topMovers[0]) {
      const m = dashboardRes.body.topMovers[0];
      console.log(
        `  sample topMover: ${m.platform}/${m.sourceProductId} brand=${m.brand} ratingScore=${m.health.ratingScore} severityScore=${m.health.severityScore} totalScore=${m.health.totalScore}`,
      );
      if (m.health.severityScore !== null || m.health.totalScore !== null) {
        throw new Error("DEFECT: severityScore/totalScore were not null on real data — this must never happen");
      }
    }

    const warningsRes = await auth(request(app).get(`/v1/early-warnings?window=${window}`));
    console.log(`GET /v1/early-warnings: status=${warningsRes.status}`);
    if (warningsRes.status !== 200) throw new Error(`Unexpected status: ${JSON.stringify(warningsRes.body)}`);
    console.log(`  productsScanned=${warningsRes.body.productsScanned}, signals.length=${warningsRes.body.signals.length}`);
    const byType: Record<string, number> = {};
    const byConfidence: Record<string, number> = {};
    for (const s of warningsRes.body.signals as { signalType: string; confidence: string }[]) {
      byType[s.signalType] = (byType[s.signalType] ?? 0) + 1;
      byConfidence[s.confidence] = (byConfidence[s.confidence] ?? 0) + 1;
    }
    console.log(`  by signalType: ${JSON.stringify(byType)}`);
    console.log(`  by confidence: ${JSON.stringify(byConfidence)}`);
    console.log("");
  }

  console.log("=== Validation complete — no writes, no AI calls ===");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("VALIDATION FAILED:", err);
    process.exit(1);
  })
  .finally(async () => {
    await appSequelize.close();
  });
