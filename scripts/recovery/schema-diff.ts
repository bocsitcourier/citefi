import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { Client } from "pg";
import * as schema from "../../shared/schema";

const db = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
try {
  await db.connect();
  await db.query("BEGIN READ ONLY");
  const { rows: [identity] } = await db.query("SELECT current_database()='citefi' AS expected");
  if (!identity.expected) throw new Error("Unexpected target");
  const { rows } = await db.query(`SELECT c.relname AS table_name,a.attname AS column_name,
    format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS not_null,
    a.atthasdef AS has_default FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public'
    AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped`);
  const current = new Map<string, Map<string, typeof rows[number]>>();
  for (const row of rows) {
    if (!current.has(row.table_name)) current.set(row.table_name, new Map());
    current.get(row.table_name)!.set(row.column_name, row);
  }
  const missingTables: string[] = [], missingColumns: { table: string; column: string; type: string; notNull: boolean; hasDefault: boolean }[] = [];
  const typeDrift: { table: string; column: string; expected: string; actual: string }[] = [];
  const normalize = (value: string) => value.toLowerCase().replace(/^serial$/, "integer").replace(/^bigserial$/, "bigint")
    .replace(/^varchar/, "character varying").replace(/^timestamp$/, "timestamp without time zone")
    .replace(/^timestamptz$/, "timestamp with time zone").replace(/^int$/, "integer");
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const expected = getTableConfig(value);
    const actual = current.get(expected.name);
    if (!actual) { missingTables.push(expected.name); continue; }
    for (const column of expected.columns) {
      const found = actual.get(column.name);
      if (!found) {
        missingColumns.push({ table: expected.name, column: column.name, type: column.getSQLType(),
          notNull: column.notNull, hasDefault: column.hasDefault });
      } else if (normalize(found.type) !== normalize(column.getSQLType())) {
        typeDrift.push({ table: expected.name, column: column.name, expected: column.getSQLType(), actual: found.type });
      }
    }
  }
  await db.query("ROLLBACK");
  console.log(JSON.stringify({ missingTables, missingColumns, typeDrift }));
} catch {
  console.error("Read-only candidate schema comparison failed.");
  process.exitCode = 1;
} finally { await db.end(); }
