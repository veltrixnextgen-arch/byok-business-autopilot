import { Hono } from "hono";
import type { AppEnv } from "../context.js";

export const healthRoute = new Hono<AppEnv>().get("/", (c) => c.json({ status: "ok" }));
