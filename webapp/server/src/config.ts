// Central paths + settings. Resolves the project root relative to this file.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)); // webapp/server/src
export const PROJECT_ROOT = resolve(here, "../../.."); // repo root
export const DATA_DIR = resolve(PROJECT_ROOT, "data");
export const WORKSPACE_DIR = resolve(PROJECT_ROOT, "workspace");
export const CLASSES_DIR = resolve(PROJECT_ROOT, "classes");
export const STORAGE_STATE_PATH = resolve(PROJECT_ROOT, ".auth/moodle-storage-state.json");

export const PORT = Number(process.env.PORT ?? 4319);
export const HOST = "127.0.0.1";

export const MOODLE_BASE_URL = process.env.MOODLE_BASE_URL ?? "https://moodle.istec-porto.pt";
export const MOODLE_LOGIN_URL =
  process.env.MOODLE_LOGIN_URL ?? `${MOODLE_BASE_URL}/login/index.php`;

// Path to the `claude` CLI (engine). Overridable if not on PATH.
export const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "claude";

export function workspaceFor(deliverableId: string): string {
  return resolve(WORKSPACE_DIR, deliverableId);
}
