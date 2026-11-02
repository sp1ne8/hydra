import { readConfig } from "./config.js";
import { createPool } from "./database.js";
import { createApp } from "./app.js";

const config = readConfig();
const pool = createPool(config.databaseUrl);

try {
  await pool.query("SELECT id FROM users LIMIT 1");
} catch (error) {
  console.error(
    error.code === "42P01"
      ? "Сначала выполните npm run db:migrate."
      : error.code === "ECONNREFUSED"
        ? "PostgreSQL не запущена. Выполните docker compose up -d db, затем npm start."
        : "Нет подключения к PostgreSQL. Проверьте DATABASE_URL и запустите базу данных.",
  );
  await pool.end();
  process.exit(1);
}

const server = createApp(pool, config).listen(config.port, config.host, () => {
  console.log(`HYDRA: ${config.appUrl}`);
  console.log(`Админка: ${config.appUrl}/admin/`);
});
server.on("error", async (error) => {
  console.error(
    error.code === "EADDRINUSE"
      ? `Порт ${config.port} занят.`
      : "Не удалось запустить сервер.",
  );
  await pool.end();
  process.exitCode = 1;
});

const cleanup = setInterval(async () => {
  try {
    await pool.query("DELETE FROM sessions WHERE expires_at <= now()");
    await pool.query("DELETE FROM request_limits WHERE expires_at <= now()");
  } catch {
    console.error("Не удалось очистить истёкшие сессии.");
  }
}, 3600_000);
cleanup.unref();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    clearInterval(cleanup);
    server.close(async () => {
      await pool.end();
    });
  });
}
