import { appSequelize } from "../src/database/appStore/client.js";
import { config } from "../src/config/index.js";
import { QueryTypes } from "sequelize";

async function main() {
  const schema = config.appStore.schema;
  for (const t of ["normalized_reviews", "review_sentiment", "review_theme", "ai_question_cache", "ai_product_analyst_conversations"]) {
    const r = (await appSequelize.query(`SELECT COUNT(*) as c FROM "${schema}".${t}`, { type: QueryTypes.SELECT })) as any[];
    console.log(t, r[0].c);
  }
  process.exit(0);
}
main();
