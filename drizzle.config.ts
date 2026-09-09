import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  // These tables are maintained by the versioned migration runner rather than
  // the declarative schema. Excluding them prevents Drizzle from treating a
  // newly declared table as a possible rename of migration bookkeeping data.
  tablesFilter: [
    "*",
    "!citefi_schema_migrations",
    "!credit_reservation_quarantine",
  ],
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
