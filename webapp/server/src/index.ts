// Fastify app entrypoint: serves the built dashboard (if present), registers the
// API + hook routes, and listens on 127.0.0.1:4319.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { HOST, PORT, PROJECT_ROOT } from "./config.js";
import { reapStaleRuns } from "./db.js";
import { registerRoutes } from "./routes.js";

async function main(): Promise<void> {
  const app = Fastify({ logger: true });

  // Our bodyless POSTs (sync/plan/draft/cancel/approve-plan) still send
  // `Content-Type: application/json`; Fastify rejects an empty JSON body with
  // FST_ERR_CTP_EMPTY_JSON_BODY (400). Treat an empty body as `{}`.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    const text = typeof body === "string" ? body : "";
    if (text.trim() === "") {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(text));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  const webDist = resolve(PROJECT_ROOT, "webapp/web/dist");
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, prefix: "/" });
    app.log.info(`Serving dashboard from ${webDist}`);
  } else {
    app.log.warn(`Dashboard build not found at ${webDist}; in dev use the Vite server on :5173.`);
  }

  const reaped = reapStaleRuns();
  if (reaped > 0) app.log.warn(`Reaped ${reaped} stale run(s) from a previous process.`);

  await registerRoutes(app);

  await app.listen({ host: HOST, port: PORT });
  app.log.info(`moodle-mate server: http://${HOST}:${PORT}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
