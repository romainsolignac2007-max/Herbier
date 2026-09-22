'use strict';
/**
 * Calcul du parcours de préparation dans le dépôt.
 *
 * Le dépôt est décrit en mètres (data/depot.json). Chaque allée est un rack
 * découpé en travées (le long de l'axe Y) et en niveaux (hauteur).
 * Un emplacement s'écrit ALLEE-TRAVEE-NIVEAU, par exemple "C-04-2".
 *
 * Le parcours est un « serpentin » (S-shape) : le préparateur remonte un
 * couloir, redescend le suivant, etc. Les deux racks qui bordent un même
 * couloir sont servis dans le même passage.
 */

const MARGE_COULOIR = 1.4; // distance entre le bout d'un rack et le couloir transversal

function parserEmplacement(code) {
  const m = /^([A-Z]+)-(\d+)(?:-(\d+))?$/.exec(String(code || '').trim().toUpperCase());
  if (!m) return null;
  return { allee: m[1], travee: Number(m[2]), niveau: m[3] ? Number(m[3]) : 1 };
}

function formaterEmplacement(allee, travee, niveau) {
  return `${allee}-${String(travee).padStart(2, '0')}-${niveau}`;
}

/** Géométrie d'un emplacement : point de prélèvement dans le couloir. */
function geometrie(depot, code) {
  const e = parserEmplacement(code);
  if (!e) return null;
  const allee = depot.allees.find((a) => a.code === e.allee);
  if (!allee) return null;
  const h = depot.hauteurTravee;
  const yCentre = allee.y + (e.travee - 0.5) * h;
  const couloirX = allee.couloir === 'gauche'
    ? allee.x - 1.8
    : allee.x + allee.profondeur + 1.8;
  const cote = allee.couloir === 'droite' ? -1 : 1; // de quel côté du couloir est le rack
  return {
    allee: allee.code,
    alleeNom: allee.nom,
    couleur: allee.couleur,
    travee: e.travee,
    niveau: e.niveau,
    niveaux: allee.niveaux,
    travees: allee.travees,
    valide: e.travee >= 1 && e.travee <= allee.travees && e.niveau >= 1 && e.niveau <= allee.niveaux,
    // centre de la case dans le rack (pour le plan)
    rackX: allee.x + allee.profondeur / 2,
    rackY: yCentre,
    // point où se tient le préparateur
    x: couloirX,
    y: yCentre,
    couloirX,
    // pastille du parcours : décalée du couloir vers le rack, pour ne pas
    // superposer les deux racks qui bordent le même couloir
    bx: couloirX + cote * 0.9,
    by: yCentre,
  };
}

/** Bornes hautes/basses du couloir (points d'entrée et de sortie). */
function bornesCouloir(depot, couloirX) {
  const allees = depot.allees.filter((a) => {
    const gx = a.couloir === 'gauche' ? a.x - 1.8 : a.x + a.profondeur + 1.8;
    return Math.abs(gx - couloirX) < 0.01;
  });
  const h = depot.hauteurTravee;
  const haut = Math.min(...allees.map((a) => a.y)) - MARGE_COULOIR;
  const bas = Math.max(...allees.map((a) => a.y + a.travees * h)) + MARGE_COULOIR;
  return { haut, bas };
}

function distance(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * @param {object} depot
 * @param {Map|object} catalogue index sku -> article
 * @param {Array} lignes lignes de commande {sku, quantite, quantitePreparee, statut}
 * @returns {{etapes:Array, chemin:Array, distance:number, dureeMinutes:number, poidsTotal:number, anomalies:Array}}
 */
function calculerParcours(depot, catalogue, lignes) {
  const get = (sku) => (catalogue instanceof Map ? catalogue.get(sku) : catalogue[sku]);
  const anomalies = [];
  const items = [];

  for (const ligne of lignes || []) {
    const article = get(ligne.sku);
    if (!article) {
      anomalies.push({ sku: ligne.sku, message: 'Article inconnu au catalogue' });
      continue;
    }
    const geo = geometrie(depot, article.emplacement);
    if (!geo || !geo.valide) {
      anomalies.push({ sku: ligne.sku, message: `Emplacement invalide (${article.emplacement})` });
      continue;
    }
    items.push({ ligne, article, geo });
  }

  // Regroupement par couloir : les deux racks d'un même couloir sont servis ensemble.
  const couloirs = new Map();
  for (const it of items) {
    const cle = it.geo.couloirX.toFixed(2);
    if (!couloirs.has(cle)) couloirs.set(cle, { x: it.geo.couloirX, items: [] });
    couloirs.get(cle).items.push(it);
  }

  const depart = depot.depart;
  const listeCouloirs = [...couloirs.values()].sort(
    (a, b) => Math.abs(a.x - depart.x) - Math.abs(b.x - depart.x)
  );

  // Serpentin : on part du côté du poste de préparation et on alterne.
  let versLeHaut = depart.y > depot.hauteur / 2;
  const etapes = [];
  const chemin = [{ x: depart.x, y: depart.y, type: 'depart', libelle: depart.libelle }];
  let position = { x: depart.x, y: depart.y };
  let metres = 0;

  const avancer = (point, extra) => {
    // déplacement orthogonal : on longe d'abord le couloir transversal
    if (Math.abs(point.x - position.x) > 0.01 && Math.abs(point.y - position.y) > 0.01) {
      const coin = { x: point.x, y: position.y, type: 'coin' };
      metres += distance(position, coin);
      chemin.push(coin);
      position = coin;
    }
    metres += distance(position, point);
    chemin.push(Object.assign({ x: point.x, y: point.y }, extra));
    position = point;
  };

  for (const couloir of listeCouloirs) {
    const bornes = bornesCouloir(depot, couloir.x);
    const entree = versLeHaut ? bornes.bas : bornes.haut;
    const sortie = versLeHaut ? bornes.haut : bornes.bas;

    // On descend ou on remonte le couloir ; à travée égale, le niveau bas d'abord.
    couloir.items.sort((a, b) => {
      if (Math.abs(a.geo.y - b.geo.y) > 0.01) {
        return versLeHaut ? b.geo.y - a.geo.y : a.geo.y - b.geo.y;
      }
      return a.geo.niveau - b.geo.niveau;
    });

    avancer({ x: couloir.x, y: entree }, { type: 'entree' });
    for (const it of couloir.items) {
      const ordre = etapes.length + 1;
      avancer({ x: it.geo.x, y: it.geo.y }, { type: 'prelevement', ordre });
      etapes.push({
        ordre,
        sku: it.article.sku,
        designation: it.article.designation,
        categorie: it.article.categorie,
        unite: it.article.unite,
        conditionnement: it.article.conditionnement,
        poids: it.article.poids,
        stock: it.article.stock,
        emplacement: it.article.emplacement,
        allee: it.geo.allee,
        alleeNom: it.geo.alleeNom,
        couleur: it.geo.couleur,
        travee: it.geo.travee,
        niveau: it.geo.niveau,
        niveaux: it.geo.niveaux,
        travees: it.geo.travees,
        x: it.geo.x,
        y: it.geo.y,
        bx: it.geo.bx,
        by: it.geo.by,
        rackX: it.geo.rackX,
        rackY: it.geo.rackY,
        quantite: it.ligne.quantite,
        quantitePreparee: it.ligne.quantitePreparee || 0,
        statut: it.ligne.statut || 'A_PRELEVER',
        commentaire: it.ligne.commentaire || '',
        stockInsuffisant: it.article.stock < it.ligne.quantite,
        lourd: it.article.poids >= 15, // colis lourd : manutention à deux ou chariot
      });
    }
    avancer({ x: couloir.x, y: sortie }, { type: 'sortie' });
    versLeHaut = !versLeHaut;
  }

  avancer({ x: depot.expedition.x, y: depot.expedition.y }, {
    type: 'expedition', libelle: depot.expedition.libelle,
  });

  // Deux articles dans la même travée : on écarte les pastilles verticalement.
  const paquets = new Map();
  for (const e of etapes) {
    const k = `${e.bx.toFixed(2)}|${e.by.toFixed(2)}`;
    if (!paquets.has(k)) paquets.set(k, []);
    paquets.get(k).push(e);
  }
  for (const groupe of paquets.values()) {
    if (groupe.length < 2) continue;
    groupe.forEach((e, i) => { e.by += (i - (groupe.length - 1) / 2) * 0.8; });
  }

  const poidsTotal = etapes.reduce((s, e) => s + e.poids * e.quantite, 0);
  const dureeMinutes = Math.ceil(
    (metres / (depot.vitesseMarche || 0.9) + etapes.length * (depot.tempsPrelevement || 25)) / 60
  );

  return {
    etapes,
    chemin,
    distance: Math.round(metres),
    dureeMinutes,
    poidsTotal: Math.round(poidsTotal * 10) / 10,
    anomalies,
  };
}

module.exports = {
  calculerParcours,
  geometrie,
  parserEmplacement,
  formaterEmplacement,
  bornesCouloir,
  MARGE_COULOIR,
};
