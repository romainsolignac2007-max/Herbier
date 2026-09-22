/* Vue Catalogue : articles, emplacements dans le dépôt et niveaux de stock. */
'use strict';

(function () {
  let racine = null;
  let recherche = '';
  let allee = '';

  function liste() {
    const t = recherche.trim().toLowerCase();
    return App.etat.articles.filter((a) => {
      if (allee && a.emplacement[0] !== allee) return false;
      if (!t) return true;
      return a.sku.toLowerCase().includes(t)
        || a.designation.toLowerCase().includes(t)
        || a.categorie.toLowerCase().includes(t)
        || a.emplacement.toLowerCase().includes(t);
    }).sort((a, b) => a.emplacement.localeCompare(b.emplacement));
  }

  function rendre() {
    const arts = liste();
    const enAlerte = App.etat.articles.filter((a) => a.stock <= a.seuil);
    racine.innerHTML = `
      <div class="carte">
        <header>
          <h2>Catalogue &amp; emplacements</h2>
          <span class="sous-titre">${App.etat.articles.length} références · ${enAlerte.length} sous le seuil d'alerte</span>
        </header>
        <div class="champs" style="grid-template-columns:2fr 1fr">
          <div><label for="cat-recherche">Rechercher</label>
            <input id="cat-recherche" value="${App.echap(recherche)}" placeholder="Référence, nom, emplacement…"></div>
          <div><label for="cat-allee">Allée</label>
            <select id="cat-allee">
              <option value="">Toutes les allées</option>
              ${App.etat.depot.allees.map((a) => `<option value="${a.code}" ${a.code === allee ? 'selected' : ''}>
                ${App.echap(`${a.code} — ${a.nom}`)}</option>`).join('')}
            </select></div>
        </div>
        <table>
          <thead><tr>
            <th>Emplacement</th><th>Réf.</th><th>Désignation</th><th>Conditionnement</th>
            <th class="num">Poids</th><th class="num">Stock</th><th style="width:220px">Corriger</th>
          </tr></thead>
          <tbody>${arts.map((a) => `<tr data-sku="${App.echap(a.sku)}">
            <td><span class="emplacement">${App.echap(a.emplacement)}</span></td>
            <td>${App.echap(a.sku)}</td>
            <td>${App.echap(a.designation)}<div class="sous-titre">${App.echap(a.categorie)}</div></td>
            <td>${App.echap(a.conditionnement)}</td>
            <td class="num">${a.poids} kg</td>
            <td class="num" ${a.stock <= a.seuil ? 'style="color:var(--rouge);font-weight:700"' : ''}>${a.stock}
              <div class="sous-titre">seuil ${a.seuil}</div></td>
            <td><div style="display:flex;gap:.3rem">
              <input class="maj-emplacement" value="${App.echap(a.emplacement)}" style="width:6.5rem" aria-label="Emplacement">
              <input class="maj-stock" type="number" min="0" value="${a.stock}" style="width:5rem" aria-label="Stock">
              <button class="btn petit enregistrer">OK</button>
            </div></td>
          </tr>`).join('')}</tbody>
        </table>
        ${arts.length ? '' : '<div class="vide">Aucun article ne correspond.</div>'}
      </div>`;
  }

  function monter(el) {
    racine = el;
    el.addEventListener('input', (e) => {
      if (e.target.id === 'cat-recherche') {
        recherche = e.target.value;
        const pos = e.target.selectionStart;
        rendre();
        const champ = racine.querySelector('#cat-recherche');
        champ.focus();
        champ.setSelectionRange(pos, pos);
      }
    });
    el.addEventListener('change', (e) => {
      if (e.target.id === 'cat-allee') { allee = e.target.value; rendre(); }
    });
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('.enregistrer');
      if (!b) return;
      const tr = b.closest('tr');
      try {
        await App.api.majArticle(tr.dataset.sku, {
          emplacement: tr.querySelector('.maj-emplacement').value,
          stock: Number(tr.querySelector('.maj-stock').value),
        });
        await App.apresAction();
        App.toast(`${tr.dataset.sku} mis à jour`, 'succes');
      } catch (err) {
        App.toast(err.message, 'erreur');
      }
    });
  }

  function rafraichir() {
    if (!racine || !App.etat.charge) return;
    if (document.activeElement && racine.contains(document.activeElement)
      && ['INPUT', 'SELECT'].includes(document.activeElement.tagName)) return; // ne pas casser une saisie
    rendre();
  }

  App.enregistrerVue('catalogue', { monter, rafraichir });
}());
