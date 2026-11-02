import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { createAuth } from "./auth.js";
import { createAdmin } from "./admin.js";
import { HttpError, rateLimit } from "./security.js";

const root = fileURLToPath(new URL("../public/", import.meta.url));
const pages = new Set([
  "index.html",
  "catalog.html",
  "product.html",
  "faq.html",
  "privacy-policy.html",
  "terms.html",
  "404.html",
  "login.html",
  "register.html",
  "account.html",
]);

export function createApp(pool, config, app = express()) {
  app.enable("strict routing");
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          imgSrc: ["'self'", "data:", "https:"],
          upgradeInsecureRequests: config.production ? [] : null,
        },
      },
      strictTransportSecurity: config.production ? undefined : false,
    }),
  );
  app.use(express.json({ limit: "8kb" }));
  app.use(cookieParser());
  app.get("/api/health", async (req, res) => {
    res.set("Cache-Control", "no-store");
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  });
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (config.production && !req.secure)
      throw new HttpError(400, "Для входа требуется HTTPS.");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (
        !config.origins.has(req.get("origin")) ||
        req.get("X-Requested-With") !== "HYDRA" ||
        !req.is("application/json")
      ) {
        throw new HttpError(
          403,
          "Недопустимый источник запроса. Откройте сайт по адресу из APP_URL.",
        );
      }
    }
    next();
  });
  app.use("/api", rateLimit(pool, "api", 1500));
  const auth = createAuth(pool, config);
  app.use("/api/auth", auth.router);
  app.use("/api/admin", createAdmin(pool, auth.requireAuth));
  app.use("/api", (req, res) =>
    res.status(404).json({ message: "Адрес API не найден." }),
  );

  app.use(
    "/assets",
    express.static(`${root}/assets`, {
      dotfiles: "deny",
      index: false,
      maxAge: "1h",
    }),
  );
  app.get("/admin", (req, res) => res.redirect(301, "/admin/"));
  app.get(["/admin/", "/admin/index.html"], (req, res) => {
    res.set({
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    });
    res.sendFile("admin/index.html", { root });
  });
  app.get("/", (req, res) => res.sendFile("index.html", { root }));
  app.get("/:page", (req, res, next) => {
    if (!pages.has(req.params.page)) return next();
    res.set("Cache-Control", "no-cache");
    res.sendFile(req.params.page, { root });
  });
  app.use(async (req, res) => {
    const html = await readFile(`${root}/404.html`, "utf8");
    res
      .status(404)
      .type("html")
      .send(html.replace("<head>", '<head><base href="/">'));
  });
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof z.ZodError)
      return res.status(400).json({ message: error.issues[0].message });
    if (error.code === "23505")
      return res
        .status(409)
        .json({ message: "Этот email или имя уже используется." });
    if (error instanceof HttpError)
      return res.status(error.status).json({ message: error.message });
    if (error.type === "entity.parse.failed")
      return res.status(400).json({ message: "Некорректный формат запроса." });
    if (error.type === "entity.too.large")
      return res.status(413).json({ message: "Запрос слишком большой." });
    console.error("Ошибка обработки запроса:", error.code || error.name);
    res
      .status(500)
      .json({ message: "Не удалось выполнить запрос. Попробуйте позже." });
  });
  return app;
}
