/* Vue Dépôt : file des commandes à préparer et écran de picking pas à pas. */
'use strict';

(function () {
  let racine = null;
  let enCours = null;     // numéro de la commande en cours de préparation
  let etapeActive = null; // numéro d'ordre de l'étape sélectionnée

  /* ------------------------------------------------------------------ file */

  function aPreparer() {
    const rang = { URGENTE: 0, NORMALE: 1 };
    return App.etat.commandes
      .filter((c) => ['A_PREPARER', 'EN_PREPARATION'].includes(c.statut))
      .sort((a, b) => (
        rang[a.priorite] - rang[b.priorite]
        || String(a.dateLivraison).localeCompare(String(b.dateLivraison))
        || String(a.envoyeeLe).localeCompare(String(b.envoyeeLe))
      ));
  }

  function rendreFile() {
    const liste = aPreparer();
    const moi = App.acteur();
    racine.innerHTML = `
      <div class="carte">
        <header>
          <h2>Commandes à préparer</h2>
          <span class="sous-titre">${liste.length} commande(s) en attente — ${App.echap(App.etat.depot.nom)}</span>
        </header>
        ${liste.length ? `<div class="file">${liste.map((c) => `
          <article class="tuile ${c.priorite === 'URGENTE' ? 'urgente' : ''} ${c.statut === 'EN_PREPARATION' ? 'encours' : ''}"
                   data-numero="${App.echap(c.numero)}">
            <h3><span>${App.echap(c.numero)}</span>
              <span class="etiquette st-${c.statut}">${App.echap(App.LIBELLES[c.statut])}</span></h3>
            <div><b>${App.echap(c.client)}</b></div>
            <dl>
              <dt>Livraison</dt><dd>${App.jour(c.dateLivraison)}</dd>
              <dt>Lignes</dt><dd>${c.lignes.length} — ${c.parcours.poidsTotal} kg</dd>
              <dt>Parcours</dt><dd>${c.parcours.distance} m · ~${c.parcours.dureeMinutes} min</dd>
              ${c.cariste ? `<dt>Préparateur</dt><dd>${App.echap(c.cariste)}${c.cariste === moi ? ' (vous)' : ''}</dd>` : ''}
              ${c.priorite === 'URGENTE' ? '<dt>Priorité</dt><dd><span class="etiquette urgent">URGENT</span></dd>' : ''}
            </dl>
            ${c.commentaire ? `<div class="info" style="margin-bottom:.6rem">${App.echap(c.commentaire)}</div>` : ''}
            <div class="jauge"><i style="width:${c.avancement.pourcent}%"></i></div>
            <div class="actions" style="margin-top:.7rem">
              <button class="btn principal petit" data-prendre="${App.echap(c.numero)}">
                ${c.statut === 'EN_PREPARATION' ? 'Reprendre' : 'Prendre en charge'}</button>
            </div>
          </article>`).join('')}</div>`
        : '<div class="vide">Rien à préparer pour le moment. Les commandes envoyées par la comptabilité arrivent ici automatiquement.</div>'}
      </div>`;
  }

  /* --------------------------------------------------------------- picking */

  function etapeCourante(c) {
    const etapes = c.parcours.etapes;
    if (etapeActive && etapes.some((e) => e.ordre === etapeActive)) {
      return etapes.find((e) => e.ordre === etapeActive);
    }
    return etapes.find((e) => e.statut === 'A_PRELEVER') || etapes[etapes.length - 1] || null;
  }

  function rendrePicking() {
    const c = App.commande(enCours);
    if (!c) { enCours = null; return rendreFile(); }
    const p = c.parcours;
    const active = etapeCourante(c);
    const restantes = p.etapes.filter((e) => e.statut === 'A_PRELEVER').length;

    racine.innerHTML = `
      <div class="bandeau-prep">
        <div><div class="libelle">Commande</div><div class="chiffre">${App.echap(c.numero)}</div></div>
        <div><div class="libelle">Client</div><div><b>${App.echap(c.client)}</b></div></div>
        <div><div class="libelle">Restant</div><div class="chiffre">${restantes}</div></div>
        <div><div class="libelle">Parcours</div><div>${p.distance} m · ~${p.dureeMinutes} min · ${p.poidsTotal} kg</div></div>
        <div class="jauge"><i style="width:${c.avancement.pourcent}%"></i></div>
        <div class="actions">
          <button class="btn petit" data-act="imprimer">Imprimer</button>
          <button class="btn principal petit" data-act="terminer">Terminer la préparation</button>
          <button class="btn petit" data-act="retour">Retour à la file</button>
        </div>
      </div>

      ${c.commentaire ? `<div class="info" style="margin-bottom:.8rem"><b>Consigne :</b> ${App.echap(c.commentaire)}</div>` : ''}
      ${p.anomalies.length ? `<div class="erreur">${p.anomalies.map((a) => App.echap(`${a.sku} : ${a.message}`)).join('<br>')}</div>` : ''}

      <div class="colonnes-plan">
        <div>${p.etapes.map((e) => rendreEtape(e, active)).join('')}</div>
        <div style="position:sticky;top:70px">
          <div class="plan-boite">
            ${Plan.dessiner({ depot: App.etat.depot, etapes: p.etapes, chemin: p.chemin, etapeActive: active ? active.ordre : null })}
            ${Plan.legende()}
          </div>
          ${active ? `<div class="elevation" style="margin-top:.8rem">${Plan.elevation(App.etat.depot, active)}</div>` : ''}
        </div>
      </div>`;
  }

  function rendreEtape(e, active) {
    const classe = e.statut === 'PRELEVE' ? 'faite'
      : e.statut === 'MANQUANT' ? 'manquant'
        : e.statut === 'PARTIEL' ? 'partiel' : '';
    const estActive = active && active.ordre === e.ordre;
    return `<div class="etape ${classe} ${estActive ? 'active' : ''}" data-ordre="${e.ordre}" data-sku="${App.echap(e.sku)}">
      <div class="rang">${e.statut === 'PRELEVE' ? '✓' : e.ordre}</div>
      <div>
        <span class="emplacement gros">${App.echap(e.emplacement)}</span>
        <div class="meta">allée ${App.echap(e.allee)} · travée ${String(e.travee).padStart(2, '0')} · niveau ${e.niveau}/${e.niveaux}</div>
      </div>
      <div>
        <div class="designation">${App.echap(e.designation)}</div>
        <div class="meta">${App.echap(e.sku)} · ${App.echap(e.conditionnement)} · ${App.echap(e.alleeNom)}
          ${e.lourd ? ' · <b>⚠ charge lourde</b>' : ''}
          ${e.stockInsuffisant ? ` · <b style="color:var(--rouge)">stock ${e.stock} insuffisant</b>` : ''}</div>
        ${e.commentaire ? `<div class="meta"><i>${App.echap(e.commentaire)}</i></div>` : ''}
      </div>
      <div>
        <div class="qte">${e.statut === 'A_PRELEVER' ? e.quantite : `${e.quantitePreparee}/${e.quantite}`}
          <small>${App.echap(e.unite)}</small></div>
        <div class="boutons" style="margin-top:.4rem">
          ${e.statut === 'A_PRELEVER' ? `
            <button class="btn principal petit" data-ligne="pris">Pris</button>
            <button class="btn petit" data-ligne="partiel">Partiel</button>
            <button class="btn danger petit" data-ligne="manquant">Manquant</button>`
      : '<button class="btn petit" data-ligne="reprendre">↺ Corriger</button>'}
        </div>
      </div>
    </div>`;
  }

  /* --------------------------------------------------------------- actions */

  async function prendre(numero) {
    try {
      await App.api.action(numero, 'affecter', {});
      enCours = numero;
      etapeActive = null;
      await App.apresAction();
    } catch (e) {
      if (/pris/i.test(e.message) && confirm(`${e.message}. Reprendre quand même cette commande ?`)) {
        await App.api.action(numero, 'affecter', { forcer: true });
        enCours = numero;
        await App.apresAction();
      } else {
        App.toast(e.message, 'erreur');
      }
    }
  }

  async function majLigne(sku, quoi) {
    const c = App.commande(enCours);
    const ligne = c && c.lignes.find((l) => l.sku === sku);
    if (!ligne) return;
    let corps;
    if (quoi === 'pris') corps = { sku, quantitePreparee: ligne.quantite };
    else if (quoi === 'manquant') corps = { sku, quantitePreparee: 0 };
    else if (quoi === 'reprendre') corps = { sku, statut: 'A_PRELEVER' };
    else {
      const saisie = prompt(`Quantité réellement prélevée (commandé : ${ligne.quantite}) ?`, String(ligne.quantite));
      if (saisie === null) return;
      const q = Number(saisie.replace(',', '.'));
      if (!Number.isFinite(q) || q < 0) return App.toast('Quantité invalide', 'erreur');
      corps = { sku, quantitePreparee: q };
    }
    if (quoi === 'manquant' || quoi === 'partiel') {
      const motif = prompt('Motif (rupture, casse, emplacement vide…) — facultatif', ligne.commentaire || '');
      if (motif !== null) corps.commentaire = motif;
    }
    try {
      await App.api.action(enCours, 'ligne', corps);
      etapeActive = null; // on avance automatiquement au prochain prélèvement
      await App.apresAction();
    } catch (e) {
      App.toast(e.message, 'erreur');
    }
  }

  async function terminer(forcer) {
    try {
      await App.api.action(enCours, 'terminer', { forcer: !!forcer });
      App.toast(`${enCours} préparée — la comptabilité est informée`, 'succes');
      enCours = null;
      etapeActive = null;
      await App.apresAction();
    } catch (e) {
      const skus = (e.donnees && e.donnees.lignes) || [];
      if (skus.length && confirm(`${e.message} (${skus.join(', ')}).\n\nTerminer quand même en les déclarant manquantes ?`)) {
        for (const sku of skus) {
          await App.api.action(enCours, 'ligne', { sku, quantitePreparee: 0, commentaire: 'Non traité en préparation' });
        }
        return terminer(true);
      }
      App.toast(e.message, 'erreur');
    }
  }

  /* -------------------------------------------------------------- montage */

  function monter(el) {
    racine = el;
    el.addEventListener('click', (e) => {
      const prendreBtn = e.target.closest('[data-prendre]');
      if (prendreBtn) return prendre(prendreBtn.dataset.prendre);

      const tuile = e.target.closest('.tuile[data-numero]');
      if (tuile && !enCours) return prendre(tuile.dataset.numero);

      const act = e.target.closest('[data-act]');
      if (act) {
        if (act.dataset.act === 'retour') { enCours = null; etapeActive = null; return rendreFile(); }
        if (act.dataset.act === 'terminer') return terminer(false);
        if (act.dataset.act === 'imprimer') return App.imprimer(Impression.bonPreparation(App.commande(enCours)));
      }

      const btnLigne = e.target.closest('[data-ligne]');
      if (btnLigne) {
        const etape = btnLigne.closest('.etape');
        return majLigne(etape.dataset.sku, btnLigne.dataset.ligne);
      }

      const etape = e.target.closest('.etape[data-ordre]');
      if (etape) { etapeActive = Number(etape.dataset.ordre); return rendrePicking(); }

      const caseplan = e.target.closest('[data-emplacement]');
      if (caseplan && enCours) {
        const c = App.commande(enCours);
        const trouve = c.parcours.etapes.find((x) => Plan.cle(x.allee, x.travee) === caseplan.dataset.emplacement);
        if (trouve) { etapeActive = trouve.ordre; rendrePicking(); }
      }
    });
  }

  function rafraichir() {
    if (!racine || !App.etat.charge) return;
    if (enCours && !App.commande(enCours)) enCours = null;
    const c = enCours ? App.commande(enCours) : null;
    if (c && !['A_PREPARER', 'EN_PREPARATION'].includes(c.statut)) enCours = null;
    if (enCours) rendrePicking(); else rendreFile();
  }

  App.enregistrerVue('cariste', { monter, rafraichir, ouvrir: (n) => { enCours = n; } });
}());
