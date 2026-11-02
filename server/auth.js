import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { transaction } from "./database.js";
import {
  HttpError,
  createSession,
  digest,
  emailSchema,
  hashPassword,
  passwordSchema,
  publicUser,
  rateLimit,
  recordEvent,
  sessionDuration,
  usernameSchema,
  verifyPassword,
} from "./security.js";

export function createAuth(pool, config) {
  const router = Router();
  const cookieName = config.production
    ? "__Host-hydra_session"
    : "hydra_session";
  const cookieOptions = {
    httpOnly: true,
    secure: config.production,
    sameSite: "lax",
    path: "/",
  };
  const setSession = (res, token) =>
    res.cookie(cookieName, token, {
      ...cookieOptions,
      maxAge: sessionDuration,
    });
  const tokenOf = (req) => req.cookies[cookieName];

  async function requireAuth(req, res, next) {
    const token = tokenOf(req);
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
      throw new HttpError(401, "Войдите в аккаунт.");
    const {
      rows: [user],
    } = await pool.query(
      `
      SELECT u.* FROM users u JOIN sessions s ON s.user_id = u.id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [digest(token)],
    );
    if (!user) {
      res.clearCookie(cookieName, cookieOptions);
      throw new HttpError(401, "Сессия истекла. Войдите снова.");
    }
    req.user = user;
    next();
  }

  const registerSchema = z
    .object({
      username: usernameSchema,
      email: emailSchema,
      password: passwordSchema,
      confirmPassword: z.string().max(128),
    })
    .strict()
    .refine((value) => value.password === value.confirmPassword, {
      message: "Пароли не совпадают.",
      path: ["confirmPassword"],
    });
  const loginSchema = z
    .object({ email: emailSchema, password: z.string().min(1).max(128) })
    .strict();
  const validate = (schema) => (req, res, next) => {
    req.input = schema.parse(req.body);
    next();
  };

  router.post(
    "/register",
    rateLimit(pool, "register", 10),
    validate(registerSchema),
    async (req, res) => {
      const { username, email, password } = req.input;
      const passwordHash = await hashPassword(password);
      const result = await transaction(pool, async (db) => {
        const {
          rows: [user],
        } = await db.query(
          "INSERT INTO users(id, username, email, password_hash) VALUES ($1, $2, $3, $4) RETURNING *",
          [randomUUID(), username, email, passwordHash],
        );
        await recordEvent(db, "register", user.id, user.id);
        const token = await createSession(db, user.id, tokenOf(req));
        return { user: publicUser(user), token };
      });
      setSession(res, result.token);
      res.status(201).json({ user: result.user });
    },
  );

  router.post(
    "/login",
    rateLimit(pool, "login-ip", 60),
    validate(loginSchema),
    rateLimit(pool, "login-account", 20, (req) => req.input.email),
    async (req, res) => {
      const { email, password } = req.input;
      const {
        rows: [credentials],
      } = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
      const matches = await verifyPassword(
        password,
        credentials?.password_hash,
      );
      if (!credentials || !matches)
        throw new HttpError(401, "Неверный email или пароль.");
      const result = await transaction(pool, async (db) => {
        const {
          rows: [user],
        } = await db.query("SELECT * FROM users WHERE id = $1 FOR UPDATE", [
          credentials.id,
        ]);
        if (!user || user.password_hash !== credentials.password_hash)
          throw new HttpError(401, "Неверный email или пароль.");
        const {
          rows: [updated],
        } = await db.query(
          "UPDATE users SET last_login_at = now() WHERE id = $1 RETURNING *",
          [user.id],
        );
        await recordEvent(db, "login", user.id, user.id);
        const token = await createSession(db, user.id, tokenOf(req));
        return { user: publicUser(updated), token };
      });
      setSession(res, result.token);
      res.json({ user: result.user });
    },
  );

  router.get("/me", requireAuth, (req, res) =>
    res.json({ user: publicUser(req.user) }),
  );

  router.post("/logout", requireAuth, async (req, res) => {
    await transaction(pool, async (db) => {
      await db.query("DELETE FROM sessions WHERE token_hash = $1", [
        digest(tokenOf(req)),
      ]);
      await recordEvent(db, "logout", req.user.id, req.user.id);
    });
    res.clearCookie(cookieName, cookieOptions);
    res.json({ success: true });
  });

  const changePasswordSchema = z
    .object({
      currentPassword: z.string().min(1).max(128),
      password: passwordSchema,
      confirmPassword: z.string().max(128),
    })
    .strict()
    .refine((value) => value.password === value.confirmPassword, {
      message: "Пароли не совпадают.",
      path: ["confirmPassword"],
    });

  router.post(
    "/password",
    requireAuth,
    rateLimit(pool, "password", 10, (req) => req.user.id),
    validate(changePasswordSchema),
    async (req, res) => {
      if (
        !(await verifyPassword(
          req.input.currentPassword,
          req.user.password_hash,
        ))
      )
        throw new HttpError(400, "Текущий пароль указан неверно.");
      const passwordHash = await hashPassword(req.input.password);
      const token = await transaction(pool, async (db) => {
        const {
          rows: [current],
        } = await db.query(
          "SELECT password_hash FROM users WHERE id = $1 FOR UPDATE",
          [req.user.id],
        );
        if (current.password_hash !== req.user.password_hash)
          throw new HttpError(409, "Пароль уже изменён. Войдите снова.");
        await db.query("UPDATE users SET password_hash = $1 WHERE id = $2", [
          passwordHash,
          req.user.id,
        ]);
        await db.query("DELETE FROM sessions WHERE user_id = $1", [
          req.user.id,
        ]);
        await recordEvent(db, "password_changed", req.user.id, req.user.id);
        return createSession(db, req.user.id);
      });
      setSession(res, token);
      res.json({ success: true });
    },
  );

  return { router, requireAuth };
}
