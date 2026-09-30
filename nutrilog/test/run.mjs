/* Lance le serveur sur un dossier de données temporaire, joue le scénario test.mjs, puis arrête tout. */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
process.env.NUTRILOG_EXEMPLES = "1"; // jeu d'exemple (4 produits, 3 clients) : les tests ne dépendent pas du catalogue réel
const dataDir = mkdtempSync(join(tmpdir(), "nutrilog-test-"));
const serveur = spawn(process.execPath, [join(racine, "server.js")], {
  env: { ...process.env, PORT: "3999", HOST: "127.0.0.1", ADMIN_PASSWORD: "AdminInitial123", DATA_DIR: dataDir },
  stdio: ["ignore", "ignore", "inherit"],
});

// Attend que le serveur réponde
for (let i = 0; i < 50; i++) {
  try { await fetch("http://127.0.0.1:3999/"); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
}

const test = spawn(process.execPath, [join(racine, "test", "test.mjs")], { stdio: "inherit" });
const code = await new Promise((r) => test.on("exit", r));
serveur.kill();
rmSync(dataDir, { recursive: true, force: true });
process.exit(code);
