import { Hono } from "hono";

const app = new Hono();

app.get("/health", (c) => {
  return c.json({ status: "ok", service: "backend" });
});

const port = Number(Bun.env.BACKEND_PORT ?? 3000);

export default {
  port,
  fetch: app.fetch
};
