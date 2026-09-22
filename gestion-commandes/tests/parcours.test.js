'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { calculerParcours, geometrie } = require('../lib/parcours');

const depot = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'depot.json'), 'utf8'));
const catalogue = {};
for (const a of JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'articles.json'), 'utf8'))) {
  catalogue[a.sku] = a;
}

const codes = (r) => r.etapes.map((e) => e.emplacement);

test('un emplacement est traduit en coordonnées dans le dépôt', () => {
  const g = geometrie(depot, 'A-01-1');
  assert.ok(g.valide);
  assert.strictEqual(g.allee, 'A');
  assert.strictEqual(g.travee, 1);
  assert.strictEqual(g.niveau, 1);
  // le point de prélèvement est dans le couloir, pas dans le rack
  assert.ok(g.x > depot.allees[0].x + depot.allees[0].profondeur);
});

test('le parcours remonte un couloir puis redescend le suivant (serpentin)', () => {
  const r = calculerParcours(depot, catalogue, [
    { sku: 'VRT-0110', quantite: 1 }, // A-10, bas du couloir 1
    { sku: 'VRT-0103', quantite: 1 }, // A-03, haut du couloir 1
    { sku: 'VIV-0401', quantite: 1 }, // D-01, haut du couloir 2
    { sku: 'ARB-0308', quantite: 1 }, // C-08, bas du couloir 2
  ]);
  assert.deepStrictEqual(codes(r), ['A-10-1', 'A-03-2', 'D-01-2', 'C-08-1']);
});

test('les deux racks d\'un même couloir sont servis dans le même passage', () => {
  const r = calculerParcours(depot, catalogue, [
    { sku: 'FLR-0211', quantite: 1 }, // B-11
    { sku: 'VRT-0105', quantite: 1 }, // A-05
    { sku: 'OUT-0607', quantite: 1 }, // F-07, autre couloir
  ]);
  assert.deepStrictEqual(codes(r), ['B-11-3', 'A-05-2', 'F-07-1']);
});

test('à travée égale, le niveau bas est prélevé en premier', () => {
  const r = calculerParcours(depot, catalogue, [
    { sku: 'FLR-0201', quantite: 1 }, // B-01-2
    { sku: 'VRT-0101', quantite: 1 }, // A-01-1
  ]);
  assert.deepStrictEqual(codes(r), ['A-01-1', 'B-01-2']);
});

test('les pastilles du plan ne se superposent pas dans une même travée', () => {
  const r = calculerParcours(depot, catalogue, [
    { sku: 'FLR-0201', quantite: 1 }, // B-01-2
    { sku: 'VRT-0101', quantite: 1 }, // A-01-1 — même travée, autre rack
  ]);
  const [a, b] = r.etapes;
  assert.notStrictEqual(a.bx.toFixed(2), b.bx.toFixed(2));
});

test('le chemin part du poste de préparation et finit au quai d\'expédition', () => {
  const r = calculerParcours(depot, catalogue, [{ sku: 'SUB-0501', quantite: 2 }]);
  const premier = r.chemin[0];
  const dernier = r.chemin[r.chemin.length - 1];
  assert.deepStrictEqual([premier.x, premier.y], [depot.depart.x, depot.depart.y]);
  assert.deepStrictEqual([dernier.x, dernier.y], [depot.expedition.x, depot.expedition.y]);
  assert.ok(r.distance > 0 && r.dureeMinutes > 0);
});

test('un article inconnu ou mal rangé remonte en anomalie', () => {
  const r = calculerParcours(depot, { 'X-1': { sku: 'X-1', designation: 'Test', emplacement: 'Z-99-9', poids: 1, stock: 1 } }, [
    { sku: 'X-1', quantite: 1 },
    { sku: 'INTROUVABLE', quantite: 1 },
  ]);
  assert.strictEqual(r.etapes.length, 0);
  assert.strictEqual(r.anomalies.length, 2);
});

test('le poids et la charge lourde sont calculés par colis', () => {
  const r = calculerParcours(depot, catalogue, [
    { sku: 'SUB-0510', quantite: 4 },  // sable 25 kg le sac
    { sku: 'VRT-0103', quantite: 10 }, // pilea 0,8 kg
  ]);
  assert.strictEqual(r.poidsTotal, 108);
  assert.strictEqual(r.etapes.find((e) => e.sku === 'SUB-0510').lourd, true);
  assert.strictEqual(r.etapes.find((e) => e.sku === 'VRT-0103').lourd, false);
});
