/* ============================================================
   NutriLog — serveur (Node.js ≥ 18, sans dépendance externe)
   ------------------------------------------------------------
   Lancer :  node server.js
   Variables d'environnement (toutes optionnelles) :
     PORT            port d'écoute (3000)
     HOST            adresse d'écoute (0.0.0.0 = accessible aux tablettes du réseau)
     ADMIN_PASSWORD  mot de passe du compte « admin » créé au 1er lancement
     TLS_KEY / TLS_CERT  chemins vers la clé et le certificat → serveur HTTPS
     DATA_DIR        dossier des données (./data)

   Circuit d'une commande :
     Secrétariat (mail client → saisie)  →  contrôle (fiches, stock)
       →  Poste 1 (ex. Picking)  →  Poste 2 (ex. Emballage)  →  Poste 3 (ex. Contrôle)
       →  retour Secrétariat  →  expédition
   Chaque poste ne voit que ce qui l'attend, avec ses propres instructions.

   Sécurité intégrée :
     - un compte par personne, mots de passe hachés (scrypt + sel)
     - sessions aléatoires, cookie HttpOnly + SameSite=Strict (+ Secure en HTTPS)
     - rôles et postes vérifiés côté serveur pour chaque action
     - limitation des tentatives de connexion (par IP et par compte)
     - protection CSRF (Origin + en-tête personnalisé + SameSite)
     - en-têtes de sécurité (CSP, X-Frame-Options, HSTS, nosniff…)
     - validation stricte des entrées, écriture atomique des données
     - journal d'audit en ajout seul (data/audit.log) + historique par commande
   ============================================================ */

"use strict";

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
const DB_FILE = path.join(DATA_DIR, "db.json");
const AUDIT_FILE = path.join(DATA_DIR, "audit.log");
const PUBLIC = path.join(__dirname, "public");
const TLS = process.env.TLS_KEY && process.env.TLS_CERT ? { key: fs.readFileSync(process.env.TLS_KEY), cert: fs.readFileSync(process.env.TLS_CERT) } : null;

const SESSION_INACTIVITE_MS = 8 * 60 * 60 * 1000;   // déconnexion après 8 h sans activité
const SESSION_MAX_MS = 24 * 60 * 60 * 1000;         // reconnexion obligatoire toutes les 24 h
const MDP_MIN = 12;                                  // longueur minimale des mots de passe
const TENTATIVES_MAX = 5;                            // échecs de connexion avant blocage
const BLOCAGE_MS = 15 * 60 * 1000;                   // durée du blocage

const ROLES = ["admin", "secretariat", "preparateur"];
const STATUTS = ["brouillon", "a_preparer", "en_preparation", "preparee", "expediee", "annulee"];
const CLOS = ["expediee", "annulee"];
const CONSERVATIONS = ["ambiant", "frais", "surgele"]; // chaîne du froid

/* =====================================================================
   1. Base de données (fichier JSON, écriture atomique)
   ===================================================================== */
let dbCache = null;
function lireDb() {
  if (dbCache) return dbCache;
  try {
    dbCache = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch (e) {
    dbCache = donneesInitiales();
    ecrireDb(dbCache);
  }
  return dbCache;
}

function ecrireDb(db) {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, DB_FILE); // atomique : jamais de fichier à moitié écrit
}

function id() {
  return crypto.randomBytes(9).toString("base64url");
}

/* =====================================================================
   2. Mots de passe & sessions
   ===================================================================== */
function hacherMdp(mdp) {
  const sel = crypto.randomBytes(16);
  const hash = crypto.scryptSync(mdp, sel, 64, { N: 16384, r: 8, p: 1 });
  return sel.toString("hex") + ":" + hash.toString("hex");
}

function verifierMdp(mdp, stocke) {
  if (typeof stocke !== "string" || !stocke.includes(":")) return false;
  const [selHex, hashHex] = stocke.split(":");
  const attendu = Buffer.from(hashHex, "hex");
  const calcule = crypto.scryptSync(mdp, Buffer.from(selHex, "hex"), attendu.length, { N: 16384, r: 8, p: 1 });
  return attendu.length === calcule.length && crypto.timingSafeEqual(attendu, calcule);
}

function mdpValide(mdp) {
  return typeof mdp === "string" && mdp.length >= MDP_MIN && mdp.length <= 128 && /[a-zà-ÿ]/i.test(mdp) && /\d/.test(mdp);
}
const MSG_MDP = `Mot de passe : ${MDP_MIN} caractères minimum, avec au moins une lettre et un chiffre.`;

const sessions = new Map(); // jeton → { utilisateurId, creeLe, vuLe }

function creerSession(utilisateurId) {
  const jeton = crypto.randomBytes(32).toString("base64url");
  const t = Date.now();
  sessions.set(jeton, { utilisateurId, creeLe: t, vuLe: t });
  return jeton;
}

function sessionDepuisRequete(req, db) {
  const cookie = (req.headers.cookie || "").split(";").map((s) => s.trim()).find((s) => s.startsWith("nutrilog="));
  if (!cookie) return null;
  const jeton = cookie.slice("nutrilog=".length);
  const s = sessions.get(jeton);
  if (!s) return null;
  const t = Date.now();
  if (t - s.creeLe > SESSION_MAX_MS || t - s.vuLe > SESSION_INACTIVITE_MS) { sessions.delete(jeton); return null; }
  const u = db.utilisateurs.find((x) => x.id === s.utilisateurId);
  if (!u || !u.actif) { sessions.delete(jeton); return null; }
  s.vuLe = t;
  return { jeton, utilisateur: u };
}

function fermerSessionsDe(utilisateurId) {
  for (const [j, s] of sessions) if (s.utilisateurId === utilisateurId) sessions.delete(j);
}

setInterval(() => { // nettoyage périodique des sessions expirées
  const t = Date.now();
  for (const [j, s] of sessions) if (t - s.creeLe > SESSION_MAX_MS || t - s.vuLe > SESSION_INACTIVITE_MS) sessions.delete(j);
}, 10 * 60 * 1000).unref();

/* --- Limitation des tentatives de connexion --- */
const tentatives = new Map(); // clé (ip ou compte) → { echecs, jusqua }
function bloque(cle) {
  const t = tentatives.get(cle);
  if (!t) return false;
  if (t.jusqua && t.jusqua > Date.now()) return true;
  if (t.jusqua && t.jusqua <= Date.now()) tentatives.delete(cle);
  return false;
}
function echec(cle) {
  const t = tentatives.get(cle) || { echecs: 0, jusqua: 0 };
  t.echecs++;
  if (t.echecs >= TENTATIVES_MAX) { t.jusqua = Date.now() + BLOCAGE_MS; t.echecs = 0; }
  tentatives.set(cle, t);
}
function succes(cle) { tentatives.delete(cle); }

/* =====================================================================
   3. Journal d'audit (ajout seul)
   ===================================================================== */
function audit(req, utilisateur, action, details) {
  const ligne = JSON.stringify({
    date: new Date().toISOString(),
    utilisateur: utilisateur ? utilisateur.login : "-",
    role: utilisateur ? utilisateur.role : "-",
    ip: ipDe(req),
    action,
    details: details || {},
  });
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  fs.appendFileSync(AUDIT_FILE, ligne + "\n", { mode: 0o600 });
}

function lireAudit(max) {
  try {
    const lignes = fs.readFileSync(AUDIT_FILE, "utf8").trim().split("\n");
    return lignes.slice(-max).reverse().map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  } catch (e) { return []; }
}

function ipDe(req) {
  return (req.socket && req.socket.remoteAddress) || "?";
}

/* =====================================================================
   4. Données initiales (1er lancement)
   ===================================================================== */
function donneesInitiales() {
  const db = { utilisateurs: [], postes: [], produits: [], clients: [], commandes: [], prochainNumero: 1 };
  const mdpAdmin = process.env.ADMIN_PASSWORD || crypto.randomBytes(12).toString("base64url");
  db.utilisateurs.push({
    id: id(), login: "admin", nom: "Administrateur", role: "admin", postes: [], actif: true,
    mdp: hacherMdp(mdpAdmin), doitChangerMdp: true, creeLe: new Date().toISOString(),
  });
  console.log("\n==========================================================");
  console.log("  PREMIER LANCEMENT — compte administrateur créé");
  console.log("  identifiant : admin");
  console.log("  mot de passe : " + mdpAdmin);
  console.log("  (à changer dès la première connexion — il ne sera plus affiché)");
  console.log("==========================================================\n");

  /* Postes de préparation, dans l'ordre du circuit. Modifiables par l'admin. */
  const picking = { id: id(), nom: "Picking", description: "Aller chercher les produits en rayon / réserve." };
  const emballage = { id: id(), nom: "Emballage", description: "Conditionner, protéger, fermer les colis." };
  const controle = { id: id(), nom: "Contrôle", description: "Vérifier le contenu et l'étiquetage avant retour au secrétariat." };
  db.postes = [picking, emballage, controle];

  db.produits = [
    {
      id: id(), nom: "Lait demi-écrémé 1 L (pack de 6)", reference: "LAIT-DE-6", unite: "pack", stock: 80, emplacement: "A1", conservation: "ambiant", dlcJours: 60,
      preparation: {
        instructions: "Vérifier la DLC (au moins 15 jours restants). Packs intacts, sans fuite.",
        conditionnement: "Sur palette ou carton renforcé, 4 packs max par carton",
        vigilance: "Lourd : ne pas empiler plus de 3 cartons.",
        dureeMin: 2,
        parPoste: { [picking.id]: "Allée A1, palette du bas. Prendre les DLC les plus courtes en premier (FIFO).", [emballage.id]: "Carton renforcé, cornières.", [controle.id]: "Compter les packs, vérifier la DLC notée sur le bon." },
      },
    },
    {
      id: id(), nom: "Yaourts nature (×12)", reference: "YAO-NAT-12", unite: "carton", stock: 150, emplacement: "F2 (chambre froide)", conservation: "frais", dlcJours: 21,
      preparation: {
        instructions: "Produit frais : rester sous 4 °C. Sortir de la chambre froide au dernier moment.",
        conditionnement: "Caisse isotherme + pain de glace",
        vigilance: "CHAÎNE DU FROID — pas plus de 10 min hors chambre froide.",
        dureeMin: 3,
        parPoste: { [picking.id]: "Chambre froide F2, étagère 3. Noter le numéro de lot.", [emballage.id]: "Caisse isotherme, 2 pains de glace, fermer immédiatement.", [controle.id]: "Température de la caisse < 4 °C, lot reporté sur le bon." },
      },
    },
    {
      id: id(), nom: "Filets de poulet surgelés 2,5 kg", reference: "POU-SUR-25", unite: "sachet", stock: 8, emplacement: "S1 (congélateur)", conservation: "surgele", dlcJours: 365,
      preparation: { instructions: "", conditionnement: "", vigilance: "", dureeMin: 0, parPoste: {} },
    },
  ];
  db.clients = [
    { id: id(), nom: "Cantine scolaire Jules-Ferry", email: "cantine@ecole-julesferry.fr", adresse: "12 rue des Lilas, 69003 Lyon", telephone: "04 72 00 00 00" },
    { id: id(), nom: "Restaurant Le Potager", email: "commande@lepotager.fr", adresse: "3 place de la Mairie, 38000 Grenoble", telephone: "04 76 00 00 00" },
  ];
  return db;
}

/* =====================================================================
   5. Validation des entrées
   ===================================================================== */
class ErreurHttp extends Error { constructor(code, message, extra) { super(message); this.code = code; this.extra = extra; } }

function texte(v, max, obligatoire) {
  if (v === undefined || v === null) v = "";
  if (typeof v !== "string") throw new ErreurHttp(400, "Champ texte invalide.");
  v = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
  if (v.length > max) throw new ErreurHttp(400, `Texte trop long (max ${max} caractères).`);
  if (obligatoire && !v) throw new ErreurHttp(400, "Champ obligatoire manquant.");
  return v;
}
function entier(v, min, max) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new ErreurHttp(400, `Nombre invalide (entre ${min} et ${max}).`);
  return n;
}
function choix(v, liste) {
  if (!liste.includes(v)) throw new ErreurHttp(400, "Valeur non autorisée.");
  return v;
}
function dateIso(v) {
  v = texte(v, 10, false);
  if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new ErreurHttp(400, "Date invalide (AAAA-MM-JJ).");
  return v;
}
function loginValide(v) {
  v = texte(v, 40, true).toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(v)) throw new ErreurHttp(400, "Identifiant : 3 à 40 caractères (lettres, chiffres, . _ -).");
  return v;
}
function listePostes(db, v) {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > 20) throw new ErreurHttp(400, "Liste de postes invalide.");
  const ids = [...new Set(v.map((x) => texte(x, 40, true)))];
  ids.forEach((pid) => { if (!db.postes.find((p) => p.id === pid)) throw new ErreurHttp(400, "Poste inconnu."); });
  return ids;
}

function validerProduit(db, corps, existant) {
  const p = existant || { id: id(), preparation: { parPoste: {} } };
  if ("nom" in corps || !existant) p.nom = texte(corps.nom, 120, true);
  if ("reference" in corps || !existant) p.reference = texte(corps.reference, 40, false);
  if ("unite" in corps || !existant) p.unite = texte(corps.unite, 20, false) || "unité";
  if ("stock" in corps || !existant) p.stock = entier(corps.stock ?? 0, 0, 1e7);
  if ("emplacement" in corps || !existant) p.emplacement = texte(corps.emplacement, 40, false);
  if ("conservation" in corps || !existant) p.conservation = choix(corps.conservation || "ambiant", CONSERVATIONS);
  if ("dlcJours" in corps || !existant) p.dlcJours = entier(corps.dlcJours ?? 0, 0, 3650);
  const pr = corps.preparation || {};
  const anc = p.preparation || {};
  const parPoste = { ...(anc.parPoste || {}) };
  if (pr.parPoste && typeof pr.parPoste === "object") {
    Object.keys(pr.parPoste).forEach((pid) => {
      if (!db.postes.find((x) => x.id === pid)) throw new ErreurHttp(400, "Poste inconnu dans la fiche.");
      parPoste[pid] = texte(pr.parPoste[pid], 1000, false);
    });
  }
  p.preparation = {
    instructions: "instructions" in pr ? texte(pr.instructions, 2000, false) : anc.instructions || "",
    conditionnement: "conditionnement" in pr ? texte(pr.conditionnement, 300, false) : anc.conditionnement || "",
    vigilance: "vigilance" in pr ? texte(pr.vigilance, 500, false) : anc.vigilance || "",
    dureeMin: "dureeMin" in pr ? entier(pr.dureeMin ?? 0, 0, 600) : anc.dureeMin || 0,
    parPoste,
  };
  return p;
}

function validerClient(corps, existant) {
  const c = existant || { id: id() };
  if ("nom" in corps || !existant) c.nom = texte(corps.nom, 120, true);
  if ("email" in corps || !existant) {
    c.email = texte(corps.email, 120, false);
    if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) throw new ErreurHttp(400, "E-mail invalide.");
  }
  if ("adresse" in corps || !existant) c.adresse = texte(corps.adresse, 300, false);
  if ("telephone" in corps || !existant) c.telephone = texte(corps.telephone, 30, false);
  return c;
}

function validerLignes(db, lignes) {
  if (!Array.isArray(lignes) || lignes.length > 200) throw new ErreurHttp(400, "Lignes invalides.");
  return lignes.map((l) => {
    const produitId = texte(l && l.produitId, 40, true);
    if (!db.produits.find((p) => p.id === produitId)) throw new ErreurHttp(400, "Produit inconnu.");
    return { produitId, quantite: entier(l.quantite, 1, 1e6) };
  });
}

/* Étapes = postes par lesquels la commande doit passer, dans l'ordre */
function construireEtapes(db, posteIds, nbLignes) {
  const ids = listePostes(db, posteIds === undefined ? db.postes.map((p) => p.id) : posteIds);
  if (!ids.length) throw new ErreurHttp(400, "La commande doit passer par au moins un poste.");
  return ids.map((posteId) => ({ posteId, statut: "a_faire", preparateur: "", preparateurId: "", debut: "", fin: "", remarque: "", coches: Array(nbLignes).fill(false) }));
}

/* =====================================================================
   6. Règles métier
   ===================================================================== */
function ficheComplete(p, posteIds) {
  if (!p || !p.preparation || !p.preparation.instructions || !p.preparation.instructions.trim()) return false;
  return true;
}

/* Ce qui empêche l'envoi d'une commande aux préparateurs */
function blocages(db, cmd) {
  const b = [];
  if (!cmd.clientId || !db.clients.find((c) => c.id === cmd.clientId)) b.push("Aucun client associé.");
  if (!cmd.lignes.length) b.push("La commande ne contient aucun produit.");
  if (!cmd.etapes || !cmd.etapes.length) b.push("Aucun poste de préparation sélectionné.");
  cmd.lignes.forEach((l) => {
    const p = db.produits.find((x) => x.id === l.produitId);
    if (!p) { b.push("Produit inconnu sur une ligne."); return; }
    if (!ficheComplete(p)) b.push(`Fiche de préparation manquante : « ${p.nom} ».`);
    (cmd.etapes || []).forEach((e) => {
      const poste = db.postes.find((x) => x.id === e.posteId);
      if (poste && !(p.preparation.parPoste && p.preparation.parPoste[e.posteId] && p.preparation.parPoste[e.posteId].trim()))
        b.push(`« ${p.nom} » : pas d'instruction pour le poste ${poste.nom}.`);
    });
    if (p.stock < l.quantite) b.push(`Stock insuffisant pour « ${p.nom} » (${p.stock} ${p.unite} en stock, ${l.quantite} demandés).`);
  });
  (cmd.etapes || []).forEach((e) => {
    const poste = db.postes.find((x) => x.id === e.posteId);
    if (!poste) { b.push("Poste inconnu dans le circuit."); return; }
    if (!db.utilisateurs.some((u) => u.actif && u.role === "preparateur" && (u.postes || []).includes(e.posteId)))
      b.push(`Aucun préparateur actif n'est affecté au poste ${poste.nom}.`);
  });
  return b;
}

function etapeCourante(cmd) {
  return cmd.etapes && cmd.etapes[cmd.etapeIndex] ? cmd.etapes[cmd.etapeIndex] : null;
}

function journal(cmd, utilisateur, texteJournal, posteNom) {
  cmd.historique.push({ date: new Date().toISOString(), qui: utilisateur ? utilisateur.nom : "—", poste: posteNom || "", texte: texteJournal });
}

function nomPoste(db, posteId) {
  const p = db.postes.find((x) => x.id === posteId);
  return p ? p.nom : "?";
}

/* Vue des données adaptée au rôle (on n'envoie jamais plus que nécessaire) */
function vuePourRole(db, u) {
  const base = { moi: utilisateurPublic(u), postes: db.postes, produits: db.produits, derniereMaj: db.derniereMaj || null };
  if (u.role === "preparateur") {
    const mesPostes = u.postes || [];
    return {
      ...base,
      clients: db.clients.map((c) => ({ id: c.id, nom: c.nom, adresse: c.adresse })),
      commandes: db.commandes.filter((c) => {
        if (CLOS.includes(c.statut) || c.statut === "brouillon") return false;
        const e = etapeCourante(c);
        const posteCourantAMoi = e && mesPostes.includes(e.posteId);
        const jyAiTravaille = (c.etapes || []).some((x) => x.preparateurId === u.id);
        return posteCourantAMoi || jyAiTravaille;
      }),
      utilisateurs: db.utilisateurs.filter((x) => x.actif).map((x) => ({ id: x.id, nom: x.nom, role: x.role, postes: x.postes || [] })),
    };
  }
  const vue = { ...base, clients: db.clients, commandes: db.commandes };
  vue.utilisateurs = u.role === "admin" ? db.utilisateurs.map(utilisateurPublic) : db.utilisateurs.filter((x) => x.actif).map((x) => ({ id: x.id, nom: x.nom, role: x.role, postes: x.postes || [] }));
  return vue;
}

function utilisateurPublic(u) {
  return { id: u.id, login: u.login, nom: u.nom, role: u.role, postes: u.postes || [], actif: u.actif, doitChangerMdp: !!u.doitChangerMdp, creeLe: u.creeLe };
}

/* =====================================================================
   7. HTTP : utilitaires, en-têtes de sécurité, statique
   ===================================================================== */
function entetesSecurite(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  if (TLS) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
}

function json(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function lireCorps(req) {
  return new Promise((resolve, reject) => {
    let s = "";
    req.on("data", (c) => { s += c; if (s.length > 512 * 1024) { reject(new ErreurHttp(413, "Requête trop volumineuse.")); req.destroy(); } });
    req.on("end", () => {
      if (!s) return resolve({});
      try { const v = JSON.parse(s); resolve(v && typeof v === "object" && !Array.isArray(v) ? v : {}); }
      catch (e) { reject(new ErreurHttp(400, "JSON invalide.")); }
    });
    req.on("error", reject);
  });
}

function cookieSession(jeton, expirer) {
  const parts = [`nutrilog=${expirer ? "" : jeton}`, "Path=/", "HttpOnly", "SameSite=Strict"];
  if (TLS) parts.push("Secure");
  parts.push(expirer ? "Max-Age=0" : `Max-Age=${Math.floor(SESSION_MAX_MS / 1000)}`);
  return parts.join("; ");
}

/* Anti-CSRF : toute requête modifiante doit venir de notre propre page */
function verifierCsrf(req) {
  if (req.method === "GET") return;
  if (req.headers["x-requested-with"] !== "NutriLog") throw new ErreurHttp(403, "Requête refusée (CSRF).");
  const origine = req.headers.origin || (req.headers.referer ? new URL(req.headers.referer).origin : "");
  if (origine) {
    const hote = req.headers.host || "";
    if (new URL(origine).host !== hote) throw new ErreurHttp(403, "Origine non autorisée.");
  }
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };

function statique(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { erreur: "Méthode non autorisée" });
  let fichier;
  try { fichier = decodeURIComponent(req.url.split("?")[0]); } catch (e) { return json(res, 400, { erreur: "URL invalide" }); }
  if (fichier === "/") fichier = "/index.html";
  const abs = path.normalize(path.join(PUBLIC, fichier));
  if (!abs.startsWith(PUBLIC + path.sep)) return json(res, 403, { erreur: "Interdit" });
  fs.readFile(abs, (err, data) => {
    if (err) return json(res, 404, { erreur: "Introuvable" });
    res.writeHead(200, { "Content-Type": MIME[path.extname(abs)] || "application/octet-stream" });
    res.end(data);
  });
}

/* =====================================================================
   8. API
   ===================================================================== */
function exiger(u, ...roles) {
  if (!roles.includes(u.role)) throw new ErreurHttp(403, "Action non autorisée pour votre rôle.");
}

/* Le préparateur connecté a-t-il le droit d'agir sur l'étape courante ? */
function etapePour(db, cmd, moi, doitEtreEnCours) {
  const e = etapeCourante(cmd);
  if (!e) throw new ErreurHttp(400, "Aucune étape en cours sur cette commande.");
  if (moi.role !== "admin" && !(moi.postes || []).includes(e.posteId)) throw new ErreurHttp(403, `Cette étape relève du poste ${nomPoste(db, e.posteId)}, pas du vôtre.`);
  if (doitEtreEnCours) {
    if (e.statut !== "en_cours" || cmd.statut !== "en_preparation") throw new ErreurHttp(400, "L'étape n'est pas en cours.");
    if (e.preparateurId !== moi.id && moi.role !== "admin") throw new ErreurHttp(403, `Cette étape est en cours par ${e.preparateur}.`);
  }
  return e;
}

async function api(req, res, route) {
  const db = lireDb();
  const segments = route.split("/").filter(Boolean); // ["commandes", ":id", "envoyer"]
  const [ressource, idRes, action] = segments;
  verifierCsrf(req);
  const corps = req.method === "GET" ? {} : await lireCorps(req);
  const sauver = () => { db.derniereMaj = new Date().toISOString(); ecrireDb(db); };

  /* ---------- Connexion (sans session) ---------- */
  if (ressource === "connexion" && req.method === "POST") {
    const ip = ipDe(req);
    const login = texte(corps.login, 40, false).toLowerCase();
    const mdp = typeof corps.mdp === "string" ? corps.mdp.slice(0, 128) : "";
    if (bloque("ip:" + ip) || bloque("login:" + login)) {
      audit(req, null, "connexion.bloquee", { login });
      throw new ErreurHttp(429, "Trop de tentatives. Réessayez dans 15 minutes.");
    }
    const u = db.utilisateurs.find((x) => x.login === login);
    // On calcule toujours un hachage pour ne pas révéler si le compte existe (temps constant)
    const ok = u ? verifierMdp(mdp, u.mdp) : (verifierMdp(mdp, hacherMdp("x")), false);
    if (!ok || !u.actif) {
      echec("ip:" + ip); echec("login:" + login);
      audit(req, null, "connexion.echec", { login });
      throw new ErreurHttp(401, "Identifiant ou mot de passe incorrect.");
    }
    succes("ip:" + ip); succes("login:" + login);
    const jeton = creerSession(u.id);
    audit(req, u, "connexion.ok");
    res.setHeader("Set-Cookie", cookieSession(jeton));
    return json(res, 200, { moi: utilisateurPublic(u) });
  }

  /* ---------- Tout le reste exige une session valide ---------- */
  const session = sessionDepuisRequete(req, db);
  if (!session) throw new ErreurHttp(401, "Connexion requise.");
  const moi = session.utilisateur;

  if (ressource === "deconnexion" && req.method === "POST") {
    sessions.delete(session.jeton);
    audit(req, moi, "deconnexion");
    res.setHeader("Set-Cookie", cookieSession("", true));
    return json(res, 200, { ok: true });
  }

  if (ressource === "moi") {
    if (req.method === "GET") return json(res, 200, { moi: utilisateurPublic(moi) });
    if (req.method === "POST" && idRes === "motdepasse") {
      if (!verifierMdp(typeof corps.ancien === "string" ? corps.ancien : "", moi.mdp)) throw new ErreurHttp(400, "Ancien mot de passe incorrect.");
      if (!mdpValide(corps.nouveau)) throw new ErreurHttp(400, MSG_MDP);
      if (corps.nouveau === corps.ancien) throw new ErreurHttp(400, "Le nouveau mot de passe doit être différent.");
      moi.mdp = hacherMdp(corps.nouveau); moi.doitChangerMdp = false;
      fermerSessionsDe(moi.id); // toutes les autres sessions sont fermées
      const jeton = creerSession(moi.id);
      res.setHeader("Set-Cookie", cookieSession(jeton));
      sauver(); audit(req, moi, "motdepasse.change");
      return json(res, 200, { ok: true });
    }
  }

  /* Un utilisateur qui doit changer son mot de passe ne peut rien faire d'autre */
  if (moi.doitChangerMdp) throw new ErreurHttp(403, "Vous devez d'abord changer votre mot de passe.", { doitChangerMdp: true });

  if (ressource === "etat" && req.method === "GET") return json(res, 200, vuePourRole(db, moi));

  /* ---------- Utilisateurs (admin) ---------- */
  if (ressource === "utilisateurs") {
    exiger(moi, "admin");
    if (req.method === "POST" && !idRes) {
      const login = loginValide(corps.login);
      if (db.utilisateurs.find((x) => x.login === login)) throw new ErreurHttp(409, "Cet identifiant existe déjà.");
      if (!mdpValide(corps.mdp)) throw new ErreurHttp(400, MSG_MDP);
      const u = { id: id(), login, nom: texte(corps.nom, 80, true), role: choix(corps.role, ROLES), postes: listePostes(db, corps.postes) || [], actif: true, mdp: hacherMdp(corps.mdp), doitChangerMdp: true, creeLe: new Date().toISOString() };
      db.utilisateurs.push(u); sauver(); audit(req, moi, "utilisateur.cree", { login, role: u.role });
      return json(res, 201, utilisateurPublic(u));
    }
    const u = db.utilisateurs.find((x) => x.id === idRes);
    if (!u) throw new ErreurHttp(404, "Utilisateur introuvable.");
    if (req.method === "PUT" && !action) {
      if ("nom" in corps) u.nom = texte(corps.nom, 80, true);
      if ("role" in corps) { if (u.id === moi.id) throw new ErreurHttp(400, "Vous ne pouvez pas changer votre propre rôle."); u.role = choix(corps.role, ROLES); }
      if ("postes" in corps) u.postes = listePostes(db, corps.postes);
      if ("actif" in corps) { if (u.id === moi.id) throw new ErreurHttp(400, "Vous ne pouvez pas vous désactiver vous-même."); u.actif = !!corps.actif; if (!u.actif) fermerSessionsDe(u.id); }
      sauver(); audit(req, moi, "utilisateur.modifie", { login: u.login, role: u.role, actif: u.actif, postes: u.postes });
      return json(res, 200, utilisateurPublic(u));
    }
    if (req.method === "POST" && action === "motdepasse") {
      if (!mdpValide(corps.mdp)) throw new ErreurHttp(400, MSG_MDP);
      u.mdp = hacherMdp(corps.mdp); u.doitChangerMdp = true; fermerSessionsDe(u.id);
      sauver(); audit(req, moi, "utilisateur.mdp_reinitialise", { login: u.login });
      return json(res, 200, { ok: true });
    }
    if (req.method === "DELETE") {
      if (u.id === moi.id) throw new ErreurHttp(400, "Vous ne pouvez pas supprimer votre propre compte.");
      db.utilisateurs = db.utilisateurs.filter((x) => x.id !== u.id); fermerSessionsDe(u.id);
      sauver(); audit(req, moi, "utilisateur.supprime", { login: u.login });
      return json(res, 200, { ok: true });
    }
  }

  /* ---------- Postes de préparation (admin) ---------- */
  if (ressource === "postes") {
    exiger(moi, "admin");
    if (req.method === "POST" && !idRes) {
      const p = { id: id(), nom: texte(corps.nom, 40, true), description: texte(corps.description, 300, false) };
      if (db.postes.some((x) => x.nom.toLowerCase() === p.nom.toLowerCase())) throw new ErreurHttp(409, "Ce poste existe déjà.");
      db.postes.push(p); sauver(); audit(req, moi, "poste.cree", { nom: p.nom }); return json(res, 201, p);
    }
    if (req.method === "PUT" && idRes === "ordre") {
      const ids = listePostes(db, corps.ordre) || [];
      if (ids.length !== db.postes.length) throw new ErreurHttp(400, "L'ordre doit contenir tous les postes.");
      db.postes = ids.map((pid) => db.postes.find((p) => p.id === pid));
      sauver(); audit(req, moi, "poste.reordonne"); return json(res, 200, db.postes);
    }
    const p = db.postes.find((x) => x.id === idRes);
    if (!p) throw new ErreurHttp(404, "Poste introuvable.");
    if (req.method === "PUT") {
      if ("nom" in corps) p.nom = texte(corps.nom, 40, true);
      if ("description" in corps) p.description = texte(corps.description, 300, false);
      sauver(); audit(req, moi, "poste.modifie", { nom: p.nom }); return json(res, 200, p);
    }
    if (req.method === "DELETE") {
      if (db.commandes.some((c) => !CLOS.includes(c.statut) && (c.etapes || []).some((e) => e.posteId === p.id))) throw new ErreurHttp(409, "Poste utilisé par une commande en cours.");
      db.postes = db.postes.filter((x) => x.id !== p.id);
      db.utilisateurs.forEach((u) => { u.postes = (u.postes || []).filter((x) => x !== p.id); });
      sauver(); audit(req, moi, "poste.supprime", { nom: p.nom }); return json(res, 200, { ok: true });
    }
  }

  if (ressource === "audit" && req.method === "GET") {
    exiger(moi, "admin");
    return json(res, 200, lireAudit(300));
  }

  /* ---------- Produits (fiches de préparation) ---------- */
  if (ressource === "produits") {
    exiger(moi, "admin", "secretariat");
    if (req.method === "POST" && !idRes) {
      const p = validerProduit(db, corps); db.produits.push(p); sauver();
      audit(req, moi, "produit.cree", { nom: p.nom }); return json(res, 201, p);
    }
    const p = db.produits.find((x) => x.id === idRes);
    if (!p) throw new ErreurHttp(404, "Produit introuvable.");
    if (req.method === "PUT") { validerProduit(db, corps, p); sauver(); audit(req, moi, "produit.modifie", { nom: p.nom }); return json(res, 200, p); }
    if (req.method === "DELETE") {
      exiger(moi, "admin");
      if (db.commandes.some((c) => !CLOS.includes(c.statut) && c.lignes.some((l) => l.produitId === p.id))) throw new ErreurHttp(409, "Produit utilisé dans une commande en cours.");
      db.produits = db.produits.filter((x) => x.id !== p.id); sauver(); audit(req, moi, "produit.supprime", { nom: p.nom }); return json(res, 200, { ok: true });
    }
  }

  /* ---------- Clients ---------- */
  if (ressource === "clients") {
    exiger(moi, "admin", "secretariat");
    if (req.method === "POST" && !idRes) {
      const c = validerClient(corps); db.clients.push(c); sauver();
      audit(req, moi, "client.cree", { nom: c.nom }); return json(res, 201, c);
    }
    const c = db.clients.find((x) => x.id === idRes);
    if (!c) throw new ErreurHttp(404, "Client introuvable.");
    if (req.method === "PUT") { validerClient(corps, c); sauver(); audit(req, moi, "client.modifie", { nom: c.nom }); return json(res, 200, c); }
    if (req.method === "DELETE") {
      exiger(moi, "admin");
      if (db.commandes.some((x) => x.clientId === c.id && !CLOS.includes(x.statut))) throw new ErreurHttp(409, "Client avec une commande en cours.");
      db.clients = db.clients.filter((x) => x.id !== c.id); sauver(); audit(req, moi, "client.supprime", { nom: c.nom }); return json(res, 200, { ok: true });
    }
  }

  /* ---------- Commandes ---------- */
  if (ressource === "commandes") {
    if (req.method === "POST" && !idRes) {
      exiger(moi, "admin", "secretariat");
      const lignes = validerLignes(db, corps.lignes || []);
      const cmd = {
        id: id(), numero: db.prochainNumero++, statut: "brouillon",
        clientId: texte(corps.clientId, 40, false),
        sourceMail: texte(corps.sourceMail, 3000, false),      // objet / extrait du mail du client
        dateMail: dateIso(corps.dateMail),
        dateLivraisonSouhaitee: dateIso(corps.dateLivraisonSouhaitee),
        priorite: choix(corps.priorite || "normale", ["normale", "urgente"]),
        note: texte(corps.note, 1000, false),
        lignes,
        etapes: construireEtapes(db, corps.postes, lignes.length),
        etapeIndex: 0,
        creePar: moi.nom, creeLe: new Date().toISOString(), historique: [], messages: [],
      };
      journal(cmd, moi, "Commande créée depuis le mail du client.");
      db.commandes.push(cmd); sauver(); audit(req, moi, "commande.creee", { numero: cmd.numero });
      return json(res, 201, cmd);
    }

    const cmd = db.commandes.find((x) => x.id === idRes);
    if (!cmd) throw new ErreurHttp(404, "Commande introuvable.");

    if (req.method === "PUT" && !action) {
      exiger(moi, "admin", "secretariat");
      if (cmd.statut !== "brouillon") throw new ErreurHttp(400, "Seul un brouillon peut être modifié (rappelez d'abord la commande).");
      if ("clientId" in corps) cmd.clientId = texte(corps.clientId, 40, false);
      if ("sourceMail" in corps) cmd.sourceMail = texte(corps.sourceMail, 3000, false);
      if ("dateMail" in corps) cmd.dateMail = dateIso(corps.dateMail);
      if ("dateLivraisonSouhaitee" in corps) cmd.dateLivraisonSouhaitee = dateIso(corps.dateLivraisonSouhaitee);
      if ("priorite" in corps) cmd.priorite = choix(corps.priorite, ["normale", "urgente"]);
      if ("note" in corps) cmd.note = texte(corps.note, 1000, false);
      if ("lignes" in corps) cmd.lignes = validerLignes(db, corps.lignes);
      if ("postes" in corps || "lignes" in corps) cmd.etapes = construireEtapes(db, "postes" in corps ? corps.postes : cmd.etapes.map((e) => e.posteId), cmd.lignes.length);
      journal(cmd, moi, "Commande modifiée.");
      sauver(); audit(req, moi, "commande.modifiee", { numero: cmd.numero });
      return json(res, 200, cmd);
    }

    if (req.method === "DELETE") {
      exiger(moi, "admin", "secretariat");
      if (cmd.statut !== "brouillon") throw new ErreurHttp(400, "Seul un brouillon peut être supprimé.");
      db.commandes = db.commandes.filter((x) => x.id !== cmd.id); sauver(); audit(req, moi, "commande.supprimee", { numero: cmd.numero });
      return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && action) {
      const remarque = texte(corps.remarque, 500, false);
      switch (action) {
        /* Fil de discussion : tout le monde impliqué peut écrire */
        case "message": {
          const contenu = texte(corps.texte, 1000, true);
          if (moi.role === "preparateur") {
            const e = etapeCourante(cmd);
            const implique = (e && (moi.postes || []).includes(e.posteId)) || (cmd.etapes || []).some((x) => x.preparateurId === moi.id);
            if (!implique) throw new ErreurHttp(403, "Vous n'intervenez pas sur cette commande.");
          }
          if (cmd.messages.length >= 500) throw new ErreurHttp(409, "Trop de messages sur cette commande.");
          cmd.messages.push({ id: id(), date: new Date().toISOString(), auteurId: moi.id, auteur: moi.nom, role: moi.role, texte: contenu });
          break;
        }
        /* Secrétariat → préparateurs : uniquement si tout est prêt */
        case "envoyer": {
          exiger(moi, "admin", "secretariat");
          if (cmd.statut !== "brouillon") throw new ErreurHttp(400, "Seule une commande en brouillon peut être envoyée.");
          const b = blocages(db, cmd);
          if (b.length) throw new ErreurHttp(409, "Commande incomplète : impossible de l'envoyer aux préparateurs.", { blocages: b });
          cmd.statut = "a_preparer"; cmd.etapeIndex = 0;
          cmd.etapes.forEach((e) => Object.assign(e, { statut: "a_faire", preparateur: "", preparateurId: "", debut: "", fin: "", remarque: "", coches: cmd.lignes.map(() => false) }));
          cmd.envoyeeLe = new Date().toISOString();
          journal(cmd, moi, `Envoyée en préparation → poste ${nomPoste(db, cmd.etapes[0].posteId)}.`);
          break;
        }
        /* Secrétariat rappelle une commande pas encore prise */
        case "rappeler": {
          exiger(moi, "admin", "secretariat");
          if (cmd.statut !== "a_preparer" || cmd.etapeIndex !== 0) throw new ErreurHttp(400, "Impossible : la préparation a déjà commencé.");
          cmd.statut = "brouillon"; journal(cmd, moi, "Rappelée au secrétariat.");
          break;
        }
        /* Préparateur prend l'étape courante sur sa tablette */
        case "prendre": {
          exiger(moi, "admin", "preparateur");
          if (cmd.statut !== "a_preparer") throw new ErreurHttp(409, "Cette étape a déjà été prise par quelqu'un d'autre.");
          const e = etapePour(db, cmd, moi, false);
          e.statut = "en_cours"; e.preparateur = moi.nom; e.preparateurId = moi.id; e.debut = new Date().toISOString();
          cmd.statut = "en_preparation";
          journal(cmd, moi, "Prise en charge.", nomPoste(db, e.posteId));
          break;
        }
        /* Cocher / décocher une ligne de l'étape courante */
        case "ligne": {
          exiger(moi, "admin", "preparateur");
          const e = etapePour(db, cmd, moi, true);
          const i = entier(corps.index, 0, cmd.lignes.length - 1);
          e.coches[i] = !!corps.fait;
          if ("lot" in corps) cmd.lignes[i].lot = texte(corps.lot, 40, false);       // traçabilité : n° de lot
          if ("dlc" in corps) cmd.lignes[i].dlc = dateIso(corps.dlc);                // date limite de consommation
          break;
        }
        /* Étape terminée → poste suivant, ou retour secrétariat si c'était la dernière */
        case "terminer": {
          exiger(moi, "admin", "preparateur");
          const e = etapePour(db, cmd, moi, true);
          if (!e.coches.every(Boolean)) throw new ErreurHttp(409, "Toutes les lignes doivent être cochées avant de terminer.");
          e.statut = "faite"; e.fin = new Date().toISOString(); e.remarque = remarque;
          const posteFini = nomPoste(db, e.posteId);
          if (cmd.etapeIndex + 1 < cmd.etapes.length) {
            cmd.etapeIndex++; cmd.statut = "a_preparer";
            journal(cmd, moi, `Étape terminée${remarque ? " — " + remarque : ""}. Transmise au poste ${nomPoste(db, cmd.etapes[cmd.etapeIndex].posteId)}.`, posteFini);
          } else {
            cmd.lignes.forEach((l) => { const p = db.produits.find((x) => x.id === l.produitId); if (p) p.stock = Math.max(0, p.stock - l.quantite); });
            cmd.statut = "preparee"; cmd.prepareeLe = new Date().toISOString();
            journal(cmd, moi, `Dernière étape terminée${remarque ? " — " + remarque : ""}. Retour au secrétariat.`, posteFini);
          }
          break;
        }
        /* Préparateur rend l'étape (problème) → elle redevient disponible pour son poste */
        case "rendre": {
          exiger(moi, "admin", "preparateur");
          const e = etapePour(db, cmd, moi, true);
          e.statut = "a_faire"; e.coches = cmd.lignes.map(() => false);
          journal(cmd, moi, "Remise dans la file" + (remarque ? " — " + remarque : "."), nomPoste(db, e.posteId));
          e.preparateur = ""; e.preparateurId = ""; e.debut = "";
          cmd.statut = "a_preparer";
          break;
        }
        /* Secrétariat renvoie une commande préparée à un poste (ex. erreur détectée) */
        case "renvoyer": {
          exiger(moi, "admin", "secretariat");
          if (!["preparee", "a_preparer", "en_preparation"].includes(cmd.statut)) throw new ErreurHttp(400, "Cette commande ne peut pas être renvoyée.");
          const idx = entier(corps.etape, 0, cmd.etapes.length - 1);
          if (!remarque) throw new ErreurHttp(400, "Indiquez la raison du renvoi.");
          for (let i = idx; i < cmd.etapes.length; i++) Object.assign(cmd.etapes[i], { statut: "a_faire", preparateur: "", preparateurId: "", debut: "", fin: "", remarque: "", coches: cmd.lignes.map(() => false) });
          if (cmd.statut === "preparee") cmd.lignes.forEach((l) => { const p = db.produits.find((x) => x.id === l.produitId); if (p) p.stock += l.quantite; }); // on ré-crédite le stock
          cmd.etapeIndex = idx; cmd.statut = "a_preparer";
          journal(cmd, moi, `Renvoyée au poste ${nomPoste(db, cmd.etapes[idx].posteId)} — ${remarque}`);
          break;
        }
        /* Secrétariat valide l'expédition */
        case "expedier": {
          exiger(moi, "admin", "secretariat");
          if (cmd.statut !== "preparee") throw new ErreurHttp(400, "La commande doit d'abord être préparée.");
          cmd.statut = "expediee"; cmd.transporteur = texte(corps.transporteur, 80, false); cmd.suivi = texte(corps.suivi, 80, false); cmd.expedieeLe = new Date().toISOString();
          journal(cmd, moi, "Expédiée" + (cmd.transporteur ? " via " + cmd.transporteur : "") + (cmd.suivi ? " (suivi " + cmd.suivi + ")" : "."));
          break;
        }
        case "annuler": {
          exiger(moi, "admin", "secretariat");
          if (CLOS.includes(cmd.statut)) throw new ErreurHttp(400, "Commande déjà close.");
          if (cmd.statut === "preparee") cmd.lignes.forEach((l) => { const p = db.produits.find((x) => x.id === l.produitId); if (p) p.stock += l.quantite; });
          cmd.statut = "annulee"; journal(cmd, moi, "Annulée" + (remarque ? " — " + remarque : "."));
          break;
        }
        default:
          throw new ErreurHttp(404, "Action inconnue.");
      }
      sauver(); audit(req, moi, "commande." + action, { numero: cmd.numero, statut: cmd.statut });
      return json(res, 200, cmd);
    }
  }

  throw new ErreurHttp(404, "Route inconnue.");
}

/* =====================================================================
   9. Serveur
   ===================================================================== */
function gerer(req, res) {
  entetesSecurite(res);
  const route = req.url.split("?")[0];
  if (route.startsWith("/api/")) {
    api(req, res, route.slice(4)).catch((e) => {
      if (e instanceof ErreurHttp) return json(res, e.code, { erreur: e.message, ...(e.extra || {}) });
      console.error(e);
      json(res, 500, { erreur: "Erreur interne." }); // jamais de détail technique côté client
    });
  } else {
    statique(req, res);
  }
}

if (require.main === module) {
  lireDb();
  const serveur = TLS ? https.createServer(TLS, gerer) : http.createServer(gerer);
  serveur.headersTimeout = 15000;
  serveur.requestTimeout = 30000;
  serveur.listen(PORT, HOST, () => {
    const proto = TLS ? "https" : "http";
    console.log(`NutriLog démarré : ${proto}://localhost:${PORT}`);
    console.log(`Sur les tablettes : ${proto}://<adresse-IP-de-ce-PC>:${PORT}`);
    if (!TLS) console.warn("⚠ HTTP non chiffré : fournissez TLS_KEY et TLS_CERT pour activer HTTPS (obligatoire en production).");
  });
}

module.exports = { blocages, ficheComplete, hacherMdp, verifierMdp, mdpValide, STATUTS, ROLES, CONSERVATIONS };
