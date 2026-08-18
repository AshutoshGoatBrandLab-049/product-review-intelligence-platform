import { detectIntent } from "../src/modules/ai/intentDetection.js";

const testCases = [
  "What's the biggest issue?",
  "What are customers complaining about?",
  "show me all the bad reviews",
  "show me",
  "Show me negative reviews",
  "Show me latest 20 reviews",
];

console.log("=== INTENT DETECTION FIX VERIFICATION ===\n");

for (const q of testCases) {
  const intent = detectIntent(q);
  console.log(`"${q}"`);
  console.log(`  → ${intent}\n`);
}
