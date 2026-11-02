import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";

const deriveKey = promisify(scrypt);
const scryptOptions = { N: 65536, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
export const sessionDuration = 7 * 86400_000;
export const usernameSchema = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9_]{3,32}$/, "Имя: 3–32 латинские буквы, цифры или _.")
  .transform((value) => value.toLowerCase());
export const emailSchema = z
  .string()
  .trim()
  .max(254)
  .email("Укажите корректный email.")
  .transform((value) => value.toLowerCase());
export const passwordSchema = z
  .string()
  .min(12, "Пароль должен содержать не менее 12 символов.")
  .max(128, "Пароль должен содержать не более 128 символов.");

export function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await deriveKey(password, salt, 64, scryptOptions);
  return `scrypt$${salt}$${key.toString("hex")}`;
}

export async function verifyPassword(password, storedHash) {
  const [, salt, hash] = (storedHash || "").split("$");
  const expected =
    hash && /^[a-f0-9]{128}$/.test(hash)
      ? Buffer.from(hash, "hex")
      : Buffer.alloc(64);
  const actual = await deriveKey(
    password,
    salt || "hydra-missing-account",
    64,
    scryptOptions,
  );
  return timingSafeEqual(actual, expected) && Boolean(storedHash);
}

export async function createSession(db, userId, previousToken) {
  if (previousToken)
    await db.query("DELETE FROM sessions WHERE token_hash = $1", [
      digest(previousToken),
    ]);
  await db.query(
    "DELETE FROM sessions WHERE user_id = $1 AND expires_at <= now()",
    [userId],
  );
  const token = randomBytes(32).toString("hex");
  await db.query(
    "INSERT INTO sessions(token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
    [digest(token), userId, new Date(Date.now() + sessionDuration)],
  );
  return token;
}

export function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at,
  };
}

export async function recordEvent(
  db,
  action,
  actorId,
  targetId,
  previousRole = null,
  newRole = null,
) {
  await db.query(
    "INSERT INTO account_events(action, actor_id, target_id, previous_role, new_role) VALUES ($1, $2, $3, $4, $5)",
    [action, actorId, targetId, previousRole, newRole],
  );
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function rateLimit(
  pool,
  category,
  maximum,
  identifier = (req) => req.ip,
) {
  return async (req, res, next) => {
    const key = digest(`${category}:${identifier(req)}`);
    const {
      rows: [limit],
    } = await pool.query(
      `
      INSERT INTO request_limits(key, attempts, expires_at) VALUES ($1, 1, now() + interval '15 minutes')
      ON CONFLICT (key) DO UPDATE SET
        attempts = CASE WHEN request_limits.expires_at <= now() THEN 1 ELSE request_limits.attempts + 1 END,
        expires_at = CASE WHEN request_limits.expires_at <= now() THEN now() + interval '15 minutes' ELSE request_limits.expires_at END
      RETURNING attempts, expires_at`,
      [key],
    );
    if (limit.attempts > maximum) {
      res.set(
        "Retry-After",
        String(
          Math.max(
            1,
            Math.ceil((limit.expires_at.getTime() - Date.now()) / 1000),
          ),
        ),
      );
      throw new HttpError(
        429,
        "Слишком много попыток. Повторите через 15 минут.",
      );
    }
    next();
  };
}
