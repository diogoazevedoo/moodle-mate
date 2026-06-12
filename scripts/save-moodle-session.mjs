#!/usr/bin/env node
// One-time human Moodle login.
//
// Opens a real (headed) Chromium window, lets YOU log in by hand (student number
// + password — typed directly into the browser, never seen by this script), then
// saves the authenticated browser session to .auth/moodle-storage-state.json so
// the rest of moodle-mate can reuse it via Playwright.
//
//   npm run moodle:login
//
// SAFETY: this script NEVER reads, prints, stores, or handles MOODLE_PASSWORD.
// The only thing it persists is the post-login Playwright storage state (cookies
// + localStorage), which is what the deterministic Moodle sync reuses.

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const here = dirname(fileURLToPath(import.meta.url)); // <repo>/scripts
const REPO_ROOT = resolve(here, ".."); // repo root
const AUTH_DIR = resolve(REPO_ROOT, ".auth");
const STORAGE_STATE_PATH = resolve(AUTH_DIR, "moodle-storage-state.json");

const MOODLE_BASE_URL = "https://moodle.istec-porto.pt";
const DEFAULT_LOGIN_URL = `${MOODLE_BASE_URL}/login/index.php`;

/**
 * Read .env from the repo root and return ONLY the login URL.
 * We deliberately never touch MOODLE_PASSWORD here.
 */
function readLoginUrlFromEnv() {
  try {
    const raw = readFileSync(resolve(REPO_ROOT, ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      if (key !== "MOODLE_LOGIN_URL") continue; // ignore everything else, incl. the password
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (value) return value;
    }
  } catch {
    // No .env or unreadable — fall back to the default login URL below.
  }
  return null;
}

function waitForEnter(prompt) {
  return new Promise((resolveEnter) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, () => { rl.close(); resolveEnter(); });
  });
}

async function main() {
  const loginUrl = process.env.MOODLE_LOGIN_URL || readLoginUrlFromEnv() || DEFAULT_LOGIN_URL;

  console.log("\nmoodle-mate — one-time Moodle login\n");
  console.log(`Opening a browser at: ${loginUrl}`);

  await mkdir(AUTH_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
  } catch (err) {
    console.error(`\nCould not open ${loginUrl}: ${err?.message ?? err}`);
    console.error("The browser window is still open — navigate to Moodle manually.\n");
  }

  console.log("\n────────────────────────────────────────────────────────────");
  console.log("Log in by hand in the window (student number + password).");
  console.log("This script never sees or stores your password.");
  console.log("When your Moodle dashboard is fully loaded, press ENTER here.");
  console.log("────────────────────────────────────────────────────────────\n");

  await waitForEnter("Press ENTER once you are logged in… ");

  await context.storageState({ path: STORAGE_STATE_PATH });

  await context.close();
  await browser.close();

  console.log(`\nSession saved to: ${STORAGE_STATE_PATH}`);
  console.log("You can now run `npm run dev` and click Sync in the dashboard.");
  console.log("Tip: you may delete MOODLE_PASSWORD from .env now — it is not needed again.\n");
}

main().catch(async (err) => {
  console.error(`\nLogin script failed: ${err?.message ?? err}\n`);
  process.exit(1);
});
