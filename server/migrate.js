import { readFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createPool, transaction } from "./database.js";
import { readConfig } from "./config.js";

export async function migrate(pool) {
  const directory = new URL("./migrations/", import.meta.url);
  const files = (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  await transaction(pool, async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(71432061)");
    await db.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const name of files) {
      const existing = await db.query(
        "SELECT name FROM schema_migrations WHERE name = $1",
        [name],
      );
      if (existing.rowCount) continue;
      await db.query(await readFile(new URL(name, directory), "utf8"));
      await db.query("INSERT INTO schema_migrations(name) VALUES ($1)", [name]);
    }
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let pool;
  try {
    pool = createPool(readConfig().databaseUrl);
    await migrate(pool);
    console.log("Структура базы данных обновлена.");
  } catch (error) {
    console.error(
      error.code === "ECONNREFUSED"
        ? "PostgreSQL не запущена. Выполните docker compose up -d db, затем повторите npm run db:migrate."
        : error.code
          ? `Не удалось обновить базу данных (${error.code}).`
          : error.message,
    );
    process.exitCode = 1;
  } finally {
    await pool?.end();
  }
}
