#!/usr/bin/env node
/**
 * Run the app against the local Anthropic mock (no API key, no cost):
 *   npm run dev:mock            -> http://localhost:3000
 * Replies are canned. Use this to click through the UI, not to judge advice.
 */
import { spawn } from "node:child_process";
import { startMock } from "./mock-anthropic.mjs";

const port = process.env.PORT ?? "3000";
const mock = await startMock({ port: Number(process.env.MOCK_PORT ?? 4010), delayMs: 25, log: true });
console.log(`[dev:mock] Anthropic mock on ${mock.url}`);

const child = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["next", "dev", "-p", port], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, ANTHROPIC_BASE_URL: mock.url, ANTHROPIC_API_KEY: "sk-ant-mock" },
});
const stop = async () => {
  child.kill();
  await mock.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", async (code) => {
  await mock.close();
  process.exit(code ?? 0);
});
