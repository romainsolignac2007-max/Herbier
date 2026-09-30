/* ============================================================
   NutriLog — serveur (Node.js ≥ 18, sans dépendance externe)
   Logistique d'un dépôt de distribution d'aliments pour animaux
   (croquettes, pâtées, friandises, litière, produits frais / surgelés)
   ------------------------------------------------------------
   Lancer :  node server.js
   Variables d'environnement (toutes optionnelles) :
     PORT            port d'écoute (3000)
     HOST            adresse d'écoute (0.0.0.0 = accessible aux tablettes du réseau)
     ADMIN_PASSWORD  mot de passe du compte « admin » créé au 1er lancement
     TLS_KEY / TLS_CERT  chemins vers la clé et le certificat → serveur HTTPS
     DATA_DIR        dossier des données (./data)
     TRUST_PROXY=1   derrière un reverse proxy (nginx/Caddy) qui termine HTTPS : IP réelle lue dans
                     X-Forwarded-For, cookie Secure + HSTS. Exige HOST=127.0.0.1.
     ADMIN_RESET_PASSWORD  réinitialise le compte « admin » au démarrage (à retirer après usage)
     SESSION_INACTIVITE_MIN  minutes sans action avant déconnexion (480 = 8 h ; ex. 30 pour des tablettes partagées)

   Circuit d'une commande :
     Secrétariat (mail client → saisie)  →  contrôle (fiches, stock)
       →  Emballage (tablettes)  →  retour Secrétariat  →  expédition
   L'admin peut ajouter d'autres postes au circuit ; chacun ne voit que ce qui l'attend.

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
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const SECURE = !!TLS || TRUST_PROXY; // HTTPS local ou terminé par le proxy → cookie Secure + HSTS

const SESSION_INACTIVITE_MS = (Number(process.env.SESSION_INACTIVITE_MIN) || 8 * 60) * 60 * 1000; // déconnexion après 8 h sans action
const SESSION_MAX_MS = 24 * 60 * 60 * 1000;         // reconnexion obligatoire toutes les 24 h
const MDP_MIN = 12;                                  // longueur minimale des mots de passe
// Gestion du stock (réservation, contrôle de disponibilité) : désactivée pour l'instant, GESTION_STOCK=1 pour l'activer
const GESTION_STOCK = process.env.GESTION_STOCK === "1";
const TENTATIVES_MAX = 5;                            // échecs depuis une même adresse avant blocage de l'adresse
const TENTATIVES_COMPTE_MAX = 20;                    // échecs sur un même compte (toutes adresses) avant blocage du compte
const BLOCAGE_MS = 15 * 60 * 1000;                   // durée du blocage (et fenêtre de comptage des échecs)

const ROLES = ["admin", "secretariat", "preparateur"];
const STATUTS = ["brouillon", "a_preparer", "en_preparation", "preparee", "expediee", "annulee"];
const CLOS = ["expediee", "annulee"];
const CONSERVATIONS = ["ambiant", "frais", "surgele"]; // chaîne du froid
const CATEGORIES = ["chien", "chat", "cheval", "bassecour", "cereales", "rongeur", "oiseau", "autre"]; // univers du produit
const CATALOGUE_INITIAL = process.env.CATALOGUE_INITIAL || path.join(__dirname, "catalogue", "solignac-nutrition.json");

/* =====================================================================
   1. Base de données (fichier JSON, écriture atomique)
   ===================================================================== */
let dbCache = null;
let demarre = false; // après le démarrage, un échec de lecture ne doit JAMAIS arrêter le serveur
function lireDb() {
  if (dbCache) return dbCache;
  let brut;
  try {
    brut = fs.readFileSync(DB_FILE, "utf8");
  } catch (e) {
    if (e.code !== "ENOENT" || demarre) lectureImpossible(e); // en cours de route : fichier momentanément inaccessible
    dbCache = donneesInitiales(); // vrai premier lancement uniquement : aucun fichier
    ecrireDb(dbCache);
    return dbCache;
  }
  let db;
  try { db = JSON.parse(brut); } catch (e) { lectureImpossible(e); }
  if (!db || !["utilisateurs", "postes", "produits", "clients", "commandes"].every((k) => Array.isArray(db[k])) || !Number.isInteger(db.prochainNumero))
    lectureImpossible(new Error("structure inattendue"));
  // Migration : commandes créées avant la réservation de stock. Une commande « preparee » de l'ancienne version
  // a déjà sorti son stock ; celles encore en préparation le sortiront à la fin (voir « terminer »).
  db.commandes.forEach((c) => { if (c.stockReserve === undefined && c.envoyeeLe && c.statut === "preparee") c.stockReserve = true; });
  dbCache = db;
  return dbCache;
}

/* Au démarrage : arrêt sans rien écraser. En fonctionnement : la requête échoue (503), le serveur reste en service. */
function lectureImpossible(e) {
  if (!demarre) arretBaseIllisible(e);
  console.error(`Lecture de ${DB_FILE} impossible (${e.message}) : requête refusée, serveur maintenu.`);
  throw new ErreurHttp(503, "Service momentanément indisponible, réessayez dans un instant.");
}

/* Une base présente mais illisible n'est JAMAIS remplacée : on garde une copie et on s'arrête. */
function arretBaseIllisible(e) {
  const copie = DB_FILE + ".illisible-" + new Date().toISOString().replace(/[:.]/g, "-");
  try { fs.copyFileSync(DB_FILE, copie); } catch (_) { /* fichier inaccessible : rien à copier */ }
  console.error(`\n⛔ ${DB_FILE} est illisible (${e.message}).\n   Copie conservée : ${copie}\n   Restaurez la dernière sauvegarde de data/ puis relancez. Le serveur ne démarre pas pour ne rien écraser.\n`);
  process.exit(1);
}

function ecrireDb(db) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    const tmp = DB_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, DB_FILE); // atomique : jamais de fichier à moitié écrit
  } catch (e) {
    dbCache = null; // l'état en mémoire n'a pas pu être enregistré : on repartira du fichier
    throw e;
  }
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
const HASH_FACTICE = hacherMdp(crypto.randomBytes(16).toString("hex")); // compte inexistant : même temps de calcul

const sessions = new Map(); // jeton → { utilisateurId, creeLe, vuLe }

function creerSession(utilisateurId) {
  const jeton = crypto.randomBytes(32).toString("base64url");
  const t = Date.now();
  sessions.set(jeton, { utilisateurId, creeLe: t, vuLe: t });
  return jeton;
}

/* prolonger = false pour le rafraîchissement automatique des écrans : seule une action réelle
   (clic, saisie, chargement de page) compte comme activité pour le délai d'inactivité. */
function sessionDepuisRequete(req, db, prolonger) {
  const cookie = (req.headers.cookie || "").split(";").map((s) => s.trim()).find((s) => s.startsWith("nutrilog="));
  if (!cookie) return null;
  const jeton = cookie.slice("nutrilog=".length);
  const s = sessions.get(jeton);
  if (!s) return null;
  const t = Date.now();
  if (t - s.creeLe > SESSION_MAX_MS || t - s.vuLe > SESSION_INACTIVITE_MS) { sessions.delete(jeton); return null; }
  const u = db.utilisateurs.find((x) => x.id === s.utilisateurId);
  if (!u || !u.actif) { sessions.delete(jeton); return null; }
  if (prolonger) s.vuLe = t;
  return { jeton, utilisateur: u };
}

function fermerSessionsDe(utilisateurId) {
  for (const [j, s] of sessions) if (s.utilisateurId === utilisateurId) sessions.delete(j);
}

function fermerAutresSessionsDe(utilisateurId, jetonGarde) {
  for (const [j, s] of sessions) if (s.utilisateurId === utilisateurId && j !== jetonGarde) sessions.delete(j);
}

setInterval(() => { // nettoyage périodique des sessions et compteurs expirés
  const t = Date.now();
  for (const [j, s] of sessions) if (t - s.creeLe > SESSION_MAX_MS || t - s.vuLe > SESSION_INACTIVITE_MS) sessions.delete(j);
  for (const [c, x] of tentatives) if (x.jusqua ? x.jusqua <= t : t - x.dernier > BLOCAGE_MS) tentatives.delete(c);
}, 60 * 1000).unref();

/* --- Limitation des tentatives de connexion --- */
/* Clés : "ip:<adresse>" (5 échecs → adresse bloquée), "login:<compte>" (20 échecs toutes adresses
   confondues → compte bloqué ; un seul poste ne peut donc pas verrouiller le compte d'un collègue),
   "mdp:<id>" (5 mauvais « ancien mot de passe » depuis une session). Fenêtre de comptage = BLOCAGE_MS. */
const tentatives = new Map(); // clé → { echecs, dernier, jusqua }
const adressesConnues = new Map(); // compte → adresses d'où il s'est déjà connecté (exemptées du blocage du compte)
function bloque(cle) {
  const t = tentatives.get(cle);
  if (!t || !t.jusqua) return false;
  if (t.jusqua > Date.now()) return true;
  tentatives.delete(cle);
  return false;
}
/* Enregistre un échec ; renvoie true si cet échec vient de déclencher le blocage. */
function echec(cle, max) {
  const maintenant = Date.now();
  let t = tentatives.get(cle);
  if (!t || maintenant - t.dernier > BLOCAGE_MS) t = { echecs: 0, dernier: 0, jusqua: 0 };
  t.echecs++; t.dernier = maintenant;
  const vientDeBloquer = t.echecs >= max;
  if (vientDeBloquer) { t.jusqua = maintenant + BLOCAGE_MS; t.echecs = 0; }
  if (tentatives.size > 50000 && !tentatives.has(cle)) tentatives.delete(tentatives.keys().next().value); // plafond mémoire
  tentatives.set(cle, t);
  return vientDeBloquer;
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
    ip: (() => { try { return ipDe(req); } catch (e) { return "?"; } })(),
    action,
    details: details || {},
  });
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  fs.appendFileSync(AUDIT_FILE, ligne + "\n", { mode: 0o600 });
}

function lireAudit(max) {
  let fd;
  try {
    fd = fs.openSync(AUDIT_FILE, "r");
    const taille = fs.fstatSync(fd).size;
    const n = Math.min(taille, 512 * 1024); // on ne lit que la fin du journal
    const buf = Buffer.alloc(n);
    fs.readSync(fd, buf, 0, n, taille - n);
    let lignes = buf.toString("utf8").split("\n").filter(Boolean);
    if (n < taille) lignes = lignes.slice(1); // première ligne peut-être tronquée
    return lignes.slice(-max).reverse().map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  } catch (e) {
    return [];
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function ipDe(req) {
  const directe = (req.socket && req.socket.remoteAddress) || "?";
  if (!TRUST_PROXY) return directe; // sans opt-in, X-Forwarded-For est ignoré (forgeable par le client)
  // Dernier élément = adresse vue par NOTRE proxy (les précédents peuvent être forgés par le client)
  const xff = String(req.headers["x-forwarded-for"] || "").split(",").map((x) => x.trim()).filter(Boolean);
  if (xff.length) return xff[xff.length - 1].slice(0, 64);
  // Proxy mal configuré (en-tête absent) : tous les postes partageraient la même adresse → on refuse
  if (!ipDe.averti) { ipDe.averti = true; console.error("TRUST_PROXY=1 mais X-Forwarded-For absent : configurez le proxy (nginx : proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;)."); }
  throw new ErreurHttp(400, "Configuration du proxy incomplète (X-Forwarded-For absent).");
}

/* =====================================================================
   4. Catalogue du site Solignac Nutrition
   ---------------------------------------------------------------------
   Le site décrit un produit avec plusieurs formats (« 400 g, 1 kg ou 3 kg »).
   En logistique, chaque format est une référence de stock : on en fait
   un produit par format. Clé de rapprochement : idSite (id du site + format).
   ===================================================================== */
const UNIVERS_SITE = { chien: "chien", chat: "chat", equin: "cheval", bassecour: "bassecour", cereales: "cereales" };

function decouper(v) { return String(v || "").split(/,\s+|\s+ou\s+/).map((x) => x.trim()).filter(Boolean); }
function slug(v) { return String(v).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
function enKg(poids) { // pour choisir le conditionnement d'un format (petit format = sachet, grand = sac)
  const m = String(poids).replace(",", ".").match(/([\d.]+)\s*(kg|g|l|ml)/i);
  if (!m) return 0;
  const n = parseFloat(m[1]), u = m[2].toLowerCase();
  return u === "kg" || u === "l" ? n : n / 1000;
}

/* Produits du site → références logistiques (un produit par format). Lève une erreur si le fichier n'a pas la bonne forme. */
function produitsDepuisSite(liste) {
  if (!Array.isArray(liste) || !liste.length || liste.length > 3000) throw new ErreurHttp(400, "Catalogue invalide : liste de produits attendue.");
  const refs = [];
  liste.forEach((x) => {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || typeof x.nom !== "string") throw new ErreurHttp(400, "Catalogue invalide : chaque produit doit avoir un id et un nom.");
    const formats = decouper(x.poids);
    const conds = decouper(x.conditionnement);
    (formats.length ? formats : [""]).forEach((poids, i, tous) => {
      let cond = conds.length === tous.length ? conds[i] : conds.length === 1 ? conds[0] : conds.length ? (enKg(poids) <= 1.5 ? conds[0] : conds[conds.length - 1]) : "unité";
      refs.push({
        idSite: (x.id + (poids ? "-" + slug(poids) : "")).slice(0, 80),
        reference: (x.id + (poids ? "-" + slug(poids) : "")).slice(0, 80),
        nom: String(x.nom).slice(0, 120),
        marque: String(x.marque || "").slice(0, 60),
        gamme: String(x.gamme || "").slice(0, 60),
        poids: String(poids).slice(0, 30),
        unite: String(cond || "unité").toLowerCase().slice(0, 20),
        categorie: UNIVERS_SITE[x.cat] || "autre",
        description: String(x.desc || "").slice(0, 1000),
      });
    });
  });
  return refs;
}

/* Crée ou met à jour les produits à partir du catalogue. Ne touche JAMAIS au stock, à l'emplacement
   ni aux consignes de préparation déjà saisis au dépôt. */
function appliquerCatalogue(db, refs) {
  const bilan = { crees: 0, misAJour: 0, inchanges: 0, absentsDuSite: 0 };
  const vus = new Set();
  refs.forEach((r) => {
    if (vus.has(r.idSite)) return; // doublon dans le fichier
    vus.add(r.idSite);
    const p = db.produits.find((x) => x.idSite === r.idSite);
    if (!p) {
      db.produits.push({ id: id(), ...r, stock: 0, emplacement: "", conservation: "ambiant", dlcJours: 0, preparation: { instructions: "", conditionnement: "", vigilance: "", dureeMin: 0, parPoste: {} } });
      bilan.crees++;
      return;
    }
    const champs = ["reference", "nom", "marque", "gamme", "poids", "unite", "categorie", "description"];
    if (champs.some((k) => p[k] !== r[k])) { champs.forEach((k) => (p[k] = r[k])); bilan.misAJour++; } else bilan.inchanges++;
  });
  bilan.absentsDuSite = db.produits.filter((p) => p.idSite && !vus.has(p.idSite)).length;
  return bilan;
}

/* =====================================================================
   5. Données initiales (1er lancement)
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

  /* Poste de préparation : Emballage (prélever, conditionner, fermer les colis).
     L'admin peut ajouter d'autres postes plus tard si le circuit s'allonge. */
  const emballage = { id: id(), nom: "Emballage", description: "Prélever les produits, les conditionner et fermer les colis avant retour au secrétariat." };
  db.postes = [emballage];

  db.produits = [
    {
      id: id(), nom: "Croquettes chien adulte poulet 12 kg", reference: "CRO-CHI-12", unite: "sac", stock: 80, emplacement: "A1", categorie: "chien", conservation: "ambiant", dlcJours: 540,
      preparation: {
        instructions: "Vérifier la DDM (au moins 3 mois restants). Sac intact, sans déchirure ni odeur de rance.",
        conditionnement: "Sac seul filmé, ou 2 sacs max par carton renforcé",
        vigilance: "Lourd (12 kg) : porter à deux au-delà de 2 sacs, ne pas empiler plus de 4.",
        dureeMin: 2,
        parPoste: { [emballage.id]: "Allée A1, palette du bas : DDM les plus courtes en premier (FIFO), noter le n° de lot au dos du sac. Film étirable + cornières, étiquette « lourd »." },
      },
    },
    {
      id: id(), nom: "Pâtée chat sachets fraîcheur 85 g (×48)", reference: "PAT-CHA-48", unite: "carton", stock: 150, emplacement: "B3", categorie: "chat", conservation: "ambiant", dlcJours: 365,
      preparation: {
        instructions: "Carton fermé d'origine. Vérifier qu'aucun sachet n'est gonflé ou percé.",
        conditionnement: "Carton d'origine, 6 cartons max par colis",
        vigilance: "Ne pas stocker près des produits d'hygiène (litière parfumée) : odeurs.",
        dureeMin: 2,
        parPoste: { [emballage.id]: "Allée B3, étagère 2 : relever le n° de lot sur le côté du carton. Colis carton, calage papier, fermeture double bande." },
      },
    },
    {
      id: id(), nom: "Viande BARF surgelée bœuf 10 kg", reference: "BARF-BOE-10", unite: "carton", stock: 8, emplacement: "S1 (congélateur)", categorie: "chien", conservation: "surgele", dlcJours: 365,
      preparation: { instructions: "", conditionnement: "", vigilance: "", dureeMin: 0, parPoste: {} },
    },
    {
      id: id(), nom: "Litière agglomérante 10 L", reference: "LIT-AGG-10", unite: "sac", stock: 200, emplacement: "C2", categorie: "chat", conservation: "ambiant", dlcJours: 0,
      preparation: {
        instructions: "Sac intact (fuite de granulés = sac à écarter).",
        conditionnement: "Sac seul filmé",
        vigilance: "Lourd et poussiéreux : à placer en bas du colis / de la palette.",
        dureeMin: 1,
        parPoste: { [emballage.id]: "Allée C2, palette. Film étirable, toujours placée en dessous des aliments." },
      },
    },
  ];
  const exemples = { produits: db.produits, clients: [] };
  exemples.clients = [
    { id: id(), nom: "Animalerie Les 4 Pattes", email: "commande@les4pattes.fr", adresse: "12 rue des Lilas, 69003 Lyon", telephone: "04 72 00 00 00" },
    { id: id(), nom: "Clinique vétérinaire du Parc", email: "accueil@veto-duparc.fr", adresse: "3 place de la Mairie, 38000 Grenoble", telephone: "04 76 00 00 00" },
    { id: id(), nom: "Élevage canin du Val", email: "contact@elevage-duval.fr", adresse: "Lieu-dit Le Val, 01500 Ambérieu", telephone: "04 74 00 00 00" },
  ];

  if (process.env.NUTRILOG_EXEMPLES === "1") {
    // Jeu d'exemple (tests, démonstration) : 4 produits aux fiches remplies et 3 clients fictifs
    Object.assign(db, exemples);
  } else {
    // Mise en service réelle : le catalogue du site, sans client fictif ; stocks et consignes à saisir au dépôt
    db.produits = [];
    try {
      const bilan = appliquerCatalogue(db, produitsDepuisSite(JSON.parse(fs.readFileSync(CATALOGUE_INITIAL, "utf8"))));
      console.log(`Catalogue chargé : ${bilan.crees} références (${CATALOGUE_INITIAL}).`);
    } catch (e) {
      console.warn(`Catalogue initial non chargé (${e.message}) : importez-le depuis l'onglet Produits.`);
    }
  }
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
  if (!v) return v;
  const d = new Date(v + "T00:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw new ErreurHttp(400, "Date invalide (AAAA-MM-JJ).");
  return v;
}
function objet(v) { // sous-objet JSON facultatif (ex. « preparation »)
  if (v === undefined || v === null) return {};
  if (typeof v !== "object" || Array.isArray(v)) throw new ErreurHttp(400, "Format invalide.");
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

/* Renvoie un NOUVEL objet produit validé ; l'existant n'est modifié qu'une fois tout validé (par l'appelant). */
function validerProduit(db, corps, existant) {
  const p = existant ? JSON.parse(JSON.stringify(existant)) : { id: id(), preparation: { parPoste: {} } };
  if ("nom" in corps || !existant) p.nom = texte(corps.nom, 120, true);
  if ("reference" in corps || !existant) p.reference = texte(corps.reference, 80, false);
  if ("marque" in corps || !existant) p.marque = texte(corps.marque, 60, false);
  if ("gamme" in corps || !existant) p.gamme = texte(corps.gamme, 60, false);
  if ("poids" in corps || !existant) p.poids = texte(corps.poids, 30, false);
  if ("description" in corps || !existant) p.description = texte(corps.description, 1000, false);
  if ("unite" in corps || !existant) p.unite = texte(corps.unite, 20, false) || "unité";
  if ("stock" in corps || !existant) p.stock = entier(corps.stock ?? 0, 0, 1e7);
  if ("emplacement" in corps || !existant) p.emplacement = texte(corps.emplacement, 40, false);
  if ("categorie" in corps || !existant) p.categorie = choix(corps.categorie || "autre", CATEGORIES);
  if ("conservation" in corps || !existant) p.conservation = choix(corps.conservation || "ambiant", CONSERVATIONS);
  if ("dlcJours" in corps || !existant) p.dlcJours = entier(corps.dlcJours ?? 0, 0, 3650);
  const pr = objet(corps.preparation);
  const anc = p.preparation || {};
  const parPoste = { ...(anc.parPoste || {}) };
  if (pr.parPoste !== undefined) {
    Object.keys(objet(pr.parPoste)).forEach((pid) => {
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
  const c = existant ? { ...existant } : { id: id() };
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
  const vus = new Set();
  return lignes.map((l) => {
    const produitId = texte(l && l.produitId, 40, true);
    const p = db.produits.find((x) => x.id === produitId);
    if (!p) throw new ErreurHttp(400, "Produit inconnu.");
    if (vus.has(produitId)) throw new ErreurHttp(400, `« ${p.nom} » figure sur deux lignes : regroupez les quantités sur une seule.`);
    vus.add(produitId);
    return { produitId, quantite: entier(l.quantite, 1, 1e6) };
  });
}

function verifierDates(cmd) {
  if (cmd.dateMail && cmd.dateLivraisonSouhaitee && cmd.dateLivraisonSouhaitee < cmd.dateMail)
    throw new ErreurHttp(400, "La livraison souhaitée ne peut pas précéder la date du mail.");
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
function ficheComplete(p) {
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
  });
  const demande = new Map();
  cmd.lignes.forEach((l) => demande.set(l.produitId, (demande.get(l.produitId) || 0) + l.quantite));
  for (const [pid, q] of demande) {
    const p = db.produits.find((x) => x.id === pid);
    if (GESTION_STOCK && p && p.stock < q) b.push(`Stock disponible insuffisant pour « ${p.nom} » (${p.stock} ${p.unite} disponibles, ${q} demandés).`);
  }
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

/* sens = -1 : réserver (envoi en préparation) ; +1 : libérer (rappel, annulation). Toujours journalisé. */
function mouvementStock(db, cmd, sens, moi, motif) {
  const detail = cmd.lignes.map((l) => {
    const p = db.produits.find((x) => x.id === l.produitId);
    if (!p) return { produitId: l.produitId, quantite: l.quantite, stockApres: null };
    p.stock += sens * l.quantite;
    return { produitId: p.id, nom: p.nom, quantite: l.quantite, stockApres: p.stock };
  });
  journal(cmd, moi, `${motif} : ` + detail.map((d) => `${d.nom || "?"} ${sens < 0 ? "−" : "+"}${d.quantite} (dispo ${d.stockApres ?? "?"})`).join(", ") + ".");
  return detail;
}

/* Libère les étapes « en cours » tenues par un utilisateur qui n'y a plus droit (désactivé, supprimé, retiré du poste). */
function libererEtapesDe(db, u, admin, motif, garderPostes) {
  const liberees = [];
  db.commandes.forEach((c) => {
    const e = etapeCourante(c);
    if (c.statut !== "en_preparation" || !e || e.statut !== "en_cours" || e.preparateurId !== u.id) return;
    if (garderPostes && garderPostes.includes(e.posteId)) return;
    Object.assign(e, { statut: "a_faire", preparateur: "", preparateurId: "", debut: "", coches: c.lignes.map(() => false) });
    c.statut = "a_preparer";
    journal(c, admin, `Étape reprise à ${u.nom} (${motif}) et remise dans la file.`, nomPoste(db, e.posteId));
    liberees.push(c.numero);
  });
  return liberees;
}

function nomPoste(db, posteId) {
  const p = db.postes.find((x) => x.id === posteId);
  return p ? p.nom : "?";
}

/* Un préparateur n'a accès qu'aux commandes qui attendent son poste ou sur lesquelles il a travaillé. */
function preparateurImplique(c, u) {
  if (CLOS.includes(c.statut) || c.statut === "brouillon") return false;
  const e = etapeCourante(c);
  const attendMonPoste = e && ["a_preparer", "en_preparation"].includes(c.statut) && (u.postes || []).includes(e.posteId);
  return attendMonPoste || (c.etapes || []).some((x) => x.preparateurId === u.id);
}

/* Ce que la tablette reçoit d'une commande : jamais l'extrait du mail client. */
function commandePourPreparateur(c) {
  const { sourceMail, ...reste } = c;
  return reste;
}

/* Vue des données adaptée au rôle (on n'envoie jamais plus que nécessaire) */
function vuePourRole(db, u) {
  const base = { moi: utilisateurPublic(u), gestionStock: GESTION_STOCK, postes: db.postes, produits: db.produits, derniereMaj: db.derniereMaj || null };
  if (u.role === "preparateur") {
    const commandes = db.commandes.filter((c) => preparateurImplique(c, u)).map(commandePourPreparateur);
    const clientIds = new Set(commandes.map((c) => c.clientId));
    return {
      ...base,
      clients: db.clients.filter((c) => clientIds.has(c.id)).map((c) => ({ id: c.id, nom: c.nom, adresse: c.adresse })),
      commandes,
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
  if (SECURE) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
}

function json(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function lireCorps(req) {
  return new Promise((resolve, reject) => {
    let s = "";
    req.on("data", (c) => { s += c; if (s.length > 2 * 1024 * 1024) { reject(new ErreurHttp(413, "Requête trop volumineuse.")); req.destroy(); } });
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
  if (SECURE) parts.push("Secure");
  parts.push(expirer ? "Max-Age=0" : `Max-Age=${Math.floor(SESSION_MAX_MS / 1000)}`);
  return parts.join("; ");
}

/* Anti-CSRF : toute requête modifiante doit venir de notre propre page.
   Une origine illisible (dont « null ») est traitée comme étrangère. */
function verifierCsrf(req) {
  if (req.method === "GET") return;
  if (req.headers["x-requested-with"] !== "NutriLog") throw new ErreurHttp(403, "Requête refusée (CSRF).");
  const brut = req.headers.origin || req.headers.referer || "";
  if (!brut) return;
  let hote;
  try { hote = new URL(brut).host; } catch (e) { throw new ErreurHttp(403, "Origine non autorisée."); }
  if (hote !== (req.headers.host || "")) throw new ErreurHttp(403, "Origine non autorisée.");
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };

function statique(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { erreur: "Méthode non autorisée" });
  let fichier;
  try { fichier = decodeURIComponent(req.url.split("?")[0]); } catch (e) { return json(res, 400, { erreur: "URL invalide" }); }
  if (fichier.includes("\u0000")) return json(res, 400, { erreur: "URL invalide" });
  if (fichier === "/") fichier = "/index.html";
  const abs = path.normalize(path.join(PUBLIC, fichier));
  if (!abs.startsWith(PUBLIC + path.sep)) return json(res, 403, { erreur: "Interdit" });
  fs.readFile(abs, (err, data) => {
    if (err) return json(res, 404, { erreur: "Introuvable" });
    res.writeHead(200, { "Content-Type": MIME[path.extname(abs)] || "application/octet-stream" });
    res.end(req.method === "HEAD" ? undefined : data);
  });
}

/* =====================================================================
   8. API
   ===================================================================== */
function exiger(u, ...roles) {
  if (!roles.includes(u.role)) throw new ErreurHttp(403, "Action non autorisée pour votre rôle.");
}

/* Le préparateur connecté a-t-il le droit d'agir sur l'étape courante ?
   - prendre : il faut appartenir au poste (l'admin peut dépanner n'importe quel poste) ;
   - cocher / terminer / rendre : il faut TENIR l'étape (même un admin ne peut pas agir sous le nom d'un autre :
     il la fait d'abord renvoyer, puis la prend à son nom). */
function etapePour(db, cmd, moi, doitEtreEnCours) {
  const e = etapeCourante(cmd);
  if (!e) throw new ErreurHttp(400, "Aucune étape en cours sur cette commande.");
  if (doitEtreEnCours) {
    if (e.statut !== "en_cours" || cmd.statut !== "en_preparation") throw new ErreurHttp(400, "L'étape n'est pas en cours.");
    if (e.preparateurId !== moi.id) throw new ErreurHttp(403, `Cette étape est en cours par ${e.preparateur}.`);
    return e;
  }
  if (moi.role !== "admin" && !(moi.postes || []).includes(e.posteId)) throw new ErreurHttp(403, `Cette étape relève du poste ${nomPoste(db, e.posteId)}, pas du vôtre.`);
  return e;
}

function reinitEtape(cmd, e) {
  Object.assign(e, { statut: "a_faire", preparateur: "", preparateurId: "", debut: "", fin: "", remarque: "", coches: cmd.lignes.map(() => false) });
}

async function api(req, res, route) {
  const segments = route.split("/").filter(Boolean); // ["commandes", ":id", "envoyer"]
  const [ressource, idRes, action] = segments;
  ipDe(req); // proxy mal configuré : refus immédiat, avant toute lecture ou modification
  verifierCsrf(req);
  const corps = req.method === "GET" ? {} : await lireCorps(req);
  // Plus aucun « await » après cette ligne : chaque requête lit, valide, modifie et enregistre d'un seul tenant.
  // En cas d'erreur, gerer() abandonne le cache mémoire → toute modification partielle est annulée.
  const db = lireDb();
  const sauver = () => { db.derniereMaj = new Date().toISOString(); ecrireDb(db); };

  /* ---------- Connexion (sans session) ---------- */
  if (ressource === "connexion" && req.method === "POST") {
    const ip = ipDe(req);
    const login = texte(corps.login, 40, false).toLowerCase();
    const mdp = typeof corps.mdp === "string" ? corps.mdp.slice(0, 128) : "";
    // Les requêtes refusées pendant un blocage ne sont PAS journalisées une à une (sinon le journal serait inondable).
    // Le blocage d'un COMPTE ne s'applique pas aux adresses d'où ce compte s'est déjà connecté avec succès :
    // un tiers ne peut pas empêcher le titulaire de se connecter depuis son poste habituel.
    const posteConnu = (adressesConnues.get(login) || new Set()).has(ip);
    if (bloque("ip:" + ip) || (!posteConnu && bloque("login:" + login))) throw new ErreurHttp(429, "Trop de tentatives. Réessayez dans 15 minutes.");
    const u = db.utilisateurs.find((x) => x.login === login);
    // Exactement un calcul scrypt que le compte existe ou non : le temps de réponse ne révèle rien.
    const ok = verifierMdp(mdp, u ? u.mdp : HASH_FACTICE) && !!u;
    if (!ok || !u.actif) {
      const ipBloquee = echec("ip:" + ip, TENTATIVES_MAX);
      const compteBloque = echec("login:" + login, TENTATIVES_COMPTE_MAX);
      audit(req, null, ipBloquee || compteBloque ? "connexion.bloquee" : "connexion.echec", { login, ...(ipBloquee ? { blocage: "adresse" } : {}), ...(compteBloque ? { blocage: "compte" } : {}) });
      throw new ErreurHttp(401, "Identifiant ou mot de passe incorrect.");
    }
    // Pas de remise à zéro du compteur de l'ADRESSE : sinon il suffirait d'intercaler une connexion réussie
    // (avec son propre compte) entre deux séries d'essais pour contourner le blocage.
    succes("login:" + login);
    if (!adressesConnues.has(login)) adressesConnues.set(login, new Set());
    const connues = adressesConnues.get(login);
    connues.add(ip); if (connues.size > 20) connues.delete(connues.values().next().value);
    const jeton = creerSession(u.id);
    audit(req, u, "connexion.ok");
    res.setHeader("Set-Cookie", cookieSession(jeton));
    return json(res, 200, { moi: utilisateurPublic(u) });
  }

  /* ---------- Tout le reste exige une session valide ---------- */
  // Le rafraîchissement automatique (GET) ne compte pas comme activité ; le chargement de page (GET /moi) oui.
  const session = sessionDepuisRequete(req, db, req.method !== "GET" || ressource === "moi");
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
      const cle = "mdp:" + moi.id;
      if (bloque(cle)) throw new ErreurHttp(429, "Trop de tentatives. Réessayez dans 15 minutes.");
      if (!verifierMdp(typeof corps.ancien === "string" ? corps.ancien.slice(0, 128) : "", moi.mdp)) {
        const vientDeBloquer = echec(cle, TENTATIVES_MAX);
        audit(req, moi, vientDeBloquer ? "motdepasse.bloque" : "motdepasse.echec");
        if (vientDeBloquer) { sessions.delete(session.jeton); res.setHeader("Set-Cookie", cookieSession("", true)); }
        throw new ErreurHttp(400, "Ancien mot de passe incorrect.");
      }
      if (!mdpValide(corps.nouveau)) throw new ErreurHttp(400, MSG_MDP);
      if (corps.nouveau === corps.ancien) throw new ErreurHttp(400, "Le nouveau mot de passe doit être différent.");
      moi.mdp = hacherMdp(corps.nouveau); moi.doitChangerMdp = false;
      succes(cle);
      fermerAutresSessionsDe(moi.id, session.jeton); // les autres appareils sont déconnectés, pas celui-ci
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
      db.utilisateurs.push(u); sauver(); audit(req, moi, "utilisateur.cree", { login, role: u.role, postes: u.postes.map((x) => nomPoste(db, x)) });
      return json(res, 201, utilisateurPublic(u));
    }
    const u = db.utilisateurs.find((x) => x.id === idRes);
    if (!u) throw new ErreurHttp(404, "Utilisateur introuvable.");
    if (req.method === "PUT" && !action) {
      // Tout est validé avant la moindre modification
      const nom = "nom" in corps ? texte(corps.nom, 80, true) : u.nom;
      if ("role" in corps && u.id === moi.id && corps.role !== u.role) throw new ErreurHttp(400, "Vous ne pouvez pas changer votre propre rôle.");
      const role = "role" in corps ? choix(corps.role, ROLES) : u.role;
      const postes = "postes" in corps ? listePostes(db, corps.postes) : u.postes || [];
      if ("actif" in corps && u.id === moi.id && !corps.actif) throw new ErreurHttp(400, "Vous ne pouvez pas vous désactiver vous-même.");
      const actif = "actif" in corps ? !!corps.actif : u.actif;
      Object.assign(u, { nom, role, postes, actif });
      let liberees = [];
      if (!actif) { fermerSessionsDe(u.id); liberees = libererEtapesDe(db, u, moi, "compte désactivé"); }
      else if (role !== "preparateur" && role !== "admin") liberees = libererEtapesDe(db, u, moi, "rôle modifié");
      else if (role === "preparateur") liberees = libererEtapesDe(db, u, moi, "retiré du poste", postes);
      sauver(); audit(req, moi, "utilisateur.modifie", { login: u.login, role, actif, postes: postes.map((x) => nomPoste(db, x)), etapesLiberees: liberees });
      return json(res, 200, utilisateurPublic(u));
    }
    if (req.method === "POST" && action === "motdepasse") {
      if (!mdpValide(corps.mdp)) throw new ErreurHttp(400, MSG_MDP);
      u.mdp = hacherMdp(corps.mdp); u.doitChangerMdp = true; fermerSessionsDe(u.id);
      succes("login:" + u.login); succes("mdp:" + u.id);
      sauver(); audit(req, moi, "utilisateur.mdp_reinitialise", { login: u.login });
      return json(res, 200, { ok: true });
    }
    if (req.method === "POST" && action === "debloquer") {
      succes("login:" + u.login); succes("mdp:" + u.id);
      audit(req, moi, "utilisateur.debloque", { login: u.login });
      return json(res, 200, { ok: true });
    }
    if (req.method === "DELETE") {
      if (u.id === moi.id) throw new ErreurHttp(400, "Vous ne pouvez pas supprimer votre propre compte.");
      const liberees = libererEtapesDe(db, u, moi, "compte supprimé");
      db.utilisateurs = db.utilisateurs.filter((x) => x.id !== u.id); fermerSessionsDe(u.id);
      sauver(); audit(req, moi, "utilisateur.supprime", { login: u.login, etapesLiberees: liberees });
      return json(res, 200, { ok: true });
    }
  }

  /* ---------- Postes de préparation (admin) ---------- */
  if (ressource === "postes") {
    exiger(moi, "admin");
    const nomLibre = (nom, sauf) => { if (db.postes.some((x) => x.id !== sauf && x.nom.toLowerCase() === nom.toLowerCase())) throw new ErreurHttp(409, "Ce poste existe déjà."); return nom; };
    if (req.method === "POST" && !idRes) {
      const p = { id: id(), nom: nomLibre(texte(corps.nom, 40, true)), description: texte(corps.description, 300, false) };
      db.postes.push(p); sauver(); audit(req, moi, "poste.cree", { nom: p.nom }); return json(res, 201, p);
    }
    if (req.method === "PUT" && idRes === "ordre") {
      const ids = listePostes(db, corps.ordre) || [];
      if (ids.length !== db.postes.length) throw new ErreurHttp(400, "L'ordre doit contenir tous les postes.");
      db.postes = ids.map((pid) => db.postes.find((p) => p.id === pid));
      sauver(); audit(req, moi, "poste.reordonne", { ordre: db.postes.map((p) => p.nom) }); return json(res, 200, db.postes);
    }
    const p = db.postes.find((x) => x.id === idRes);
    if (!p) throw new ErreurHttp(404, "Poste introuvable.");
    if (req.method === "PUT") {
      const ancienNom = p.nom;
      const nom = "nom" in corps ? nomLibre(texte(corps.nom, 40, true), p.id) : p.nom;
      const description = "description" in corps ? texte(corps.description, 300, false) : p.description;
      Object.assign(p, { nom, description });
      sauver(); audit(req, moi, "poste.modifie", { id: p.id, ancienNom, nom }); return json(res, 200, p);
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
      audit(req, moi, "produit.cree", { nom: p.nom, stock: p.stock }); return json(res, 201, p);
    }
    /* Import / mise à jour du catalogue depuis le site (stocks, emplacements et consignes conservés) */
    if (req.method === "POST" && idRes === "import") {
      const bilan = appliquerCatalogue(db, produitsDepuisSite(corps.produits));
      sauver(); audit(req, moi, "catalogue.importe", { source: texte(corps.source, 200, false), ...bilan });
      return json(res, 200, bilan);
    }
    /* Fiche type : mêmes consignes pour un groupe de produits (ex. tous les sacs de croquettes d'une marque) */
    if (req.method === "POST" && idRes === "fiche-groupee") {
      if (!Array.isArray(corps.ids) || !corps.ids.length || corps.ids.length > 5000) throw new ErreurHttp(400, "Sélection de produits invalide.");
      const cibles = corps.ids.map((x) => { const p = db.produits.find((y) => y.id === x); if (!p) throw new ErreurHttp(400, "Produit inconnu dans la sélection."); return p; });
      const modele = validerProduit(db, { nom: "modèle", preparation: corps.preparation }).preparation; // même validation qu'une fiche
      const ecraser = corps.ecraser === true;
      let modifies = 0;
      cibles.forEach((p) => {
        const pr = p.preparation, avant = JSON.stringify(pr);
        ["instructions", "conditionnement", "vigilance"].forEach((k) => { if (modele[k] && (ecraser || !pr[k])) pr[k] = modele[k]; });
        if (modele.dureeMin && (ecraser || !pr.dureeMin)) pr.dureeMin = modele.dureeMin;
        Object.entries(modele.parPoste).forEach(([pid, v]) => { if (v && (ecraser || !pr.parPoste[pid])) pr.parPoste[pid] = v; });
        if (JSON.stringify(pr) !== avant) modifies++;
      });
      sauver(); audit(req, moi, "produit.fiche_groupee", { produits: cibles.length, modifies, ecraser });
      return json(res, 200, { produits: cibles.length, modifies });
    }
    const p = db.produits.find((x) => x.id === idRes);
    if (!p) throw new ErreurHttp(404, "Produit introuvable.");
    if (req.method === "PUT") {
      const stockAvant = p.stock;
      const nouveau = validerProduit(db, corps, p);
      // Le stock disponible bouge à chaque envoi / rappel / annulation : on n'écrase pas une valeur qui a changé entre-temps
      if ("stock" in corps && corps.stockAvant !== stockAvant)
        throw new ErreurHttp(409, `Le stock disponible a changé entre-temps (${stockAvant} ${p.unite} maintenant). Rouvrez la fiche et ressaisissez-le.`);
      Object.assign(p, nouveau);
      sauver(); audit(req, moi, "produit.modifie", { nom: p.nom, ...(stockAvant !== p.stock ? { stockAvant, stockApres: p.stock } : {}) });
      return json(res, 200, p);
    }
    if (req.method === "DELETE") {
      exiger(moi, "admin");
      if (db.commandes.some((c) => !CLOS.includes(c.statut) && c.lignes.some((l) => l.produitId === p.id))) throw new ErreurHttp(409, "Produit utilisé dans une commande en cours.");
      db.produits = db.produits.filter((x) => x.id !== p.id); sauver(); audit(req, moi, "produit.supprime", { nom: p.nom, stock: p.stock }); return json(res, 200, { ok: true });
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
    if (req.method === "PUT") { Object.assign(c, validerClient(corps, c)); sauver(); audit(req, moi, "client.modifie", { nom: c.nom }); return json(res, 200, c); }
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
        id: id(), numero: 0, statut: "brouillon",
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
      verifierDates(cmd);
      cmd.numero = db.prochainNumero++; // attribué seulement une fois tout validé : numérotation sans trou
      journal(cmd, moi, "Commande créée depuis le mail du client.");
      db.commandes.push(cmd); sauver(); audit(req, moi, "commande.creee", { numero: cmd.numero });
      return json(res, 201, cmd);
    }

    const cmd = db.commandes.find((x) => x.id === idRes);
    if (!cmd) throw new ErreurHttp(404, "Commande introuvable.");
    // Un préparateur n'a accès qu'aux commandes qui le concernent (même réponse que si elle n'existait pas)
    if (moi.role === "preparateur" && !preparateurImplique(cmd, moi)) throw new ErreurHttp(404, "Commande introuvable.");

    if (req.method === "PUT" && !action) {
      exiger(moi, "admin", "secretariat");
      if (cmd.statut !== "brouillon") throw new ErreurHttp(400, "Seul un brouillon peut être modifié (rappelez d'abord la commande).");
      const t = {}; // validation complète avant modification
      if ("clientId" in corps) t.clientId = texte(corps.clientId, 40, false);
      if ("sourceMail" in corps) t.sourceMail = texte(corps.sourceMail, 3000, false);
      if ("dateMail" in corps) t.dateMail = dateIso(corps.dateMail);
      if ("dateLivraisonSouhaitee" in corps) t.dateLivraisonSouhaitee = dateIso(corps.dateLivraisonSouhaitee);
      if ("priorite" in corps) t.priorite = choix(corps.priorite, ["normale", "urgente"]);
      if ("note" in corps) t.note = texte(corps.note, 1000, false);
      if ("lignes" in corps) t.lignes = validerLignes(db, corps.lignes);
      if ("postes" in corps || "lignes" in corps) t.etapes = construireEtapes(db, "postes" in corps ? corps.postes : cmd.etapes.map((e) => e.posteId), (t.lignes || cmd.lignes).length);
      verifierDates({ ...cmd, ...t });
      Object.assign(cmd, t);
      journal(cmd, moi, "Commande modifiée.");
      sauver(); audit(req, moi, "commande.modifiee", { numero: cmd.numero, champs: Object.keys(t) });
      return json(res, 200, cmd);
    }

    if (req.method === "DELETE") {
      exiger(moi, "admin", "secretariat");
      if (cmd.statut !== "brouillon") throw new ErreurHttp(400, "Seul un brouillon peut être supprimé.");
      if (cmd.envoyeeLe) throw new ErreurHttp(400, "Cette commande est déjà passée en préparation : annulez-la plutôt (l'historique est conservé).");
      db.commandes = db.commandes.filter((x) => x.id !== cmd.id); sauver(); audit(req, moi, "commande.supprimee", { numero: cmd.numero });
      return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && action) {
      const remarque = texte(corps.remarque, 500, false);
      let details = {};
      switch (action) {
        /* Fil de discussion : tout le monde impliqué peut écrire (accès préparateur vérifié plus haut) */
        case "message": {
          if (CLOS.includes(cmd.statut)) throw new ErreurHttp(400, "Commande close : le fil de discussion est fermé.");
          const contenu = texte(corps.texte, 1000, true);
          if (cmd.messages.length >= 500) throw new ErreurHttp(409, "Trop de messages sur cette commande.");
          cmd.messages.push({ id: id(), date: new Date().toISOString(), auteurId: moi.id, auteur: moi.nom, role: moi.role, texte: contenu });
          break;
        }
        /* Secrétariat → préparateurs : uniquement si tout est prêt. Le stock est réservé dès maintenant. */
        case "envoyer": {
          exiger(moi, "admin", "secretariat");
          if (cmd.statut !== "brouillon") throw new ErreurHttp(400, "Seule une commande en brouillon peut être envoyée.");
          const b = blocages(db, cmd);
          if (b.length) throw new ErreurHttp(409, "Commande incomplète : impossible de l'envoyer aux préparateurs.", { blocages: b });
          cmd.statut = "a_preparer"; cmd.etapeIndex = 0;
          cmd.etapes.forEach((e) => reinitEtape(cmd, e));
          cmd.envoyeeLe = cmd.envoyeeLe || new Date().toISOString();
          if (GESTION_STOCK) { details.stock = mouvementStock(db, cmd, -1, moi, "Stock réservé"); cmd.stockReserve = true; }
          journal(cmd, moi, `Envoyée en préparation → poste ${nomPoste(db, cmd.etapes[0].posteId)}.`);
          break;
        }
        /* Secrétariat rappelle une commande pas encore prise : le stock réservé est libéré */
        case "rappeler": {
          exiger(moi, "admin", "secretariat");
          if (cmd.statut !== "a_preparer" || cmd.etapeIndex !== 0) throw new ErreurHttp(400, "Impossible : la préparation a déjà commencé.");
          if (cmd.stockReserve) { details.stock = mouvementStock(db, cmd, +1, moi, "Stock libéré"); cmd.stockReserve = false; }
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
          details.poste = nomPoste(db, e.posteId);
          break;
        }
        /* Cocher / décocher une ligne, saisir lot et DDM/DLC — chaque saisie de traçabilité est historisée */
        case "ligne": {
          exiger(moi, "admin", "preparateur");
          const e = etapePour(db, cmd, moi, true);
          const i = entier(corps.index, 0, cmd.lignes.length - 1);
          const l = cmd.lignes[i];
          const lot = "lot" in corps ? texte(corps.lot, 40, false) : l.lot || "";
          const dlc = "dlc" in corps ? dateIso(corps.dlc) : l.dlc || "";
          const ancienLot = l.lot || "", ancienneDlc = l.dlc || "";
          if ("fait" in corps) e.coches[i] = !!corps.fait; // saisie d'un lot seule : la case n'est pas touchée
          l.lot = lot; l.dlc = dlc;
          if (lot !== ancienLot || dlc !== ancienneDlc) {
            const p = db.produits.find((x) => x.id === l.produitId);
            const chg = [lot !== ancienLot ? `lot ${ancienLot || "—"} → ${lot || "—"}` : "", dlc !== ancienneDlc ? `DDM/DLC ${ancienneDlc || "—"} → ${dlc || "—"}` : ""].filter(Boolean).join(", ");
            journal(cmd, moi, `Ligne ${i + 1} (${p ? p.nom : "?"}) : ${chg}.`, nomPoste(db, e.posteId));
          }
          details = { index: i, fait: e.coches[i], lot, dlc, ...(lot !== ancienLot ? { ancienLot } : {}), ...(dlc !== ancienneDlc ? { ancienneDlc } : {}) };
          break;
        }
        /* Étape terminée → poste suivant, ou retour secrétariat si c'était la dernière */
        case "terminer": {
          exiger(moi, "admin", "preparateur");
          const e = etapePour(db, cmd, moi, true);
          if (!e.coches.every(Boolean)) throw new ErreurHttp(409, "Toutes les lignes doivent être cochées avant de terminer.");
          if (!cmd.etapes.slice(0, cmd.etapeIndex).every((x) => x.statut === "faite")) throw new ErreurHttp(409, "Une étape précédente du circuit n'a pas été faite.");
          e.statut = "faite"; e.fin = new Date().toISOString(); e.remarque = remarque;
          const posteFini = nomPoste(db, e.posteId);
          details = { poste: posteFini, remarque };
          if (cmd.etapeIndex + 1 < cmd.etapes.length) {
            cmd.etapeIndex++; cmd.statut = "a_preparer";
            journal(cmd, moi, `Étape terminée${remarque ? " — " + remarque : ""}. Transmise au poste ${nomPoste(db, cmd.etapes[cmd.etapeIndex].posteId)}.`, posteFini);
          } else {
            if (GESTION_STOCK && !cmd.stockReserve) { // commande envoyée avant la réservation de stock (ancienne version)
              details.stock = mouvementStock(db, cmd, -1, moi, "Stock sorti");
              cmd.stockReserve = true;
              db.produits.forEach((p) => { if (p.stock < 0) { journal(cmd, moi, `Attention : stock de « ${p.nom} » négatif (${p.stock}) : remis à 0, inventaire à vérifier.`); p.stock = 0; } });
            }
            cmd.statut = "preparee"; cmd.prepareeLe = new Date().toISOString();
            journal(cmd, moi, `Dernière étape terminée${remarque ? " — " + remarque : ""}. Retour au secrétariat.`, posteFini);
          }
          break;
        }
        /* Préparateur rend l'étape (problème) → elle redevient disponible pour son poste */
        case "rendre": {
          exiger(moi, "admin", "preparateur");
          const e = etapePour(db, cmd, moi, true);
          journal(cmd, moi, "Remise dans la file" + (remarque ? " — " + remarque : "."), nomPoste(db, e.posteId));
          reinitEtape(cmd, e);
          cmd.statut = "a_preparer";
          details = { poste: nomPoste(db, e.posteId), remarque };
          break;
        }
        /* Secrétariat renvoie la commande à l'étape courante ou à une étape déjà faite (jamais en avant) */
        case "renvoyer": {
          exiger(moi, "admin", "secretariat");
          if (!["preparee", "a_preparer", "en_preparation"].includes(cmd.statut)) throw new ErreurHttp(400, "Cette commande ne peut pas être renvoyée.");
          const idx = entier(corps.etape, 0, cmd.etapes.length - 1);
          if (idx > cmd.etapeIndex) throw new ErreurHttp(400, "On ne peut renvoyer qu'à l'étape en cours ou à une étape déjà faite : aucun poste ne peut être sauté.");
          if (!remarque) throw new ErreurHttp(400, "Indiquez la raison du renvoi.");
          for (let i = idx; i < cmd.etapes.length; i++) reinitEtape(cmd, cmd.etapes[i]);
          cmd.etapeIndex = idx; cmd.statut = "a_preparer"; // le stock reste réservé
          journal(cmd, moi, `Renvoyée au poste ${nomPoste(db, cmd.etapes[idx].posteId)} — ${remarque}`);
          details = { poste: nomPoste(db, cmd.etapes[idx].posteId), remarque };
          break;
        }
        /* Secrétariat valide l'expédition */
        case "expedier": {
          exiger(moi, "admin", "secretariat");
          if (cmd.statut !== "preparee") throw new ErreurHttp(400, "La commande doit d'abord être préparée.");
          const transporteur = texte(corps.transporteur, 80, false);
          const suivi = texte(corps.suivi, 80, false);
          Object.assign(cmd, { statut: "expediee", transporteur, suivi, expedieeLe: new Date().toISOString() });
          journal(cmd, moi, "Expédiée" + (transporteur ? " via " + transporteur : "") + (suivi ? " (suivi " + suivi + ")" : "."));
          details = { transporteur, suivi };
          break;
        }
        case "annuler": {
          exiger(moi, "admin", "secretariat");
          if (CLOS.includes(cmd.statut)) throw new ErreurHttp(400, "Commande déjà close.");
          if (cmd.stockReserve) { details.stock = mouvementStock(db, cmd, +1, moi, "Stock libéré"); cmd.stockReserve = false; }
          cmd.statut = "annulee"; journal(cmd, moi, "Annulée" + (remarque ? " — " + remarque : "."));
          details.remarque = remarque;
          break;
        }
        default:
          throw new ErreurHttp(404, "Action inconnue.");
      }
      sauver(); audit(req, moi, "commande." + action, { numero: cmd.numero, statut: cmd.statut, ...details });
      return json(res, 200, moi.role === "preparateur" ? commandePourPreparateur(cmd) : cmd);
    }
  }

  throw new ErreurHttp(404, "Route inconnue.");
}

/* =====================================================================
   9. Serveur
   ===================================================================== */
function gerer(req, res) {
  try {
    entetesSecurite(res);
    const route = req.url.split("?")[0];
    if (route.startsWith("/api/")) {
      api(req, res, route.slice(4)).catch((e) => {
        // Requête modifiante refusée : toute modification partielle en mémoire est abandonnée (relecture du fichier).
        // Les lectures (GET) ne modifient rien : pas de relecture, qu'un client ne pourrait donc pas provoquer en boucle.
        if (req.method !== "GET") dbCache = null;
        if (res.headersSent) return;
        if (e instanceof ErreurHttp) return json(res, e.code, { erreur: e.message, ...(e.extra || {}) });
        console.error(e);
        json(res, 500, { erreur: "Erreur interne." }); // jamais de détail technique côté client
      });
    } else {
      statique(req, res);
    }
  } catch (e) { // filet de sécurité : aucune requête ne doit pouvoir arrêter le serveur
    console.error(e);
    if (!res.headersSent) json(res, 400, { erreur: "Requête invalide." });
  }
}

/* Récupération du compte admin (mot de passe oublié) : ADMIN_RESET_PASSWORD=... node server.js, puis retirer la variable. */
function reinitialiserAdmin(mdp) {
  if (!mdpValide(mdp)) { console.error("ADMIN_RESET_PASSWORD : " + MSG_MDP); process.exit(1); }
  const db = lireDb();
  let u = db.utilisateurs.find((x) => x.login === "admin");
  if (!u) { u = { id: id(), login: "admin", nom: "Administrateur", role: "admin", postes: [], creeLe: new Date().toISOString() }; db.utilisateurs.push(u); }
  Object.assign(u, { role: "admin", actif: true, mdp: hacherMdp(mdp), doitChangerMdp: true });
  db.derniereMaj = new Date().toISOString();
  ecrireDb(db);
  audit({ socket: { remoteAddress: "console" }, headers: {} }, null, "admin.reinitialise", { origine: "ADMIN_RESET_PASSWORD" });
  console.warn("⚠ Compte « admin » réinitialisé (mot de passe à changer à la connexion). Retirez ADMIN_RESET_PASSWORD de l'environnement.");
}

if (require.main === module) {
  if (TRUST_PROXY && !["127.0.0.1", "::1", "localhost"].includes(HOST)) {
    console.error("TRUST_PROXY=1 exige HOST=127.0.0.1 : sinon un appareil du réseau pourrait contourner le proxy et falsifier son adresse.");
    process.exit(1);
  }
  if (process.env.ADMIN_RESET_PASSWORD) reinitialiserAdmin(process.env.ADMIN_RESET_PASSWORD);
  lireDb();
  demarre = true;
  const serveur = TLS ? https.createServer(TLS, gerer) : http.createServer(gerer);
  serveur.headersTimeout = 15000;
  serveur.requestTimeout = 30000;
  serveur.listen(PORT, HOST, () => {
    const proto = SECURE ? "https" : "http";
    console.log(`NutriLog démarré : ${proto}://localhost:${PORT}`);
    console.log(`Sur les tablettes : ${proto}://<adresse-IP-de-ce-PC>:${PORT}`);
    if (!SECURE) console.warn("⚠ HTTP non chiffré : fournissez TLS_KEY et TLS_CERT (ou un reverse proxy HTTPS + TRUST_PROXY=1). Obligatoire en production.");
  });
}

module.exports = { blocages, ficheComplete, hacherMdp, verifierMdp, mdpValide, STATUTS, ROLES, CONSERVATIONS, CATEGORIES };
