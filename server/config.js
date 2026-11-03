import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { z } from "zod";

dotenv.config({
  path: fileURLToPath(new URL("../.env", import.meta.url)),
  quiet: true,
});

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4173),
  HOST: z.string().optional(),
  APP_URL: z.string().url().default("http://127.0.0.1:4173"),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//),
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
});

export function readConfig(source = process.env) {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    throw new Error(
      `Проверьте настройки: ${parsed.error.issues.map((item) => item.path.join(".")).join(", ")}. Пример — .env.example.`,
    );
  }
  const values = parsed.data;
  const url = new URL(values.APP_URL);
  const production = values.NODE_ENV === "production";
  if (
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error("APP_URL должен содержать только протокол, домен и порт.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    (production && url.protocol !== "https:")
  ) {
    throw new Error("Для production укажите APP_URL с HTTPS.");
  }
  const origins = new Set([url.origin]);
  if (!production && ["127.0.0.1", "localhost"].includes(url.hostname)) {
    url.hostname = url.hostname === "localhost" ? "127.0.0.1" : "localhost";
    origins.add(url.origin);
  }
  return {
    port: values.PORT,
    host: values.HOST || (production ? "0.0.0.0" : "127.0.0.1"),
    databaseUrl: values.DATABASE_URL,
    appUrl: values.APP_URL,
    trustProxy: values.TRUST_PROXY,
    production,
    origins,
  };
}
