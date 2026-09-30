/* Test de l'interface dans un vrai navigateur (Chromium via Playwright).
   Usage : node test/navigateur.mjs   (Playwright doit être installé : npm i -g playwright, ou PLAYWRIGHT_MODULE=<chemin>)
   Démarre son propre serveur sur un dossier de données temporaire. */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3990, BASE = `http://127.0.0.1:${PORT}`;
let echecs = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✘ ") + m); if (!c) echecs++; };
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

let pw;
try { pw = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright"); }
catch { try { pw = createRequire(join(process.execPath, "..", "..", "lib", "node_modules", "x"))("playwright"); } catch { console.log("Playwright introuvable : test navigateur ignoré."); process.exit(0); } }
const { chromium } = pw;

const dir = mkdtempSync(join(tmpdir(), "nutrilog-nav-"));
const srv = spawn(process.execPath, [join(RACINE, "server.js")], { env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", ADMIN_PASSWORD: "AdminInitial123", DATA_DIR: dir }, stdio: "ignore" });
for (let i = 0; i < 50; i++) { try { await fetch(BASE + "/"); break; } catch { await attendre(100); } }

/* Préparation par l'API : comptes, fiche BARF, une commande envoyée */
async function client() {
  let cookie = "";
  return async (m, u, b) => {
    const r = await fetch(BASE + u, { method: m, headers: { "X-Requested-With": "NutriLog", "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: b ? JSON.stringify(b) : undefined });
    const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
    return r.json().catch(() => ({}));
  };
}
const A = await client();
await A("POST", "/api/connexion", { login: "admin", mdp: "AdminInitial123" });
await A("POST", "/api/moi/motdepasse", { ancien: "AdminInitial123", nouveau: "AdminSecurise2026" });
let etat = await A("GET", "/api/etat");
const [pEmb] = etat.postes; // poste unique : Emballage
for (const [login, role, postes] of [["sophie", "secretariat", []], ["karim", "preparateur", [pEmb.id]]]) {
  await A("POST", "/api/utilisateurs", { login, nom: login, role, postes, mdp: "Provisoire2026x" });
  const u = await client(); await u("POST", "/api/connexion", { login, mdp: "Provisoire2026x" }); await u("POST", "/api/moi/motdepasse", { ancien: "Provisoire2026x", nouveau: "MonMdpPerso2026" });
}
const [croq, pate] = etat.produits;
const cmd = await A("POST", "/api/commandes", { clientId: etat.clients[0].id, dateMail: "2026-09-28", lignes: [{ produitId: croq.id, quantite: 2 }, { produitId: pate.id, quantite: 1 }] });
await A("POST", `/api/commandes/${cmd.id}/envoyer`);

const b = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium" });
const erreursJs = [];
async function page(vp) { const p = await b.newPage({ viewport: vp }); p.on("pageerror", (e) => erreursJs.push(e.message)); return p; }
async function connexion(p, login, mdp) { await p.goto(BASE + "/"); await p.fill("input[name=login]", login); await p.fill("input[name=mdp]", mdp); await p.click("#form-connexion button[type=submit]"); await p.waitForSelector("#app:not([hidden])"); }

console.log("Tablette : réseau coupé pendant la saisie du lot");
const t = await page({ width: 820, height: 1100 });
await connexion(t, "karim", "MonMdpPerso2026");
await t.click(".grille .cmd"); await t.click("[data-action=prendre]"); await t.waitForSelector(".ligne-prep");
await t.route("**/ligne", (r) => r.abort());
await t.fill("[data-lot='0']", "LOT-HORS-LIGNE"); await t.press("[data-lot='0']", "Tab"); await attendre(400);
ok(await t.$eval("[data-lot='0']", (e) => e.classList.contains("non-sauve")), "le lot non enregistré est signalé en rouge");
await t.check("[data-coche='0']"); await attendre(400);
ok(!(await t.isChecked("[data-coche='0']")), "la case dont l'envoi a échoué se décoche (l'écran reflète le serveur)");
await attendre(4500); // un rafraîchissement automatique passe
ok((await t.inputValue("[data-lot='0']")) === "LOT-HORS-LIGNE", "après rafraîchissement, le lot saisi est toujours là");
await t.unroute("**/ligne");
await t.check("[data-coche='0']"); await t.waitForSelector(".ligne-prep.faite"); await t.check("[data-coche='1']"); await attendre(600);
let serveur = await A("GET", "/api/etat");
ok(serveur.commandes[0].lignes[0].lot === "LOT-HORS-LIGNE", "réseau revenu : le lot est enregistré avec la coche");

console.log("Tablette : double appui sur « Terminer »");
const reponses = [];
t.on("response", (r) => { if (r.url().endsWith("/terminer")) reponses.push(r.status()); });
await t.waitForSelector("[data-action=terminer]:not([disabled])");
await t.dblclick("[data-action=terminer]"); await attendre(1200);
ok(reponses.length === 1 && reponses[0] === 200, `une seule requête envoyée (${JSON.stringify(reponses)})`);
ok(!(await t.$eval("#toast", (e) => e.classList.contains("erreur"))), "pas de message d'erreur rouge après le succès");

console.log("Secrétariat : recherche, rafraîchissement, audit");
const s = await page({ width: 1280, height: 900 });
await connexion(s, "sophie", "MonMdpPerso2026");
await s.click("[data-recherche]"); await s.keyboard.type("anim");
await A("POST", `/api/commandes/${cmd.id}/message`, { texte: "changement venant d'un autre poste" });
await attendre(4500);
await s.keyboard.type("al");
ok((await s.inputValue("[data-recherche]")) === "animal", "la frappe continue dans la recherche malgré le rafraîchissement");
await s.click("[data-onglet=commandes]");
await s.click("[data-action=nouvelle-commande]"); await s.fill("textarea[name=sourceMail]", "Texte du mail en cours de saisie");
ok((await s.inputValue("input[name=dateMail]")) === new Date().toLocaleDateString("fr-CA"), "date du mail pré-remplie en date locale");
await A("POST", `/api/commandes/${cmd.id}/message`, { texte: "encore un changement" });
await attendre(4500);
ok((await s.inputValue("textarea[name=sourceMail]")) === "Texte du mail en cours de saisie", "formulaire ouvert : saisie intacte après rafraîchissement");

console.log("Session fermée pendant une saisie");
const u = (await A("GET", "/api/etat")).utilisateurs.find((x) => x.login === "sophie");
await A("PUT", `/api/utilisateurs/${u.id}`, { actif: false }); await A("PUT", `/api/utilisateurs/${u.id}`, { actif: true }); // coupe ses sessions
await s.waitForSelector("#ecran-connexion:not([hidden])", { timeout: 8000 });
ok((await s.textContent("#erreur-connexion")).includes("session a expiré"), "un message explique la déconnexion");
await s.fill("input[name=login]", "sophie"); await s.fill("input[name=mdp]", "MonMdpPerso2026"); await s.click("#form-connexion button[type=submit]");
await s.waitForSelector("#app:not([hidden])");
ok(await s.isVisible("textarea[name=sourceMail]") && (await s.inputValue("textarea[name=sourceMail]")) === "Texte du mail en cours de saisie", "après reconnexion, le formulaire et sa saisie sont rendus");

console.log("Admin : onglet Audit stable");
const a = await page({ width: 1280, height: 900 });
await connexion(a, "admin", "AdminSecurise2026");
let appelsAudit = 0; a.on("request", (r) => { if (r.url().endsWith("/api/audit")) appelsAudit++; });
await a.click("[data-onglet=audit]"); await a.waitForSelector("table tbody tr");
await A("POST", `/api/commandes/${cmd.id}/message`, { texte: "x" }); await attendre(4500);
ok(appelsAudit === 1, `le journal n'est pas rechargé à chaque rafraîchissement (${appelsAudit} chargement)`);

console.log("Tablette partagée : rien ne passe d'une personne à la suivante");
await a.click("[data-onglet=utilisateurs]"); await a.waitForSelector("table tbody tr");
await a.click("#btn-deconnexion"); await a.waitForSelector("#ecran-connexion:not([hidden])");
ok((await a.innerHTML("#contenu")) === "" && (await a.textContent("#qui")) === "" && (await a.innerHTML("#onglets")) === "", "déconnexion : l'écran de l'admin est effacé");
await a.route("**/api/etat", async (r) => { await attendre(1500); await r.continue(); });
await a.fill("input[name=login]", "karim"); await a.fill("input[name=mdp]", "MonMdpPerso2026"); await a.click("#form-connexion button[type=submit]");
await attendre(700);
ok(!(await a.isVisible("[data-onglet=utilisateurs]")) && !(await a.textContent("body")).includes("Administrateur ·"), "pendant le chargement, Karim ne voit rien de la session admin");
await a.waitForSelector("#app:not([hidden])"); await a.unroute("**/api/etat");
ok((await a.textContent("#qui")).startsWith("karim"), "puis son propre écran s'affiche");

ok(erreursJs.length === 0, "aucune erreur JavaScript" + (erreursJs.length ? " : " + erreursJs.join(" | ") : ""));
await b.close(); srv.kill(); rmSync(dir, { recursive: true, force: true });
console.log(echecs ? `\n${echecs} ÉCHEC(S)` : "\nTOUT EST OK");
process.exit(echecs ? 1 : 0);
