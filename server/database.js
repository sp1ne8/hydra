import pg from "pg";

export function createPool(connectionString) {
  const pool = new pg.Pool({
    connectionString,
    max: process.env.VERCEL ? 2 : 10,
    connectionTimeoutMillis: 5000,
  });
  pool.on("error", () => console.error("Соединение с PostgreSQL прервано."));
  return pool;
}

export async function transaction(pool, action) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await action(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
