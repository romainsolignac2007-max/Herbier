'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Le serveur travaille sur une copie jetable des données.
const source = path.join(__dirname, '..', 'data');
const bac = fs.mkdtempSync(path.join(os.tmpdir(), 'depot-test-'));
for (const f of fs.readdirSync(source)) fs.copyFileSync(path.join(source, f), path.join(bac, f));
process.env.DATA_DIR = bac;

const { serveur } = require('../server');

let base;
test.before(async () => {
  await new Promise((r) => serveur.listen(0, r));
  base = `http://localhost:${serveur.address().port}`;
});
test.after(() => { serveur.close(); fs.rmSync(bac, { recursive: true, force: true }); });

async function appel(methode, chemin, corps) {
  const rep = await fetch(base + chemin, {
    method: methode,
    headers: corps ? { 'Content-Type': 'application/json' } : {},
    body: corps ? JSON.stringify(corps) : undefined,
  });
  return { code: rep.status, corps: await rep.json() };
}

test('le cycle complet comptabilité → cariste → expédition fonctionne', async () => {
  const creation = await appel('POST', '/api/commandes', {
    acteur: 'Comptabilité',
    client: 'Client de test',
    lignes: [{ sku: 'SUB-0510', quantite: 4 }, { sku: 'VRT-0103', quantite: 2 }],
    envoyer: true,
  });
  assert.strictEqual(creation.code, 201);
  const numero = creation.corps.commande.numero;
  assert.strictEqual(creation.corps.commande.statut, 'A_PREPARER');
  assert.strictEqual(creation.corps.commande.parcours.etapes.length, 2);

  const avant = (await appel('GET', '/api/etat')).corps.articles.find((a) => a.sku === 'SUB-0510').stock;

  assert.strictEqual((await appel('POST', `/api/commandes/${numero}/affecter`, { acteur: 'Karim' })).code, 200);
  assert.strictEqual((await appel('POST', `/api/commandes/${numero}/ligne`,
    { acteur: 'Karim', sku: 'SUB-0510', quantitePreparee: 4 })).code, 200);

  // il reste une ligne à traiter : la clôture doit être refusée
  const refus = await appel('POST', `/api/commandes/${numero}/terminer`, { acteur: 'Karim' });
  assert.strictEqual(refus.code, 409);
  assert.deepStrictEqual(refus.corps.lignes, ['VRT-0103']);

  assert.strictEqual((await appel('POST', `/api/commandes/${numero}/ligne`,
    { acteur: 'Karim', sku: 'VRT-0103', quantitePreparee: 1, commentaire: 'casse' })).code, 200);

  const fin = await appel('POST', `/api/commandes/${numero}/terminer`, { acteur: 'Karim' });
  assert.strictEqual(fin.corps.commande.statut, 'PREPAREE');
  assert.strictEqual(fin.corps.commande.lignes.find((l) => l.sku === 'VRT-0103').statut, 'PARTIEL');

  const apres = (await appel('GET', '/api/etat')).corps.articles.find((a) => a.sku === 'SUB-0510').stock;
  assert.strictEqual(apres, avant - 4, 'le stock doit être décrémenté du quantité préparée');

  const expedition = await appel('POST', `/api/commandes/${numero}/expedier`, { acteur: 'Comptabilité' });
  assert.strictEqual(expedition.corps.commande.statut, 'EXPEDIEE');
  assert.ok(expedition.corps.commande.historique.length >= 5);
});

test('une commande sans ligne valide est refusée', async () => {
  const r = await appel('POST', '/api/commandes', { client: 'X', lignes: [{ sku: 'INCONNU', quantite: 1 }] });
  assert.strictEqual(r.code, 400);
});

test('un brouillon n\'apparaît pas comme à préparer tant qu\'il n\'est pas envoyé', async () => {
  const r = await appel('POST', '/api/commandes', {
    client: 'Brouillon SARL', lignes: [{ sku: 'POT-0601', quantite: 1 }],
  });
  assert.strictEqual(r.corps.commande.statut, 'BROUILLON');
  const envoi = await appel('POST', `/api/commandes/${r.corps.commande.numero}/envoyer`, { acteur: 'Compta' });
  assert.strictEqual(envoi.corps.commande.statut, 'A_PREPARER');
  const double = await appel('POST', `/api/commandes/${r.corps.commande.numero}/envoyer`, { acteur: 'Compta' });
  assert.strictEqual(double.code, 409);
});

test('un emplacement inexistant est refusé lors du rangement', async () => {
  const ko = await appel('PATCH', '/api/articles/VRT-0103', { emplacement: 'Z-99-9' });
  assert.strictEqual(ko.code, 400);
  const ok = await appel('PATCH', '/api/articles/VRT-0103', { emplacement: 'A-04-3', stock: 12 });
  assert.strictEqual(ok.code, 200);
  assert.strictEqual(ok.corps.article.emplacement, 'A-04-3');
  assert.strictEqual(ok.corps.article.stock, 12);
});

test('les fichiers statiques sont servis, sans échappatoire hors du dossier public', async () => {
  assert.strictEqual((await fetch(`${base}/`)).status, 200);
  assert.strictEqual((await fetch(`${base}/js/app.js`)).status, 200);
  assert.strictEqual((await fetch(`${base}/../server.js`)).status, 404);
});
