import { signToken, ROLES, type Role } from "../src/api/auth/jwt.js";
import { assertJwtSecretConfigured } from "../src/config/index.js";

/**
 * Phase 6 Step 2 — a CLI token issuer, not an HTTP endpoint. §5's approved
 * endpoint set has no login/token-issuance route, and building a real user
 * store/login flow was never approved — this is the deliberately minimal
 * stand-in "identity source" the JWT middleware was built to be decoupled
 * from (phase-6-api-architecture-design.md §5): today, anyone who can run
 * this script (i.e. anyone with access to JWT_SECRET) can mint a token for
 * any role. Replacing this with a real login/identity provider later means
 * writing a new issuer, never touching authenticate.ts or any controller.
 *
 * Usage: npx tsx scripts/issueDevToken.ts <role> [subject]
 */
function main(): void {
  assertJwtSecretConfigured();

  const [, , roleArg, subjectArg] = process.argv;
  if (!roleArg || !ROLES.includes(roleArg as Role)) {
    console.error(`Usage: npx tsx scripts/issueDevToken.ts <${ROLES.join("|")}> [subject]`);
    process.exit(1);
  }

  const token = signToken({ sub: subjectArg ?? `dev-${roleArg}`, role: roleArg as Role });
  console.log(token);
}

main();
