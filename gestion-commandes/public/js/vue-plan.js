/* Vue Plan du dépôt : cartographie des emplacements et tracé d'un parcours. */
'use strict';

const VuePlan = (function () {
  let racine = null;
  let numero = '';        // commande affichée sur le plan
  let caseChoisie = '';   // "A-03"

  function occupation() {
    const par = new Map();
    for (const a of App.etat.articles) {
      const k = a.emplacement.replace(/-(\d+)$/, '');
      if (!par.has(k)) par.set(k, []);
      par.get(k).push(a);
    }
    return par;
  }

  function rendre() {
    const c = numero ? App.commande(numero) : null;
    const p = c ? c.parcours : null;
    const candidates = App.etat.commandes.filter((x) => !['ANNULEE'].includes(x.statut));

    racine.innerHTML = `
      <div class="colonnes-plan">
        <div class="carte">
          <header>
            <h2>${App.echap(App.etat.depot.nom)}</h2>
            <select id="plan-commande" style="width:auto">
              <option value="">— Plan seul (aucun parcours) —</option>
              ${candidates.map((x) => `<option value="${App.echap(x.numero)}" ${x.numero === numero ? 'selected' : ''}>
                ${App.echap(x.numero)} — ${App.echap(x.client)} (${App.echap(App.LIBELLES[x.statut])})</option>`).join('')}
            </select>
          </header>
          <div class="plan-boite">
            ${Plan.dessiner({
              depot: App.etat.depot,
              etapes: p ? p.etapes : [],
              chemin: p ? p.chemin : null,
              interactif: true,
            })}
          </div>
          ${Plan.legende()}
          <p class="sous-titre" style="margin-top:.5rem">
            Cliquez sur une travée pour voir ce qui y est stocké. Les racks sont numérotés par allée (A à F),
            puis par travée (01 à 11) et par niveau.
          </p>
        </div>
        <div>
          ${p ? `<div class="carte">
            <header><h2>Parcours ${App.echap(c.numero)}</h2>
              <span class="etiquette st-${c.statut}">${App.echap(App.LIBELLES[c.statut])}</span></header>
            <div class="info" style="margin-bottom:.7rem">
              ${p.etapes.length} arrêt(s) · ${p.distance} m · ~${p.dureeMinutes} min · ${p.poidsTotal} kg
            </div>
            <table><thead><tr><th>#</th><th>Emplacement</th><th>Article</th><th class="num">Qté</th></tr></thead>
              <tbody>${p.etapes.map((e) => `<tr>
                <td><b>${e.ordre}</b></td>
                <td><span class="emplacement">${App.echap(e.emplacement)}</span></td>
                <td>${App.echap(e.designation)}<div class="sous-titre">${App.echap(e.sku)}</div></td>
                <td class="num">${e.quantite}</td></tr>`).join('')}</tbody></table>
            <div class="actions" style="margin-top:.8rem">
              <button class="btn petit" id="plan-imprimer">Imprimer le bon + plan</button>
            </div>
          </div>` : ''}
          <div class="carte" id="plan-detail-case">${detailCase()}</div>
        </div>
      </div>`;
  }

  function detailCase() {
    if (!caseChoisie) {
      return '<header><h2>Contenu d\'une travée</h2></header><div class="vide">Sélectionnez une travée sur le plan.</div>';
    }
    const arts = (occupation().get(caseChoisie) || []).sort((a, b) => a.emplacement.localeCompare(b.emplacement));
    const allee = App.etat.depot.allees.find((a) => a.code === caseChoisie.split('-')[0]);
    return `<header><h2>Travée ${App.echap(caseChoisie)}</h2>
        <span class="sous-titre">${App.echap(allee ? allee.nom : '')}</span></header>
      ${arts.length ? `<table><thead><tr><th>Niveau</th><th>Réf.</th><th>Article</th><th class="num">Stock</th></tr></thead>
        <tbody>${arts.map((a) => `<tr>
          <td><span class="emplacement">N${App.echap(a.emplacement.split('-')[2] || '1')}</span></td>
          <td>${App.echap(a.sku)}</td>
          <td>${App.echap(a.designation)}<div class="sous-titre">${App.echap(a.conditionnement)}</div></td>
          <td class="num ${a.stock <= a.seuil ? 'alerte' : ''}">${a.stock}</td></tr>`).join('')}</tbody></table>`
        : '<div class="vide">Emplacement libre.</div>'}`;
  }

  function monter(el) {
    racine = el;
    el.addEventListener('change', (e) => {
      if (e.target.id === 'plan-commande') { numero = e.target.value; caseChoisie = ''; rendre(); }
    });
    el.addEventListener('click', (e) => {
      const c = e.target.closest('[data-emplacement]');
      if (c) { caseChoisie = c.dataset.emplacement; el.querySelector('#plan-detail-case').innerHTML = detailCase(); return; }
      if (e.target.id === 'plan-imprimer') App.imprimer(Impression.bonPreparation(App.commande(numero)));
    });
  }

  function rafraichir() {
    if (!racine || !App.etat.charge) return;
    if (numero && !App.commande(numero)) numero = '';
    rendre();
  }

  App.enregistrerVue('plan', { monter, rafraichir });

  return { montrer: (n) => { numero = n; } };
}());
