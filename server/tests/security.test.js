import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, passwordSchema } from "../security.js";
import { readConfig } from "../config.js";

test("password hashes have independent salts and reject wrong credentials", async () => {
  const password = "test-password-12345";
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.equal(first.includes(password), false);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword("wrong-password", first), false);
  assert.equal(await verifyPassword(password, undefined), false);
  assert.equal(passwordSchema.safeParse("short").success, false);
});

test("production requires an HTTPS origin and local aliases stay in development", () => {
  const env = {
    DATABASE_URL: "postgresql://example/db",
    NODE_ENV: "production",
  };
  assert.throws(() => readConfig({ ...env, APP_URL: "http://example.com" }));
  assert.throws(() =>
    readConfig({ ...env, APP_URL: "https://example.com/path" }),
  );
  const production = readConfig({ ...env, APP_URL: "https://example.com" });
  assert.equal(production.host, "0.0.0.0");
  assert.deepEqual([...production.origins], ["https://example.com"]);
  const development = readConfig({ DATABASE_URL: env.DATABASE_URL });
  assert.equal(development.origins.has("http://localhost:4173"), true);
});

test("Vercel accepts its deployment origin and integrated Postgres URL", () => {
  const config = readConfig({
    VERCEL: "1",
    VERCEL_URL: "hydra-preview.vercel.app",
    VERCEL_PROJECT_PRODUCTION_URL: "hydra.vercel.app",
    POSTGRES_URL: "postgresql://example/db",
  });
  assert.equal(config.production, true);
  assert.equal(config.trustProxy, 1);
  assert.equal(config.databaseUrl, "postgresql://example/db");
  assert.equal(config.appUrl, "https://hydra-preview.vercel.app");
  assert.equal(config.origins.has("https://hydra.vercel.app"), true);
});
