/**
 * Development utility to generate a JWT token for local testing
 * Usage: npx tsx backend/scripts/generateDevToken.ts
 */

import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "development-jwt-secret-please-change-in-production";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "12h";

const payload = {
  sub: "dev-analyst",
  role: "analyst",
};

const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

console.log("Generated Dev Token:");
console.log("===================");
console.log(token);
console.log("");
console.log("Set this as an environment variable:");
console.log(`export VITE_DEV_TOKEN="${token}"`);
console.log("");
console.log("Or pass to dev server:");
console.log(`VITE_DEV_TOKEN="${token}" npm run dev`);
