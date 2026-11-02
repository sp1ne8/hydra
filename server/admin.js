import { Router } from "express";
import { z } from "zod";
import { transaction } from "./database.js";
import { HttpError, publicUser, recordEvent } from "./security.js";

const pageSchema = z.coerce.number().int().min(1).max(100000).default(1);
const pageSize = 20;

export function createAdmin(pool, requireAuth) {
  const router = Router();
  router.use(requireAuth, (req, res, next) => {
    if (!["owner", "admin"].includes(req.user.role))
      throw new HttpError(403, "Доступ разрешён только администраторам.");
    next();
  });

  router.get("/users", async (req, res) => {
    const { page, search } = z
      .object({
        page: pageSchema,
        search: z.string().trim().max(100).default(""),
      })
      .strict()
      .parse(req.query);
    const filter = "position($1 in username) > 0 OR position($1 in email) > 0";
    const term = search.toLowerCase();
    const result = await pool.query(
      `SELECT * FROM users WHERE ${filter} ORDER BY created_at DESC, id LIMIT $2 OFFSET $3`,
      [term, pageSize, (page - 1) * pageSize],
    );
    const {
      rows: [counts],
    } = await pool.query(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE role IN ('owner', 'admin'))::int AS admins FROM users WHERE ${filter}`,
      [term],
    );
    res.json({ users: result.rows.map(publicUser), ...counts, page, pageSize });
  });

  router.get("/events", async (req, res) => {
    const { page } = z.object({ page: pageSchema }).strict().parse(req.query);
    const result = await pool.query(
      `
      SELECT e.id, e.action, e.previous_role AS "previousRole", e.new_role AS "newRole", e.created_at AS "createdAt",
        actor.username AS "actorName", target.username AS "targetName"
      FROM account_events e LEFT JOIN users actor ON actor.id = e.actor_id LEFT JOIN users target ON target.id = e.target_id
      ORDER BY e.id DESC LIMIT $1 OFFSET $2`,
      [pageSize, (page - 1) * pageSize],
    );
    const {
      rows: [{ total }],
    } = await pool.query("SELECT count(*)::int AS total FROM account_events");
    res.json({ events: result.rows, total, page, pageSize });
  });

  router.patch("/users/:id/role", async (req, res) => {
    if (req.user.role !== "owner")
      throw new HttpError(403, "Права назначает только главный администратор.");
    const id = z.string().uuid().parse(req.params.id);
    const { role } = z
      .object({ role: z.enum(["user", "admin"]) })
      .strict()
      .parse(req.body);
    const user = await transaction(pool, async (db) => {
      const {
        rows: [owner],
      } = await db.query("SELECT role FROM users WHERE id = $1 FOR UPDATE", [
        req.user.id,
      ]);
      if (owner?.role !== "owner")
        throw new HttpError(
          403,
          "Права назначает только главный администратор.",
        );
      const {
        rows: [target],
      } = await db.query("SELECT * FROM users WHERE id = $1 FOR UPDATE", [id]);
      if (!target) throw new HttpError(404, "Аккаунт не найден.");
      if (target.role === "owner")
        throw new HttpError(
          403,
          "Права главного администратора нельзя изменить.",
        );
      if (target.role === role) return target;
      const {
        rows: [updated],
      } = await db.query(
        "UPDATE users SET role = $1 WHERE id = $2 RETURNING *",
        [role, id],
      );
      await recordEvent(db, "role_changed", req.user.id, id, target.role, role);
      return updated;
    });
    res.json({ user: publicUser(user) });
  });

  return router;
}
