import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createApp } from "../app.js";
import { migrate } from "../migrate.js";
import { createOwner } from "../create-owner.js";
import { readConfig } from "../config.js";

test("accounts, owner permissions, sessions and audit log", async (t) => {
  const connectionString = process.env.TEST_DATABASE_URL;
  assert.ok(
    connectionString,
    "Set TEST_DATABASE_URL to a PostgreSQL database. Tests use a separate temporary schema.",
  );
  const schema = `hydra_test_${randomUUID().replaceAll("-", "")}`;
  const control = new pg.Pool({ connectionString });
  await control.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({
    connectionString,
    options: `-c search_path=${schema}`,
  });
  let server;
  try {
    await migrate(pool);
    await migrate(pool);
    const config = readConfig({
      DATABASE_URL: connectionString,
      NODE_ENV: "test",
    });
    server = createApp(pool, config).listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const password = "test-password-12345";
    const ownerEmail = "owner@example.test";
    const ownerId = await createOwner(pool, {
      username: "owner",
      email: ownerEmail,
      password,
    });

    async function call(
      path,
      {
        method = "GET",
        body,
        cookie,
        origin = "http://127.0.0.1:4173",
        headers = {},
      } = {},
    ) {
      const response = await fetch(`${base}${path}`, {
        method,
        redirect: "manual",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          "X-Requested-With": "HYDRA",
          ...(cookie ? { Cookie: cookie } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const content = await response.text();
      return {
        status: response.status,
        data: response.headers.get("content-type")?.includes("application/json")
          ? JSON.parse(content)
          : content,
        cookie: response.headers.get("set-cookie")?.split(";")[0],
        headers: response.headers,
      };
    }
    const register = (username, extra = {}) =>
      call("/api/auth/register", {
        method: "POST",
        body: {
          username,
          email: `${username}@example.test`,
          password,
          confirmPassword: password,
          ...extra,
        },
      });
    const login = (email) =>
      call("/api/auth/login", { method: "POST", body: { email, password } });
    let user;
    let owner;
    let firstSession;

    await t.test(
      "registration is public, validates input and cannot assign a role",
      async () => {
        assert.equal(
          (await register("attacker", { role: "owner" })).status,
          400,
        );
        assert.equal(
          (await register("invalid", { confirmPassword: "not-matching" }))
            .status,
          400,
        );
        user = await register("member");
        firstSession = user.cookie;
        assert.equal(user.status, 201);
        assert.equal(user.data.user.role, "user");
        assert.equal(user.data.user.password_hash, undefined);
        assert.match(user.headers.get("set-cookie"), /HttpOnly/);
        assert.match(user.headers.get("set-cookie"), /SameSite=Lax/);
        assert.equal((await register("MEMBER")).status, 409);
        const {
          rows: [stored],
        } = await pool.query("SELECT * FROM users WHERE id = $1", [
          user.data.user.id,
        ]);
        assert.notEqual(stored.password_hash, password);
        const {
          rows: [session],
        } = await pool.query("SELECT * FROM sessions WHERE user_id = $1", [
          stored.id,
        ]);
        assert.notEqual(session.token_hash, user.cookie.split("=")[1]);
      },
    );

    await t.test(
      "foreign origins and missing CSRF header are rejected",
      async () => {
        assert.equal(
          (
            await call("/api/auth/login", {
              method: "POST",
              body: { email: ownerEmail, password },
              origin: "https://evil.test",
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await call("/api/auth/login", {
              method: "POST",
              body: { email: ownerEmail, password },
              headers: { "X-Requested-With": "" },
            })
          ).status,
          403,
        );
        const denied = await call("/api/auth/login", {
          method: "POST",
          body: { email: ownerEmail, password: "wrong-password" },
        });
        assert.equal(denied.status, 401);
      },
    );

    await t.test(
      "only the owner can grant or revoke admin, including direct API calls",
      async () => {
        owner = await login(ownerEmail);
        assert.equal(owner.status, 200);
        assert.equal((await call("/api/admin/users")).status, 401);
        assert.equal(
          (await call("/api/admin/users", { cookie: user.cookie })).status,
          403,
        );
        const path = `/api/admin/users/${user.data.user.id}/role`;
        const change = (cookie, role) =>
          call(path, { method: "PATCH", cookie, body: { role } });
        assert.equal((await change(user.cookie, "admin")).status, 403);
        assert.equal((await change(owner.cookie, "owner")).status, 400);
        assert.equal((await change(owner.cookie, "admin")).status, 200);
        assert.equal(
          (await call("/api/admin/users", { cookie: user.cookie })).status,
          200,
        );
        assert.equal((await change(user.cookie, "user")).status, 403);
        assert.equal(
          (
            await call(`/api/admin/users/${ownerId}/role`, {
              method: "PATCH",
              cookie: owner.cookie,
              body: { role: "user" },
            })
          ).status,
          403,
        );
        assert.equal((await change(owner.cookie, "user")).status, 200);
        assert.equal(
          (await call("/api/admin/users", { cookie: user.cookie })).status,
          403,
        );
        await assert.rejects(
          createOwner(pool, {
            username: "second_owner",
            email: "second@example.test",
            password,
          }),
          /уже существует/,
        );
        await assert.rejects(
          pool.query(
            "INSERT INTO users(id,username,email,password_hash,role) VALUES ($1,'illegal_owner','illegal@example.test','test','owner')",
            [randomUUID()],
          ),
          (error) => error.code === "23505",
        );
      },
    );

    await t.test(
      "audit entries identify actor and target without exposing passwords",
      async () => {
        const response = await call("/api/admin/events", {
          cookie: owner.cookie,
        });
        assert.equal(response.status, 200);
        const changes = response.data.events.filter(
          (event) => event.action === "role_changed",
        );
        assert.equal(changes.length, 2);
        assert.equal(changes[0].actorName, "owner");
        assert.equal(changes[0].targetName, "member");
        assert.equal(changes[0].newRole, "user");
        assert.equal(JSON.stringify(response.data).includes(password), false);
      },
    );

    await t.test(
      "search and pagination do not execute user input as SQL",
      async () => {
        for (let index = 0; index < 22; index++) {
          await pool.query(
            "INSERT INTO users(id,username,email,password_hash) VALUES ($1,$2,$3,'unused')",
            [randomUUID(), `fixture_${index}`, `fixture_${index}@example.test`],
          );
        }
        const first = await call("/api/admin/users", { cookie: owner.cookie });
        const second = await call("/api/admin/users?page=2", {
          cookie: owner.cookie,
        });
        assert.equal(first.data.users.length, 20);
        assert.equal(second.data.users.length, 4);
        assert.equal(
          new Set(
            [...first.data.users, ...second.data.users].map((user) => user.id),
          ).size,
          24,
        );
        assert.equal(
          (
            await call("/api/admin/users?search=MEMBER", {
              cookie: owner.cookie,
            })
          ).data.total,
          1,
        );
        assert.equal(
          (
            await call(
              `/api/admin/users?search=${encodeURIComponent("' OR 1=1 --")}`,
              { cookie: owner.cookie },
            )
          ).data.total,
          0,
        );
      },
    );

    await t.test(
      "password change revokes other sessions and logout revokes its own",
      async () => {
        const second = await login("member@example.test");
        const change = await call("/api/auth/password", {
          method: "POST",
          cookie: second.cookie,
          body: {
            currentPassword: password,
            password: "replacement-password-123",
            confirmPassword: "replacement-password-123",
          },
        });
        assert.equal(change.status, 200);
        assert.equal(
          (await call("/api/auth/me", { cookie: firstSession })).status,
          401,
        );
        assert.equal(
          (await call("/api/auth/me", { cookie: second.cookie })).status,
          401,
        );
        assert.equal(
          (await call("/api/auth/me", { cookie: change.cookie })).status,
          200,
        );
        assert.equal((await login("member@example.test")).status, 401);
        assert.equal(
          (
            await call("/api/auth/logout", {
              method: "POST",
              cookie: change.cookie,
              body: {},
            })
          ).status,
          200,
        );
        assert.equal(
          (await call("/api/auth/me", { cookie: change.cookie })).status,
          401,
        );
      },
    );

    await t.test(
      "production sets secure cookies and permits internal health checks",
      async () => {
        const production = createApp(
          pool,
          readConfig({
            DATABASE_URL: connectionString,
            NODE_ENV: "production",
            APP_URL: "https://hydra.example",
            TRUST_PROXY: "1",
          }),
        ).listen(0, "127.0.0.1");
        await new Promise((resolve) => production.once("listening", resolve));
        const origin = `http://127.0.0.1:${production.address().port}`;
        try {
          assert.equal((await fetch(`${origin}/api/health`)).status, 200);
          assert.equal((await fetch(`${origin}/api/auth/me`)).status, 400);
          const response = await fetch(`${origin}/api/auth/login`, {
            method: "POST",
            headers: {
              Origin: "https://hydra.example",
              "Content-Type": "application/json",
              "X-Requested-With": "HYDRA",
              "X-Forwarded-Proto": "https",
            },
            body: JSON.stringify({
              email: "member@example.test",
              password: "replacement-password-123",
            }),
          });
          assert.equal(response.status, 200);
          assert.match(
            response.headers.get("set-cookie"),
            /^__Host-hydra_session=/,
          );
          assert.match(response.headers.get("set-cookie"), /; Secure/);
        } finally {
          await new Promise((resolve) => production.close(resolve));
        }
      },
    );

    await t.test(
      "expired sessions fail and authentication attempts are limited",
      async () => {
        const temporary = await login(ownerEmail);
        await pool.query(
          "UPDATE sessions SET expires_at = now() - interval '1 second' WHERE user_id = $1",
          [ownerId],
        );
        assert.equal(
          (await call("/api/auth/me", { cookie: temporary.cookie })).status,
          401,
        );
        const { digest } = await import("../security.js");
        await pool.query(
          "INSERT INTO request_limits(key,attempts,expires_at) VALUES ($1,20,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET attempts=20, expires_at=excluded.expires_at",
          [digest(`login-account:${ownerEmail}`)],
        );
        const limited = await login(ownerEmail);
        assert.equal(limited.status, 429);
        assert.ok(Number(limited.headers.get("retry-after")) > 0);
      },
    );

    await t.test(
      "private server files cannot be downloaded and admin URL resolves",
      async () => {
        for (const path of [
          "/.env",
          "/server/config.js",
          "/server/migrations/001_accounts.sql",
          "/package.json",
          "/node_modules/pg/package.json",
        ]) {
          assert.equal((await call(path)).status, 404, path);
        }
        assert.equal((await call("/admin")).status, 301);
        assert.equal((await call("/admin/")).status, 200);
        assert.equal((await call("/register.html")).status, 200);
      },
    );
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool.end();
    await control.query(`DROP SCHEMA "${schema}" CASCADE`);
    await control.end();
  }
});
