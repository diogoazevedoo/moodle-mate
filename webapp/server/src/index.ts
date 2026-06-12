// Fastify app entrypoint: serves the built dashboard (if present), registers the
// API + hook routes, and listens on 127.0.0.1:4319.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { HOST, PORT, PROJECT_ROOT } from "./config.js";
import { registerRoutes } from "./routes.js";

async function main(): Promise<void> {
  const app = Fastify({ logger: true });

  const webDist = resolve(PROJECT_ROOT, "webapp/web/dist");
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, prefix: "/" });
    app.log.info(`Serving dashboard from ${webDist}`);
  } else {
    app.log.warn(`Dashboard build not found at ${webDist}; in dev use the Vite server on :5173.`);
  }

  await registerRoutes(app);

  await app.listen({ host: HOST, port: PORT });
  app.log.info(`moodle-mate server: http://${HOST}:${PORT}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
