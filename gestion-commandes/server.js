'use strict';
/**
 * Serveur du logiciel de préparation de commandes.
 * Node >= 18, aucune dépendance externe. Données stockées en JSON dans ./data.
 *
 *   node server.js            → http://localhost:3000
 *   PORT=8080 node server.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { calculerParcours } = require('./lib/parcours');

const ROOT = __dirname;
const DOSSIER_DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const DOSSIER_PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);

const STATUTS = ['BROUILLON', 'A_PREPARER', 'EN_PREPARATION', 'PREPAREE', 'EXPEDIEE', 'ANNULEE'];

/* ------------------------------------------------------------------ données */

function lire(fichier, defaut) {
  const p = path.join(DOSSIER_DATA, fichier);
  if (!fs.existsSync(p)) return defaut;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function ecrire(fichier, valeur) {
  const p = path.join(DOSSIER_DATA, fichier);
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(valeur, null, 2)}\n`);
  fs.renameSync(tmp, p);
}

const db = {
  depot: lire('depot.json'),
  articles: lire('articles.json', []),
  commandes: lire('commandes.json', []),
  version: 1,
};

function indexArticles() {
  const idx = {};
  for (const a of db.articles) idx[a.sku] = a;
  return idx;
}

function sauver(quoi) {
  db.version += 1;
  if (quoi === 'commandes' || !quoi) ecrire('commandes.json', db.commandes);
  if (quoi === 'articles' || !quoi) ecrire('articles.json', db.articles);
}

function maintenant() {
  return new Date().toISOString();
}

function nouveauNumero() {
  const annee = new Date().getFullYear();
  const prefixe = `CMD-${annee}-`;
  const max = db.commandes
    .filter((c) => c.numero.startsWith(prefixe))
    .reduce((m, c) => Math.max(m, Number(c.numero.slice(prefixe.length)) || 0), 0);
  return prefixe + String(max + 1).padStart(4, '0');
}

function journaliser(commande, acteur, action, detail) {
  commande.historique.push({ date: maintenant(), acteur: acteur || 'système', action, detail: detail || '' });
}

function trouverCommande(numero) {
  return db.commandes.find((c) => c.numero === numero);
}

/* ------------------------------------------------------------------- métier */

function normaliserLignes(lignes, idx) {
  const rendu = [];
  const erreurs = [];
  for (const l of lignes || []) {
    const sku = String(l.sku || '').trim().toUpperCase();
    const quantite = Number(l.quantite);
    if (!sku) continue;
    if (!idx[sku]) { erreurs.push(`SKU inconnu : ${sku}`); continue; }
    if (!Number.isFinite(quantite) || quantite <= 0) { erreurs.push(`Quantité invalide pour ${sku}`); continue; }
    const existante = rendu.find((r) => r.sku === sku);
    if (existante) { existante.quantite += quantite; continue; }
    rendu.push({
      sku,
      quantite,
      quantitePreparee: 0,
      statut: 'A_PRELEVER',
      commentaire: String(l.commentaire || ''),
    });
  }
  return { lignes: rendu, erreurs };
}

function avancement(commande) {
  const total = commande.lignes.length;
  const faites = commande.lignes.filter((l) => l.statut !== 'A_PRELEVER').length;
  return { total, faites, pourcent: total ? Math.round((faites / total) * 100) : 0 };
}

function enrichir(commande) {
  const idx = indexArticles();
  const parcours = calculerParcours(db.depot, idx, commande.lignes);
  return Object.assign({}, commande, { parcours, avancement: avancement(commande) });
}

/* ---------------------------------------------------------------- HTTP utils */

function json(res, code, corps) {
  const texte = JSON.stringify(corps);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(texte),
  });
  res.end(texte);
}

function lireCorps(req) {
  return new Promise((resolve, reject) => {
    let brut = '';
    req.on('data', (c) => {
      brut += c;
      if (brut.length > 2e6) { reject(new Error('Requête trop volumineuse')); req.destroy(); }
    });
    req.on('end', () => {
      if (!brut) return resolve({});
      try { resolve(JSON.parse(brut)); } catch (e) { reject(new Error('JSON invalide')); }
    });
    req.on('error', reject);
  });
}

const MIMES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function servirStatique(req, res, chemin) {
  const rel = chemin === '/' ? '/index.html' : chemin;
  const fichier = path.join(DOSSIER_PUBLIC, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!fichier.startsWith(DOSSIER_PUBLIC) || !fs.existsSync(fichier) || fs.statSync(fichier).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('404 — page introuvable');
  }
  res.writeHead(200, { 'Content-Type': MIMES[path.extname(fichier)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(fichier).pipe(res);
}

/* ------------------------------------------------------------------- routes */

async function api(req, res, url) {
  const segments = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const corps = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await lireCorps(req) : {};
  const acteur = String(corps.acteur || url.searchParams.get('acteur') || '').trim() || 'anonyme';

  // GET /api/etat
  if (req.method === 'GET' && segments[1] === 'etat' && segments.length === 2) {
    return json(res, 200, {
      version: db.version,
      depot: db.depot,
      articles: db.articles,
      commandes: db.commandes.map(enrichir),
      statuts: STATUTS,
      horodatage: maintenant(),
    });
  }

  // GET /api/commandes/:numero
  if (req.method === 'GET' && segments[1] === 'commandes' && segments[2]) {
    const c = trouverCommande(segments[2]);
    if (!c) return json(res, 404, { erreur: 'Commande introuvable' });
    return json(res, 200, enrichir(c));
  }

  // POST /api/commandes  (création par la comptabilité)
  if (req.method === 'POST' && segments[1] === 'commandes' && segments.length === 2) {
    const idx = indexArticles();
    const { lignes, erreurs } = normaliserLignes(corps.lignes, idx);
    if (!lignes.length) {
      return json(res, 400, { erreur: 'Aucune ligne valide', details: erreurs });
    }
    if (!String(corps.client || '').trim()) {
      return json(res, 400, { erreur: 'Le client est obligatoire' });
    }
    const commande = {
      numero: nouveauNumero(),
      client: String(corps.client).trim(),
      referenceClient: String(corps.referenceClient || '').trim(),
      adresse: String(corps.adresse || '').trim(),
      priorite: ['NORMALE', 'URGENTE'].includes(corps.priorite) ? corps.priorite : 'NORMALE',
      dateLivraison: String(corps.dateLivraison || '').trim(),
      commentaire: String(corps.commentaire || '').trim(),
      transporteur: String(corps.transporteur || '').trim(),
      statut: corps.envoyer ? 'A_PREPARER' : 'BROUILLON',
      cariste: '',
      creePar: acteur,
      creeLe: maintenant(),
      envoyeeLe: corps.envoyer ? maintenant() : '',
      prepareeLe: '',
      expedieeLe: '',
      lignes,
      historique: [],
    };
    journaliser(commande, acteur, 'Création de la commande', `${lignes.length} ligne(s)`);
    if (corps.envoyer) journaliser(commande, acteur, 'Envoi au dépôt');
    db.commandes.unshift(commande);
    sauver('commandes');
    return json(res, 201, { commande: enrichir(commande), avertissements: erreurs });
  }

  // POST /api/commandes/:numero/<action>
  if (req.method === 'POST' && segments[1] === 'commandes' && segments[2] && segments[3]) {
    const commande = trouverCommande(segments[2]);
    if (!commande) return json(res, 404, { erreur: 'Commande introuvable' });
    const action = segments[3];

    if (action === 'envoyer') {
      if (commande.statut !== 'BROUILLON') return json(res, 409, { erreur: 'Commande déjà envoyée au dépôt' });
      commande.statut = 'A_PREPARER';
      commande.envoyeeLe = maintenant();
      journaliser(commande, acteur, 'Envoi au dépôt');
    } else if (action === 'affecter') {
      if (!['A_PREPARER', 'EN_PREPARATION'].includes(commande.statut)) {
        return json(res, 409, { erreur: 'Cette commande n\'est pas à préparer' });
      }
      if (commande.cariste && commande.cariste !== acteur && !corps.forcer) {
        return json(res, 409, { erreur: `Déjà prise en charge par ${commande.cariste}` });
      }
      commande.cariste = acteur;
      commande.statut = 'EN_PREPARATION';
      commande.debutPreparation = commande.debutPreparation || maintenant();
      journaliser(commande, acteur, 'Prise en charge de la préparation');
    } else if (action === 'ligne') {
      const ligne = commande.lignes.find((l) => l.sku === String(corps.sku || '').toUpperCase());
      if (!ligne) return json(res, 404, { erreur: 'Ligne introuvable' });
      if (!['EN_PREPARATION', 'A_PREPARER'].includes(commande.statut)) {
        return json(res, 409, { erreur: 'La commande n\'est plus en préparation' });
      }
      const q = Number(corps.quantitePreparee);
      ligne.quantitePreparee = Number.isFinite(q) && q >= 0 ? Math.min(q, ligne.quantite) : ligne.quantite;
      if (corps.statut === 'A_PRELEVER') {
        ligne.quantitePreparee = 0;
        ligne.statut = 'A_PRELEVER';
      } else if (ligne.quantitePreparee === 0) {
        ligne.statut = 'MANQUANT';
      } else if (ligne.quantitePreparee < ligne.quantite) {
        ligne.statut = 'PARTIEL';
      } else {
        ligne.statut = 'PRELEVE';
      }
      if (typeof corps.commentaire === 'string') ligne.commentaire = corps.commentaire;
      journaliser(commande, acteur, `Ligne ${ligne.sku} → ${ligne.statut}`, `${ligne.quantitePreparee}/${ligne.quantite}`);
    } else if (action === 'terminer') {
      if (commande.statut !== 'EN_PREPARATION') return json(res, 409, { erreur: 'La commande n\'est pas en préparation' });
      const restantes = commande.lignes.filter((l) => l.statut === 'A_PRELEVER');
      if (restantes.length && !corps.forcer) {
        return json(res, 409, {
          erreur: `${restantes.length} ligne(s) non traitée(s)`,
          lignes: restantes.map((l) => l.sku),
        });
      }
      const idx = indexArticles();
      for (const l of commande.lignes) {
        const art = idx[l.sku];
        if (art) art.stock = Math.max(0, art.stock - (l.quantitePreparee || 0));
      }
      commande.statut = 'PREPAREE';
      commande.prepareeLe = maintenant();
      journaliser(commande, acteur, 'Préparation terminée', `${commande.lignes.filter((l) => l.statut === 'PRELEVE').length}/${commande.lignes.length} ligne(s) complètes`);
      sauver();
      return json(res, 200, { commande: enrichir(commande) });
    } else if (action === 'expedier') {
      if (commande.statut !== 'PREPAREE') return json(res, 409, { erreur: 'La commande n\'est pas préparée' });
      commande.statut = 'EXPEDIEE';
      commande.expedieeLe = maintenant();
      if (corps.transporteur) commande.transporteur = String(corps.transporteur).trim();
      journaliser(commande, acteur, 'Expédition', commande.transporteur);
    } else if (action === 'annuler') {
      if (['EXPEDIEE', 'ANNULEE'].includes(commande.statut)) return json(res, 409, { erreur: 'Commande déjà close' });
      commande.statut = 'ANNULEE';
      journaliser(commande, acteur, 'Annulation', String(corps.motif || ''));
    } else {
      return json(res, 404, { erreur: 'Action inconnue' });
    }

    sauver('commandes');
    return json(res, 200, { commande: enrichir(commande) });
  }

  // PATCH /api/commandes/:numero  (modification d'un brouillon)
  if (req.method === 'PATCH' && segments[1] === 'commandes' && segments[2]) {
    const commande = trouverCommande(segments[2]);
    if (!commande) return json(res, 404, { erreur: 'Commande introuvable' });
    if (commande.statut !== 'BROUILLON') return json(res, 409, { erreur: 'Seul un brouillon est modifiable' });
    for (const champ of ['client', 'referenceClient', 'adresse', 'dateLivraison', 'commentaire', 'transporteur', 'priorite']) {
      if (typeof corps[champ] === 'string') commande[champ] = corps[champ].trim();
    }
    if (Array.isArray(corps.lignes)) {
      const { lignes, erreurs } = normaliserLignes(corps.lignes, indexArticles());
      if (!lignes.length) return json(res, 400, { erreur: 'Aucune ligne valide', details: erreurs });
      commande.lignes = lignes;
    }
    journaliser(commande, acteur, 'Modification du brouillon');
    sauver('commandes');
    return json(res, 200, { commande: enrichir(commande) });
  }

  // PATCH /api/articles/:sku  (emplacement / stock)
  if (req.method === 'PATCH' && segments[1] === 'articles' && segments[2]) {
    const article = db.articles.find((a) => a.sku === segments[2].toUpperCase());
    if (!article) return json(res, 404, { erreur: 'Article introuvable' });
    if (typeof corps.emplacement === 'string' && corps.emplacement.trim()) {
      const { geometrie } = require('./lib/parcours');
      const geo = geometrie(db.depot, corps.emplacement);
      if (!geo || !geo.valide) return json(res, 400, { erreur: 'Emplacement inexistant dans le dépôt' });
      article.emplacement = corps.emplacement.trim().toUpperCase();
    }
    if (Number.isFinite(Number(corps.stock))) article.stock = Math.max(0, Number(corps.stock));
    sauver('articles');
    return json(res, 200, { article });
  }

  return json(res, 404, { erreur: 'Route inconnue' });
}

const serveur = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    api(req, res, url).catch((e) => json(res, 400, { erreur: e.message }));
    return;
  }
  if (req.method !== 'GET') {
    res.writeHead(405); return res.end();
  }
  servirStatique(req, res, url.pathname);
});

if (require.main === module) {
  serveur.listen(PORT, () => {
    console.log(`Préparation de commandes — ${db.depot.nom}`);
    console.log(`  ${db.articles.length} articles, ${db.commandes.length} commandes`);
    console.log(`  → http://localhost:${PORT}`);
  });
}

module.exports = { serveur, db };
