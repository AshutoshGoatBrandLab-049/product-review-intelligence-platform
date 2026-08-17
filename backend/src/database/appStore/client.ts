import { Sequelize } from "sequelize";
import { config } from "../../config/index.js";

/**
 * The platform's own writable store. Full Sequelize ORM is fine to use here
 * — unlike prodReadOnly, there is no read-only constraint to protect, and
 * this connection uses DB_* (unprefixed) credentials exclusively, never
 * DB_PROD_*. Schema is always product_review_intelligence, never
 * DataWarehouse — see the local-schema decision, Phase 1 plan §D.
 */
export const appSequelize = new Sequelize(
  config.appStore.database,
  config.appStore.user,
  config.appStore.password,
  {
    host: config.appStore.host,
    port: config.appStore.port,
    dialect: "postgres",
    schema: config.appStore.schema,
    logging: false,
  },
);
