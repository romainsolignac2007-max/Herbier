/* Vue Comptabilité : saisie des commandes, envoi au dépôt, suivi, documents. */
'use strict';

(function () {
  let racine = null;
  let selection = null;

  /* ------------------------------------------------------------- squelette */

  function squelette() {
    return `
    <div class="colonnes">
      <div>
        <div class="carte">
          <header>
            <h2>Nouvelle commande</h2>
            <span class="sous-titre">saisie comptabilité</span>
          </header>
          <div id="erreurs-saisie"></div>
          <div class="champs">
            <div class="large"><label for="f-client">Client *</label><input id="f-client" placeholder="Raison sociale"></div>
            <div><label for="f-ref">Référence client</label><input id="f-ref" placeholder="N° bon de commande"></div>
            <div><label for="f-date">Livraison souhaitée</label><input id="f-date" type="date"></div>
            <div class="large"><label for="f-adresse">Adresse de livraison</label><input id="f-adresse" placeholder="Rue, code postal, ville"></div>
            <div><label for="f-priorite">Priorité</label>
              <select id="f-priorite"><option value="NORMALE">Normale</option><option value="URGENTE">Urgente</option></select>
            </div>
            <div><label for="f-transporteur">Transporteur</label><input id="f-transporteur" placeholder="Transporteur / retrait"></div>
            <div class="large"><label for="f-commentaire">Consigne pour le dépôt</label><textarea id="f-commentaire" placeholder="Ex. : livraison avant 10 h, hayon obligatoire"></textarea></div>
          </div>

          <h3>Articles</h3>
          <table class="lignes-saisie">
            <thead><tr><th>Article</th><th style="width:78px" class="num">Qté</th><th style="width:34px"></th></tr></thead>
            <tbody id="lignes-saisie"></tbody>
          </table>
          <div class="actions" style="margin-top:.6rem">
            <button class="btn petit" id="ajouter-ligne">+ Ajouter une ligne</button>
            <button class="btn petit" id="basculer-collage">Coller une liste</button>
          </div>
          <div id="zone-collage" hidden style="margin-top:.6rem">
            <label for="f-collage">Une ligne par article : <code>RÉFÉRENCE ; QUANTITÉ</code></label>
            <textarea id="f-collage" rows="4" placeholder="SUB-0501 ; 30&#10;VRT-0101 ; 6"></textarea>
            <div class="actions" style="margin-top:.4rem"><button class="btn petit" id="importer-collage">Importer ces lignes</button></div>
          </div>

          <hr style="border:0;border-top:1px solid var(--bord);margin:1rem 0">
          <div class="actions">
            <button class="btn principal" id="creer-envoyer">Envoyer au dépôt</button>
            <button class="btn" id="creer-brouillon">Enregistrer en brouillon</button>
            <button class="btn" id="vider-saisie">Vider</button>
          </div>
        </div>
      </div>

      <div>
        <div class="carte">
          <header>
            <h2>Commandes</h2>
            <select id="filtre-statut" style="width:auto">
              <option value="">Tous les statuts</option>
              <option value="EN_COURS">En cours (non closes)</option>
              <option value="BROUILLON">Brouillons</option>
              <option value="A_PREPARER">À préparer</option>
              <option value="EN_PREPARATION">En préparation</option>
              <option value="PREPAREE">Préparées</option>
              <option value="EXPEDIEE">Expédiées</option>
              <option value="ANNULEE">Annulées</option>
            </select>
          </header>
          <div id="tableau-commandes"></div>
        </div>
        <div id="detail-commande"></div>
      </div>
    </div>`;
  }

  /* ------------------------------------------------------- saisie de lignes */

  function ligneHtml() {
    return `<tr>
      <td class="suggestions">
        <input class="sku" placeholder="Référence ou nom d'article" autocomplete="off">
        <div class="meta sous-titre desi"></div>
        <ul hidden></ul>
      </td>
      <td><input class="qte" type="number" min="1" step="1" value="1"></td>
      <td><button class="btn petit supprimer" title="Supprimer la ligne">✕</button></td>
    </tr>`;
  }

  function ajouterLigne(sku, quantite) {
    const corps = racine.querySelector('#lignes-saisie');
    corps.insertAdjacentHTML('beforeend', ligneHtml());
    const tr = corps.lastElementChild;
    if (sku) {
      tr.querySelector('.sku').value = sku;
      tr.querySelector('.qte').value = quantite || 1;
      majDesignation(tr);
    }
    return tr;
  }

  function majDesignation(tr) {
    const sku = tr.querySelector('.sku').value.trim().toUpperCase();
    const a = App.article(sku);
    const cible = tr.querySelector('.desi');
    if (a) {
      cible.innerHTML = `${App.echap(a.designation)} — <span class="emplacement">${App.echap(a.emplacement)}</span>
        · stock ${a.stock} ${App.echap(a.unite)}`;
    } else {
      cible.textContent = sku ? 'Référence inconnue au catalogue' : '';
    }
  }

  function chercher(terme) {
    const t = terme.trim().toLowerCase();
    if (!t) return [];
    return App.etat.articles.filter((a) => (
      a.sku.toLowerCase().includes(t) || a.designation.toLowerCase().includes(t) || a.categorie.toLowerCase().includes(t)
    )).slice(0, 8);
  }

  function afficherSuggestions(tr) {
    const input = tr.querySelector('.sku');
    const ul = tr.querySelector('ul');
    const res = chercher(input.value);
    if (!res.length) { ul.hidden = true; ul.innerHTML = ''; return; }
    ul.innerHTML = res.map((a) => (
      `<li data-sku="${App.echap(a.sku)}"><b>${App.echap(a.sku)}</b> — ${App.echap(a.designation)}
        <span class="sous-titre">(${App.echap(a.emplacement)}, stock ${a.stock})</span></li>`
    )).join('');
    ul.hidden = false;
  }

  function lignesSaisies() {
    return [...racine.querySelectorAll('#lignes-saisie tr')].map((tr) => ({
      sku: tr.querySelector('.sku').value.trim().toUpperCase(),
      quantite: Number(tr.querySelector('.qte').value),
    })).filter((l) => l.sku);
  }

  function viderSaisie() {
    ['f-client', 'f-ref', 'f-adresse', 'f-date', 'f-transporteur', 'f-commentaire', 'f-collage'].forEach((id) => {
      const el = racine.querySelector(`#${id}`);
      if (el) el.value = '';
    });
    racine.querySelector('#f-priorite').value = 'NORMALE';
    racine.querySelector('#lignes-saisie').innerHTML = '';
    racine.querySelector('#erreurs-saisie').innerHTML = '';
    ajouterLigne();
  }

  async function creer(envoyer) {
    const zone = racine.querySelector('#erreurs-saisie');
    zone.innerHTML = '';
    const lignes = lignesSaisies();
    const client = racine.querySelector('#f-client').value.trim();
    const soucis = [];
    if (!client) soucis.push('Le nom du client est obligatoire.');
    if (!lignes.length) soucis.push('Ajoutez au moins un article.');
    lignes.forEach((l) => {
      if (!App.article(l.sku)) soucis.push(`Référence inconnue : ${l.sku}`);
      else if (!(l.quantite > 0)) soucis.push(`Quantité invalide pour ${l.sku}`);
    });
    if (soucis.length) {
      zone.innerHTML = `<div class="erreur">${soucis.map(App.echap).join('<br>')}</div>`;
      return;
    }
    try {
      const rep = await App.api.creer({
        client,
        referenceClient: racine.querySelector('#f-ref').value,
        adresse: racine.querySelector('#f-adresse').value,
        dateLivraison: racine.querySelector('#f-date').value,
        priorite: racine.querySelector('#f-priorite').value,
        transporteur: racine.querySelector('#f-transporteur').value,
        commentaire: racine.querySelector('#f-commentaire').value,
        lignes,
        envoyer,
      });
      selection = rep.commande.numero;
      viderSaisie();
      await App.apresAction();
      App.toast(envoyer
        ? `${rep.commande.numero} envoyée au dépôt`
        : `${rep.commande.numero} enregistrée en brouillon`, 'succes');
    } catch (e) {
      zone.innerHTML = `<div class="erreur">${App.echap(e.message)}</div>`;
    }
  }

  function importerCollage() {
    const texte = racine.querySelector('#f-collage').value;
    let ajoutees = 0;
    const inconnues = [];
    texte.split(/\r?\n/).forEach((brut) => {
      const ligne = brut.trim();
      if (!ligne) return;
      const parts = ligne.split(/[;,\t]|\s{2,}/).map((p) => p.trim()).filter(Boolean);
      const sku = (parts[0] || '').toUpperCase();
      const qte = Number((parts[1] || '1').replace(',', '.'));
      if (!sku) return;
      if (!App.article(sku)) { inconnues.push(sku); return; }
      ajouterLigne(sku, qte > 0 ? qte : 1);
      ajoutees += 1;
    });
    racine.querySelector('#f-collage').value = '';
    racine.querySelector('#zone-collage').hidden = true;
    App.toast(`${ajoutees} ligne(s) importée(s)${inconnues.length ? ` — inconnues : ${inconnues.join(', ')}` : ''}`,
      inconnues.length ? 'erreur' : 'succes');
  }

  /* ----------------------------------------------------------- liste + détail */

  function filtrees() {
    const f = racine.querySelector('#filtre-statut').value;
    return App.etat.commandes.filter((c) => {
      if (!f) return true;
      if (f === 'EN_COURS') return !['EXPEDIEE', 'ANNULEE'].includes(c.statut);
      return c.statut === f;
    });
  }

  function rendreListe() {
    const liste = filtrees();
    const cible = racine.querySelector('#tableau-commandes');
    if (!liste.length) { cible.innerHTML = '<div class="vide">Aucune commande.</div>'; return; }
    cible.innerHTML = `<table><thead><tr>
        <th>N°</th><th>Client</th><th>Livraison</th><th class="num">Lignes</th>
        <th>Statut</th><th>Avancement</th>
      </tr></thead><tbody>${liste.map((c) => `
        <tr class="cliquable ${c.numero === selection ? 'selection' : ''}" data-numero="${App.echap(c.numero)}">
          <td><b>${App.echap(c.numero)}</b>${c.priorite === 'URGENTE' ? ' <span class="etiquette urgent">URGENT</span>' : ''}</td>
          <td>${App.echap(c.client)}<div class="sous-titre">${App.echap(c.referenceClient || '')}</div></td>
          <td>${App.jour(c.dateLivraison)}</td>
          <td class="num">${c.lignes.length}</td>
          <td><span class="etiquette st-${c.statut}">${App.echap(App.LIBELLES[c.statut])}</span></td>
          <td><div class="jauge"><i style="width:${c.avancement.pourcent}%"></i></div>
              <span class="sous-titre">${c.avancement.faites}/${c.avancement.total}${c.cariste ? ` · ${App.echap(c.cariste)}` : ''}</span></td>
        </tr>`).join('')}</tbody></table>`;
  }

  function rendreDetail() {
    const cible = racine.querySelector('#detail-commande');
    const c = selection ? App.commande(selection) : null;
    if (!c) { cible.innerHTML = ''; return; }
    const p = c.parcours;
    const lignes = c.lignes.map((l) => {
      const a = App.article(l.sku) || {};
      return `<tr>
        <td><b>${App.echap(l.sku)}</b></td>
        <td>${App.echap(a.designation || '—')}</td>
        <td><span class="emplacement">${App.echap(a.emplacement || '?')}</span></td>
        <td class="num">${l.quantite}</td>
        <td class="num">${l.quantitePreparee}</td>
        <td><span class="etiquette st-${l.statut === 'PRELEVE' ? 'PREPAREE' : l.statut === 'MANQUANT' ? 'ANNULEE' : l.statut === 'PARTIEL' ? 'EN_PREPARATION' : 'BROUILLON'}">${App.echap(App.LIBELLES_LIGNE[l.statut])}</span>
            ${l.commentaire ? `<div class="sous-titre">${App.echap(l.commentaire)}</div>` : ''}</td>
      </tr>`;
    }).join('');

    cible.innerHTML = `<div class="carte">
      <header>
        <h2>${App.echap(c.numero)} — ${App.echap(c.client)}</h2>
        <span class="etiquette st-${c.statut}">${App.echap(App.LIBELLES[c.statut])}</span>
      </header>
      <div class="champs" style="grid-template-columns:repeat(4,1fr);font-size:.88rem">
        <div><label>Référence client</label>${App.echap(c.referenceClient || '—')}</div>
        <div><label>Livraison</label>${App.jour(c.dateLivraison)}</div>
        <div><label>Transporteur</label>${App.echap(c.transporteur || '—')}</div>
        <div><label>Préparateur</label>${App.echap(c.cariste || '—')}</div>
        <div class="large"><label>Adresse</label>${App.echap(c.adresse || '—')}</div>
        ${c.commentaire ? `<div class="large"><label>Consigne dépôt</label>${App.echap(c.commentaire)}</div>` : ''}
      </div>
      ${p.anomalies.length ? `<div class="erreur">${p.anomalies.map((a) => App.echap(`${a.sku} : ${a.message}`)).join('<br>')}</div>` : ''}
      <div class="info" style="margin-bottom:.7rem">
        Parcours de préparation : <b>${p.etapes.length}</b> arrêt(s), <b>${p.distance} m</b>,
        environ <b>${p.dureeMinutes} min</b>, <b>${p.poidsTotal} kg</b>.
      </div>
      <table><thead><tr>
        <th>Réf.</th><th>Désignation</th><th>Emplacement</th>
        <th class="num">Cdé</th><th class="num">Prép.</th><th>État</th>
      </tr></thead><tbody>${lignes}</tbody></table>

      <div class="actions" style="margin-top:.9rem">
        ${c.statut === 'BROUILLON' ? '<button class="btn principal" data-action="envoyer">Envoyer au dépôt</button>' : ''}
        ${c.statut === 'PREPAREE' ? '<button class="btn principal" data-action="expedier">Marquer expédiée</button>' : ''}
        <button class="btn" data-action="imprimer-prep">Imprimer le bon de préparation</button>
        <button class="btn" data-action="imprimer-liv">Imprimer le bon de livraison</button>
        <button class="btn" data-action="voir-plan">Voir sur le plan</button>
        ${['EXPEDIEE', 'ANNULEE'].includes(c.statut) ? '' : '<button class="btn danger" data-action="annuler">Annuler</button>'}
      </div>

      <details style="margin-top:.9rem">
        <summary class="sous-titre">Historique (${c.historique.length})</summary>
        <table style="margin-top:.4rem"><tbody>${c.historique.slice().reverse().map((h) => `
          <tr><td style="white-space:nowrap">${App.date(h.date, true)}</td>
              <td>${App.echap(h.acteur)}</td>
              <td>${App.echap(h.action)} <span class="sous-titre">${App.echap(h.detail || '')}</span></td></tr>`).join('')}
        </tbody></table>
      </details>
    </div>`;
  }

  async function actionDetail(nom) {
    const c = App.commande(selection);
    if (!c) return;
    try {
      if (nom === 'imprimer-prep') return App.imprimer(Impression.bonPreparation(c));
      if (nom === 'imprimer-liv') return App.imprimer(Impression.bonLivraison(c));
      if (nom === 'voir-plan') { VuePlan.montrer(c.numero); return App.aller('plan'); }
      if (nom === 'annuler') {
        const motif = prompt('Motif de l\'annulation ?', '');
        if (motif === null) return;
        await App.api.action(c.numero, 'annuler', { motif });
      } else if (nom === 'expedier') {
        await App.api.action(c.numero, 'expedier', {});
      } else if (nom === 'envoyer') {
        await App.api.action(c.numero, 'envoyer', {});
      }
      await App.apresAction();
      App.toast('Commande mise à jour', 'succes');
    } catch (e) {
      App.toast(e.message, 'erreur');
    }
  }

  /* -------------------------------------------------------------- montage */

  function monter(el) {
    racine = el;
    el.innerHTML = squelette();
    ajouterLigne();

    el.querySelector('#ajouter-ligne').addEventListener('click', () => {
      ajouterLigne().querySelector('.sku').focus();
    });
    el.querySelector('#basculer-collage').addEventListener('click', () => {
      const z = el.querySelector('#zone-collage');
      z.hidden = !z.hidden;
      if (!z.hidden) el.querySelector('#f-collage').focus();
    });
    el.querySelector('#importer-collage').addEventListener('click', importerCollage);
    el.querySelector('#creer-envoyer').addEventListener('click', () => creer(true));
    el.querySelector('#creer-brouillon').addEventListener('click', () => creer(false));
    el.querySelector('#vider-saisie').addEventListener('click', viderSaisie);
    el.querySelector('#filtre-statut').addEventListener('change', rendreListe);

    const corps = el.querySelector('#lignes-saisie');
    corps.addEventListener('input', (e) => {
      const tr = e.target.closest('tr');
      if (e.target.classList.contains('sku')) { majDesignation(tr); afficherSuggestions(tr); }
    });
    corps.addEventListener('keydown', (e) => {
      if (!e.target.classList.contains('sku')) return;
      const tr = e.target.closest('tr');
      const premier = tr.querySelector('ul li');
      if (e.key === 'Enter' && premier) {
        e.preventDefault();
        e.target.value = premier.dataset.sku;
        tr.querySelector('ul').hidden = true;
        majDesignation(tr);
        tr.querySelector('.qte').focus();
      } else if (e.key === 'Escape') {
        tr.querySelector('ul').hidden = true;
      }
    });
    corps.addEventListener('click', (e) => {
      const li = e.target.closest('li[data-sku]');
      if (li) {
        const tr = li.closest('tr');
        tr.querySelector('.sku').value = li.dataset.sku;
        tr.querySelector('ul').hidden = true;
        majDesignation(tr);
        tr.querySelector('.qte').select();
        return;
      }
      if (e.target.closest('.supprimer')) {
        const tr = e.target.closest('tr');
        tr.remove();
        if (!corps.children.length) ajouterLigne();
      }
    });
    corps.addEventListener('focusout', (e) => {
      const tr = e.target.closest('tr');
      if (tr) setTimeout(() => { const ul = tr.querySelector('ul'); if (ul) ul.hidden = true; }, 150);
    });

    el.querySelector('#tableau-commandes').addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-numero]');
      if (!tr) return;
      selection = selection === tr.dataset.numero ? null : tr.dataset.numero;
      rendreListe();
      rendreDetail();
    });
    el.querySelector('#detail-commande').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-action]');
      if (b) actionDetail(b.dataset.action);
    });
  }

  function rafraichir() {
    if (!racine || !App.etat.charge) return;
    if (selection && !App.commande(selection)) selection = null;
    rendreListe();
    rendreDetail();
  }

  App.enregistrerVue('compta', { monter, rafraichir, selectionner: (n) => { selection = n; } });
}());
