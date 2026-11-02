import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { readConfig } from "./config.js";
import { createPool, transaction } from "./database.js";
import {
  emailSchema,
  usernameSchema,
  passwordSchema,
  hashPassword,
  recordEvent,
} from "./security.js";

const ownerSchema = z.object({
  email: emailSchema,
  username: usernameSchema,
  password: passwordSchema,
});

export async function createOwner(pool, input) {
  const credentials = ownerSchema.parse(input);
  const passwordHash = await hashPassword(credentials.password);
  return transaction(pool, async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(71432062)");
    const existing = await db.query(
      "SELECT id FROM users WHERE role = 'owner'",
    );
    if (existing.rowCount)
      throw new Error(
        "Главный администратор уже существует. Его данные не изменены.",
      );
    const id = randomUUID();
    await db.query(
      "INSERT INTO users(id, username, email, password_hash, role) VALUES ($1, $2, $3, $4, 'owner')",
      [id, credentials.username, credentials.email, passwordHash],
    );
    await recordEvent(db, "owner_created", id, id);
    return id;
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let pool;
  try {
    pool = createPool(readConfig().databaseUrl);
    await createOwner(pool, {
      email: process.env.OWNER_EMAIL,
      username: process.env.OWNER_USERNAME,
      password: process.env.OWNER_PASSWORD,
    });
    console.log(
      "Главный администратор создан. Вход: /admin/. Удалите OWNER_PASSWORD из настроек окружения.",
    );
  } catch (error) {
    console.error(
      error instanceof z.ZodError
        ? "Заполните OWNER_EMAIL, OWNER_USERNAME и OWNER_PASSWORD (не менее 12 символов)."
        : error.code === "23505"
          ? "Email или имя уже заняты. Используйте отдельный аккаунт главного администратора."
          : error.code === "ECONNREFUSED"
            ? "PostgreSQL не запущена. Выполните docker compose up -d db, затем повторите npm run admin:create."
            : error.code
              ? `Не удалось создать аккаунт (${error.code}).`
              : error.message,
    );
    process.exitCode = 1;
  } finally {
    await pool?.end();
  }
}
