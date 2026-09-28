/* Scénario de bout en bout de NutriLog.
   Lancé par test/run.mjs : serveur principal sur le port 3999 (ADMIN_PASSWORD=AdminInitial123).
   Les sections 8 à 11 démarrent leurs propres serveurs sur d'autres ports. */
import net from "node:net";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "http://127.0.0.1:3999";
let echecs = 0;
function ok(cond, msg) { console.log((cond ? "  ✔ " : "  ✘ ") + msg); if (!cond) echecs++; }
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

function session(base = BASE, entetes = {}) {
  let cookie = "";
  const f = async function (methode, url, corps, opts = {}) {
    const headers = { "X-Requested-With": "NutriLog", ...entetes, ...(corps ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(opts.headers || {}) };
    if (opts.sansCsrf) delete headers["X-Requested-With"];
    const r = await fetch(base + url, { method: methode, headers, body: corps ? JSON.stringify(corps) : undefined });
    const sc = r.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    let data = {}; try { data = await r.json(); } catch {}
    return { status: r.status, data, headers: r.headers };
  };
  f.cookie = () => cookie;
  return f;
}

/* Requête HTTP brute (fetch normalise les « .. » : on veut tester ce que le serveur reçoit vraiment) */
function brute(port, ligne) {
  return new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1", () => s.write(`${ligne} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`));
    let out = ""; s.on("data", (d) => (out += d)); s.on("end", () => resolve(out.split("\r\n")[0])); s.on("error", () => resolve("ERREUR"));
  });
}

async function demarrer(port, env, dataDir) {
  const p = spawn(process.execPath, [join(RACINE, "server.js")], { env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DATA_DIR: dataDir, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let sortie = ""; p.stdout.on("data", (d) => (sortie += d)); p.stderr.on("data", (d) => (sortie += d));
  const fin = new Promise((r) => p.on("exit", (code) => r(code)));
  for (let i = 0; i < 50; i++) {
    if (p.exitCode !== null) break;
    try { await fetch(`http://127.0.0.1:${port}/`); break; } catch { await attendre(100); }
  }
  return { p, fin, sortie: () => sortie };
}

const admin = session(), secr = session(), pick = session(), emb = session(), ctrl = session(), ctrl2 = session(), anon = session();

console.log("1. Sécurité de base");
let r = await anon("GET", "/api/etat");
ok(r.status === 401, "sans session → 401");
r = await anon("POST", "/api/connexion", { login: "admin", mdp: "AdminInitial123" }, { sansCsrf: true });
ok(r.status === 403, "sans en-tête anti-CSRF → 403");
r = await anon("POST", "/api/connexion", { login: "admin", mdp: "x" }, { headers: { Origin: "null" } });
ok(r.status === 403, "Origin: null → 403 (et non 500)");
r = await anon("POST", "/api/connexion", { login: "admin", mdp: "x" }, { headers: { Origin: "http://evil.example" } });
ok(r.status === 403, "Origine étrangère → 403");
for (const u of ["/../server.js", "/%2e%2e/server.js", "/..%2fserver.js", "/%2e%2e%2f%2e%2e%2fetc/passwd", "/..\\server.js"]) {
  const st = await brute(3999, "GET " + u);
  ok(!/ 200 /.test(st), `traversée refusée ${u} → ${st}`);
}
ok(/ 400 /.test(await brute(3999, "GET /%00")), "octet nul dans l'URL → 400");
r = await fetch(BASE + "/"); ok(r.status === 200, "le serveur répond toujours après /%00 (pas de plantage)");
ok(r.headers.get("content-security-policy")?.includes("default-src 'self'"), "CSP présente");
ok(r.headers.get("x-frame-options") === "DENY", "X-Frame-Options DENY");
r = await fetch(BASE + "/", { method: "HEAD" }); ok(r.status === 200, "HEAD accepté");
r = await anon("POST", "/api/connexion", { login: "admin", mdp: "mauvais" });
ok(r.status === 401, "mauvais mot de passe → 401");

console.log("2. Admin : première connexion, changement de mot de passe obligatoire");
r = await admin("POST", "/api/connexion", { login: "admin", mdp: "AdminInitial123" });
ok(r.status === 200 && r.data.moi.doitChangerMdp, "connexion admin ok, mdp à changer");
r = await admin("GET", "/api/etat"); ok(r.status === 403 && r.data.doitChangerMdp, "bloqué tant que le mdp n'est pas changé");
r = await admin("POST", "/api/moi/motdepasse", { ancien: "AdminInitial123", nouveau: "court" }); ok(r.status === 400, "mdp trop court refusé");
const cookieAvant = admin.cookie();
r = await admin("POST", "/api/moi/motdepasse", { ancien: "AdminInitial123", nouveau: "AdminSecurise2026" }); ok(r.status === 200, "mdp changé");
ok(admin.cookie() === cookieAvant, "la session courante est conservée (pas de déconnexion surprise)");
r = await admin("GET", "/api/etat"); ok(r.status === 200 && r.data.utilisateurs, "admin voit l'état complet");
const [pPick, pEmb, pCtrl] = r.data.postes;
const produits = r.data.produits; const clients = r.data.clients;
const [croq, pate, barf, litiere] = produits;

console.log("3. Admin crée les comptes (un identifiant par personne)");
const creer = async (login, nom, role, ps) => { const x = await admin("POST", "/api/utilisateurs", { login, nom, role, postes: ps, mdp: "Provisoire2026x" }); ok(x.status === 201, `compte ${login} créé`); return x.data; };
await creer("sophie", "Sophie (secrétariat)", "secretariat", []);
const karim = await creer("karim", "Karim (picking)", "preparateur", [pPick.id]);
await creer("lea", "Léa (emballage)", "preparateur", [pEmb.id]);
const marc = await creer("marc", "Marc (contrôle)", "preparateur", [pCtrl.id]);
await creer("paul", "Paul (contrôle)", "preparateur", [pCtrl.id]);
r = await admin("POST", "/api/utilisateurs", { login: "sophie", nom: "x", role: "secretariat", mdp: "Provisoire2026x" }); ok(r.status === 409, "identifiant en double refusé");
r = await admin("POST", "/api/utilisateurs", { login: "hack", nom: "x", role: "dieu", mdp: "Provisoire2026x" }); ok(r.status === 400, "rôle inconnu refusé");
r = await admin("PUT", `/api/postes/${pEmb.id}`, { nom: "picking" }); ok(r.status === 409, "renommer un poste en doublon (casse différente) → 409");

const connecter = async (s, login) => {
  let x = await s("POST", "/api/connexion", { login, mdp: "Provisoire2026x" }); ok(x.status === 200, `${login} connecté`);
  x = await s("POST", "/api/moi/motdepasse", { ancien: "Provisoire2026x", nouveau: "MonMdpPerso2026" }); ok(x.status === 200, `${login} a changé son mdp`);
};
await connecter(secr, "sophie"); await connecter(pick, "karim"); await connecter(emb, "lea"); await connecter(ctrl, "marc"); await connecter(ctrl2, "paul");

console.log("4. Secrétariat : saisie depuis un mail, validation stricte, contrôle avant envoi");
const base = { clientId: clients[0].id, sourceMail: "Objet : commande animalerie\nBonjour, 10 sacs de croquettes et 5 cartons de pâtée svp", dateMail: "2026-09-28", dateLivraisonSouhaitee: "2026-09-30", priorite: "urgente" };
r = await secr("POST", "/api/commandes", { ...base, dateMail: "2026-02-30", lignes: [{ produitId: croq.id, quantite: 1 }] }); ok(r.status === 400, "date inexistante (30 février) refusée");
r = await secr("POST", "/api/commandes", { ...base, dateLivraisonSouhaitee: "2026-09-01", lignes: [{ produitId: croq.id, quantite: 1 }] }); ok(r.status === 400, "livraison avant la date du mail refusée");
r = await secr("POST", "/api/commandes", { ...base, lignes: [{ produitId: croq.id, quantite: 50 }, { produitId: croq.id, quantite: 50 }] }); ok(r.status === 400, "même produit sur deux lignes refusé");
r = await secr("POST", "/api/commandes", { ...base, lignes: [{ produitId: croq.id, quantite: 10 }, { produitId: barf.id, quantite: 2 }] });
ok(r.status === 201 && r.data.statut === "brouillon" && r.data.numero === 1, "brouillon créé n° 1 (les essais refusés ne consomment pas de numéro)");
const cmd = r.data;
r = await secr("POST", `/api/commandes/${cmd.id}/envoyer`);
ok(r.status === 409 && r.data.blocages.some((b) => b.includes("Fiche de préparation manquante")), "envoi bloqué : fiche manquante");
r = await secr("PUT", `/api/commandes/${cmd.id}`, { clientId: clients[1].id, note: "x".repeat(1001) }); ok(r.status === 400, "modification invalide refusée…");
r = await secr("GET", "/api/etat"); ok(r.data.commandes.find((c) => c.id === cmd.id).clientId === clients[0].id, "…et rien n'a été modifié à moitié (client inchangé)");
r = await secr("PUT", `/api/commandes/${cmd.id}`, { lignes: [{ produitId: croq.id, quantite: 10 }, { produitId: pate.id, quantite: 5 }] });
ok(r.status === 200 && r.data.etapes.length === 3, "lignes corrigées, circuit à 3 postes");
r = await pick("POST", `/api/commandes/${cmd.id}/envoyer`); ok(r.status === 404, "un préparateur ne voit pas un brouillon (404)");
r = await secr("POST", `/api/commandes/${cmd.id}/envoyer`); ok(r.status === 200 && r.data.statut === "a_preparer", "envoyée → à préparer (poste " + pPick.nom + ")");
r = await secr("GET", "/api/etat"); ok(r.data.produits.find((p) => p.id === croq.id).stock === 70 && r.data.produits.find((p) => p.id === pate.id).stock === 145, "stock réservé dès l'envoi (80→70, 150→145)");
r = await secr("PUT", `/api/commandes/${cmd.id}`, { note: "x" }); ok(r.status === 400, "plus modifiable une fois envoyée");
r = await secr("POST", `/api/commandes/${cmd.id}/renvoyer`, { etape: 2, remarque: "saut" }); ok(r.status === 400, "impossible de renvoyer EN AVANT (sauter Picking et Emballage)");

console.log("5. Tablettes : chaque poste ne voit que son travail, et seulement le nécessaire");
r = await emb("GET", "/api/etat"); ok(r.data.commandes.length === 0 && r.data.clients.length === 0 && r.data.utilisateurs === undefined, "emballage : aucune commande, aucun client, pas la liste du personnel");
r = await pick("GET", "/api/etat"); ok(r.data.commandes.length === 1, "picking voit la commande");
ok(r.data.commandes[0].sourceMail === undefined, "le préparateur ne reçoit pas l'extrait du mail client");
ok(r.data.clients.length === 1 && r.data.clients[0].email === undefined, "le préparateur ne reçoit que le client de ses commandes, sans e-mail");
r = await emb("POST", `/api/commandes/${cmd.id}/prendre`); ok(r.status === 404, "emballage ne peut pas prendre l'étape picking");
r = await pick("POST", `/api/commandes/${cmd.id}/prendre`); ok(r.status === 200 && r.data.statut === "en_preparation" && r.data.sourceMail === undefined, "picking prend la commande (réponse sans le mail)");
r = await admin("POST", `/api/commandes/${cmd.id}/ligne`, { index: 0, fait: true, lot: "ADMIN" }); ok(r.status === 403, "l'admin ne peut pas cocher sous le nom de Karim");
r = await pick("POST", `/api/commandes/${cmd.id}/terminer`); ok(r.status === 409, "impossible de terminer sans tout cocher");
r = await pick("POST", `/api/commandes/${cmd.id}/ligne`, { index: 0, fait: true, lot: "L2409-A", dlc: "2027-03-15" }); ok(r.status === 200 && r.data.lignes[0].lot === "L2409-A", "ligne 1 cochée avec lot + DDM");
r = await pick("POST", `/api/commandes/${cmd.id}/ligne`, { index: 0, fait: true, lot: "L2409-B" }); ok(r.status === 200 && r.data.historique.some((h) => h.texte.includes("L2409-A → L2409-B")), "changement de lot tracé dans l'historique (ancien → nouveau)");
r = await pick("POST", `/api/commandes/${cmd.id}/ligne`, { index: 0, fait: true, dlc: "2027-02-31" }); ok(r.status === 400, "DDM inexistante refusée");
r = await pick("POST", `/api/commandes/${cmd.id}/message`, { texte: "Il ne reste que 9 sacs du lot B, j'en prends 1 du lot C" }); ok(r.status === 200, "message du préparateur");
r = await pick("POST", `/api/commandes/${cmd.id}/ligne`, { index: 1, fait: true, lot: "Y-118" }); ok(r.status === 200, "ligne 2 cochée");
r = await pick("POST", `/api/commandes/${cmd.id}/terminer`, { remarque: "RAS" }); ok(r.status === 200 && r.data.statut === "a_preparer" && r.data.etapeIndex === 1, "picking terminé → transmis à l'emballage");
r = await pick("GET", "/api/etat"); ok(r.data.commandes.length === 1, "picking voit encore la commande (il y a travaillé)");
r = await emb("GET", "/api/etat"); ok(r.data.commandes.length === 1, "emballage voit maintenant la commande");
r = await emb("POST", `/api/commandes/${cmd.id}/prendre`); ok(r.status === 200, "emballage prend");
r = await emb("POST", `/api/commandes/${cmd.id}/rendre`, { remarque: "plus de film étirable" }); ok(r.status === 200 && r.data.statut === "a_preparer", "emballage remet dans la file");
r = await secr("POST", `/api/commandes/${cmd.id}/message`, { texte: "Film livré, vous pouvez reprendre" }); ok(r.status === 200 && r.data.messages.length === 2, "réponse du secrétariat dans le fil");
r = await emb("POST", `/api/commandes/${cmd.id}/prendre`); ok(r.status === 200, "emballage reprend");
await emb("POST", `/api/commandes/${cmd.id}/ligne`, { index: 0, fait: true }); await emb("POST", `/api/commandes/${cmd.id}/ligne`, { index: 1, fait: true });
r = await emb("POST", `/api/commandes/${cmd.id}/terminer`); ok(r.status === 200 && r.data.etapeIndex === 2, "emballage terminé → contrôle");
r = await ctrl("POST", `/api/commandes/${cmd.id}/prendre`); ok(r.status === 200, "contrôle (Marc) prend");
r = await ctrl2("POST", `/api/commandes/${cmd.id}/ligne`, { index: 0, fait: true }); ok(r.status === 403, "un collègue du même poste ne peut pas cocher l'étape de Marc");
r = await ctrl("POST", `/api/commandes/${cmd.id}/expedier`); ok(r.status === 403, "un préparateur ne peut pas expédier");
await ctrl("POST", `/api/commandes/${cmd.id}/ligne`, { index: 0, fait: true }); await ctrl("POST", `/api/commandes/${cmd.id}/ligne`, { index: 1, fait: true });
r = await ctrl("POST", `/api/commandes/${cmd.id}/terminer`); ok(r.status === 200 && r.data.statut === "preparee", "contrôle terminé → retour secrétariat (préparée)");
r = await ctrl2("GET", "/api/etat"); ok(r.data.commandes.length === 0, "Paul (même poste, n'a rien fait) ne voit pas la commande préparée");
r = await ctrl2("POST", `/api/commandes/${cmd.id}/message`, { texte: "curieux" }); ok(r.status === 404, "…ni ne peut y écrire");
r = await secr("GET", "/api/etat"); ok(r.data.produits.find((p) => p.id === croq.id).stock === 70, "stock inchangé à la fin de préparation (déjà réservé)");

console.log("6. Secrétariat : renvoi, expédition, historique");
r = await secr("POST", `/api/commandes/${cmd.id}/renvoyer`, { etape: 2, remarque: "étiquette illisible" }); ok(r.status === 200 && r.data.statut === "a_preparer" && r.data.etapeIndex === 2, "renvoyée au contrôle");
r = await secr("GET", "/api/etat"); ok(r.data.produits.find((p) => p.id === croq.id).stock === 70, "le renvoi garde la réservation de stock");
await ctrl("POST", `/api/commandes/${cmd.id}/prendre`); await ctrl("POST", `/api/commandes/${cmd.id}/ligne`, { index: 0, fait: true }); await ctrl("POST", `/api/commandes/${cmd.id}/ligne`, { index: 1, fait: true });
r = await ctrl("POST", `/api/commandes/${cmd.id}/terminer`); ok(r.data.statut === "preparee", "contrôle refait");
r = await secr("POST", `/api/commandes/${cmd.id}/expedier`, { transporteur: "Geodis", suivi: "https://suivi.example/" + "x".repeat(100) }); ok(r.status === 400, "n° de suivi trop long refusé…");
r = await secr("GET", "/api/etat"); ok(r.data.commandes.find((c) => c.id === cmd.id).statut === "preparee", "…et la commande est restée « préparée » (pas d'expédition fantôme)");
r = await secr("POST", `/api/commandes/${cmd.id}/expedier`, { transporteur: "Geodis", suivi: "GE123456" }); ok(r.status === 200 && r.data.statut === "expediee", "expédiée");
r = await secr("POST", `/api/commandes/${cmd.id}/message`, { texte: "x" }); ok(r.status === 400, "fil fermé sur une commande close");
console.log("  historique de la commande n° 1 :");
r = await secr("GET", "/api/etat");
const fin = r.data.commandes.find((c) => c.id === cmd.id);
console.log("     " + fin.historique.map((x) => (x.poste ? "[" + x.poste + "] " : "") + x.qui + " — " + x.texte).join("\n     "));

console.log("7. Stock, renvois, suppressions, réaffectations");
// deux commandes sur le même stock limité (BARF : 8)
r = await admin("PUT", `/api/produits/${barf.id}`, { preparation: { instructions: "Congélateur S1, gants.", parPoste: { [pPick.id]: "S1", [pEmb.id]: "Caisse isotherme + carboglace", [pCtrl.id]: "T° < −18 °C" } } });
ok(r.status === 200 && r.data.stock === 8, "fiche BARF complétée");
const c1 = (await secr("POST", "/api/commandes", { ...base, lignes: [{ produitId: barf.id, quantite: 8 }] })).data;
const c2 = (await secr("POST", "/api/commandes", { ...base, lignes: [{ produitId: barf.id, quantite: 8 }] })).data;
ok(c1.numero === 2 && c2.numero === 3, "numérotation continue (2, 3)");
r = await secr("POST", `/api/commandes/${c1.id}/envoyer`); ok(r.status === 200, "1re commande de 8 BARF envoyée");
r = await secr("POST", `/api/commandes/${c2.id}/envoyer`); ok(r.status === 409 && r.data.blocages.some((b) => b.includes("insuffisant")), "2e commande de 8 BARF bloquée : stock déjà réservé");
r = await secr("POST", `/api/commandes/${c1.id}/rappeler`); ok(r.status === 200, "1re commande rappelée…");
r = await secr("GET", "/api/etat"); ok(r.data.produits.find((p) => p.id === barf.id).stock === 8, "…et son stock libéré");
r = await secr("DELETE", `/api/commandes/${c1.id}`); ok(r.status === 400, "une commande déjà passée en préparation ne peut pas être supprimée (seulement annulée)");
r = await secr("DELETE", `/api/commandes/${c2.id}`); ok(r.status === 200, "un brouillon jamais envoyé peut être supprimé");
r = await secr("POST", `/api/commandes/${c1.id}/envoyer`); ok(r.status === 200, "1re commande renvoyée en préparation");
r = await pick("POST", `/api/commandes/${c1.id}/prendre`); ok(r.status === 200, "Karim prend le picking");
r = await secr("POST", `/api/commandes/${c1.id}/renvoyer`, { etape: 0, remarque: "quantité à revoir" }); ok(r.status === 200, "renvoi à l'étape en cours…");
ok(r.data.etapes[0].statut === "a_faire" && !r.data.etapes[0].preparateurId, "…l'étape de Karim est bien réinitialisée (pas d'étape orpheline)");
r = await pick("POST", `/api/commandes/${c1.id}/prendre`); ok(r.status === 200, "Karim reprend");
r = await admin("PUT", `/api/utilisateurs/${karim.id}`, { postes: [pEmb.id] }); ok(r.status === 200, "l'admin réaffecte Karim à l'emballage…");
r = await secr("GET", "/api/etat"); const c1b = r.data.commandes.find((c) => c.id === c1.id);
ok(c1b.statut === "a_preparer" && c1b.etapes[0].statut === "a_faire" && c1b.historique.some((h) => h.texte.includes("Étape reprise à Karim")), "…son étape de picking est automatiquement remise dans la file et tracée");
await admin("PUT", `/api/utilisateurs/${karim.id}`, { postes: [pPick.id] });
r = await secr("POST", `/api/commandes/${c1.id}/annuler`, { remarque: "client a annulé" }); ok(r.status === 200 && r.data.statut === "annulee", "annulation");
r = await secr("GET", "/api/etat"); ok(r.data.produits.find((p) => p.id === barf.id).stock === 8, "annulation → stock libéré");
r = await secr("PUT", `/api/produits/${croq.id}`, { nom: "Nom modifié", stock: -1 }); ok(r.status === 400, "fiche produit invalide refusée…");
r = await secr("GET", "/api/etat"); ok(r.data.produits.find((p) => p.id === croq.id).nom === croq.nom, "…sans modification partielle du nom");
r = await secr("PUT", `/api/produits/${croq.id}`, { preparation: "texte" }); ok(r.status === 400, "format de fiche invalide → 400 (pas 500)");

console.log("8. Audit, verrouillages");
r = await secr("GET", "/api/audit"); ok(r.status === 403, "le secrétariat n'a pas accès à l'audit");
r = await admin("GET", "/api/audit");
ok(r.status === 200 && r.data.some((l) => l.action === "commande.expedier" && l.details.suivi === "GE123456"), "audit : expédition avec transporteur / suivi");
ok(r.data.some((l) => l.action === "commande.ligne" && l.details.ancienLot === "L2409-A" && l.details.lot === "L2409-B"), "audit : changement de lot (ancien / nouveau)");
ok(r.data.some((l) => l.action === "commande.envoyer" && Array.isArray(l.details.stock)), "audit : mouvements de stock");
const s2 = session();
await s2("POST", "/api/connexion", { login: "sophie", mdp: "MonMdpPerso2026" });
for (let i = 0; i < 4; i++) await s2("POST", "/api/moi/motdepasse", { ancien: "faux" + i, nouveau: "Nouveau2026xx" });
r = await s2("POST", "/api/moi/motdepasse", { ancien: "faux5", nouveau: "Nouveau2026xx" }); ok(r.status === 400, "5e mauvais « ancien mot de passe »…");
r = await s2("GET", "/api/etat"); ok(r.status === 401, "…session coupée (pas de force brute depuis une session ouverte)");
r = await admin("PUT", `/api/utilisateurs/${marc.id}`, { actif: false }); ok(r.status === 200, "admin désactive Marc");
r = await ctrl("GET", "/api/etat"); ok(r.status === 401, "session de Marc coupée immédiatement");

console.log("9. Anti-force-brute derrière un reverse proxy (TRUST_PROXY)");
{
  const dir = mkdtempSync(join(tmpdir(), "nutrilog-px-"));
  const srv = await demarrer(3998, { TRUST_PROXY: "1", ADMIN_PASSWORD: "AdminInitial123" }, dir);
  const depuis = (ip) => session("http://127.0.0.1:3998", { "X-Forwarded-For": "6.6.6.6, " + ip });
  const a = depuis("10.0.0.1");
  for (let i = 0; i < 5; i++) await a("POST", "/api/connexion", { login: "admin", mdp: "faux" + i });
  r = await a("POST", "/api/connexion", { login: "admin", mdp: "AdminInitial123" }); ok(r.status === 429, "poste 10.0.0.1 bloqué après 5 échecs");
  r = await depuis("10.0.0.2")("POST", "/api/connexion", { login: "admin", mdp: "AdminInitial123" }); ok(r.status === 200, "l'admin se connecte depuis un autre poste : un tiers ne peut pas verrouiller son compte");
  const auditAvant = readFileSync(join(dir, "audit.log"), "utf8").trim().split("\n").length;
  for (let i = 0; i < 40; i++) await a("POST", "/api/connexion", { login: "admin", mdp: "x" });
  const auditApres = readFileSync(join(dir, "audit.log"), "utf8").trim().split("\n").length;
  ok(auditApres === auditAvant, `les 40 tentatives refusées pendant le blocage n'inondent pas le journal (${auditAvant} → ${auditApres} lignes)`);
  ok(readFileSync(join(dir, "audit.log"), "utf8").includes('"ip":"10.0.0.1"'), "l'audit enregistre l'adresse réelle du poste, pas celle du proxy");
  for (let i = 0; i < 20; i++) await depuis("10.1.0." + i)("POST", "/api/connexion", { login: "admin", mdp: "faux" });
  r = await depuis("10.0.0.3")("POST", "/api/connexion", { login: "admin", mdp: "AdminInitial123" }); ok(r.status === 429, "20 échecs sur un compte depuis de nombreux postes → compte bloqué");
  srv.p.kill(); await srv.fin;
  const refus = await demarrer(3997, { TRUST_PROXY: "1", HOST: "0.0.0.0" }, dir);
  ok((await refus.fin) === 1 && refus.sortie().includes("HOST=127.0.0.1"), "TRUST_PROXY refusé si le serveur écoute sur tout le réseau");
  rmSync(dir, { recursive: true, force: true });
}

console.log("10. Inactivité : le rafraîchissement automatique ne maintient pas la session");
{
  const dir = mkdtempSync(join(tmpdir(), "nutrilog-in-"));
  const srv = await demarrer(3996, { ADMIN_PASSWORD: "AdminInitial123", SESSION_INACTIVITE_MIN: "0.05" }, dir); // 3 s
  const s = session("http://127.0.0.1:3996");
  await s("POST", "/api/connexion", { login: "admin", mdp: "AdminInitial123" });
  await s("POST", "/api/moi/motdepasse", { ancien: "AdminInitial123", nouveau: "AdminSecurise2026" });
  for (let i = 0; i < 4; i++) { await attendre(1000); await s("GET", "/api/etat"); }
  r = await s("GET", "/api/etat"); ok(r.status === 401, "tablette oubliée : déconnectée après le délai malgré le rafraîchissement toutes les secondes");
  srv.p.kill(); await srv.fin;
  rmSync(dir, { recursive: true, force: true });
}

console.log("11. Démarrage : base corrompue, récupération du compte admin");
{
  const dir = mkdtempSync(join(tmpdir(), "nutrilog-db-"));
  writeFileSync(join(dir, "db.json"), '{"utilisateurs": [ {"login": "sophie"');
  const srv = await demarrer(3995, { ADMIN_PASSWORD: "AdminInitial123" }, dir);
  ok((await srv.fin) === 1, "db.json corrompu → le serveur refuse de démarrer…");
  ok(readFileSync(join(dir, "db.json"), "utf8").startsWith('{"utilisateurs": [ {"login": "sophie"'), "…sans écraser le fichier");
  ok(readdirSync(dir).some((f) => f.startsWith("db.json.illisible-")), "…et en garde une copie");
  rmSync(dir, { recursive: true, force: true });

  const dir2 = mkdtempSync(join(tmpdir(), "nutrilog-rs-"));
  let s = await demarrer(3994, { ADMIN_PASSWORD: "AdminInitial123" }, dir2); s.p.kill(); await s.fin;
  s = await demarrer(3994, { ADMIN_RESET_PASSWORD: "Secours2026admin" }, dir2);
  const a = session("http://127.0.0.1:3994");
  r = await a("POST", "/api/connexion", { login: "admin", mdp: "Secours2026admin" }); ok(r.status === 200 && r.data.moi.doitChangerMdp, "ADMIN_RESET_PASSWORD : admin récupéré, mdp à changer");
  ok(readFileSync(join(dir2, "audit.log"), "utf8").includes("admin.reinitialise"), "réinitialisation tracée dans l'audit");
  s.p.kill(); await s.fin;
  rmSync(dir2, { recursive: true, force: true });
}

console.log(echecs ? `\n${echecs} ÉCHEC(S)` : "\nTOUT EST OK");
process.exit(echecs ? 1 : 0);
