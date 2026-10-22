import { startServer } from "next/dist/server/lib/start-server.js";

const hostname = process.env.E2E_WEB_HOST;
const port = Number(process.env.E2E_WEB_PORT);
if (!hostname || !Number.isInteger(port) || port < 1)
  throw new Error("E2E_WEB_HOST and a valid E2E_WEB_PORT are required");

await startServer({
  dir: process.cwd(),
  isDev: true,
  hostname,
  port,
  allowRetry: false,
});
