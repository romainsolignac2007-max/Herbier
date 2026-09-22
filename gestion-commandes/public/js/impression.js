/* Documents imprimables : bon de préparation (avec plan) et bon de livraison. */
'use strict';

const Impression = (function () {
  function entete(c, titre) {
    return `<div class="entete-doc">
      <div>
        <h1>${App.echap(titre)}</h1>
        <div>Commande <b>${App.echap(c.numero)}</b>${c.referenceClient ? ` — réf. client ${App.echap(c.referenceClient)}` : ''}</div>
        <div>Client : <b>${App.echap(c.client)}</b></div>
        ${c.adresse ? `<div>${App.echap(c.adresse)}</div>` : ''}
      </div>
      <div style="text-align:right">
        <div><b>${App.echap(App.etat.depot.nom)}</b></div>
        <div>Livraison prévue : ${App.jour(c.dateLivraison)}</div>
        <div>Transporteur : ${App.echap(c.transporteur || '—')}</div>
        <div>Édité le ${App.date(new Date().toISOString(), true)}</div>
        ${c.priorite === 'URGENTE' ? '<div style="font-weight:bold">★ COMMANDE URGENTE</div>' : ''}
      </div>
    </div>`;
  }

  function bonPreparation(c) {
    const p = c.parcours;
    const lignes = p.etapes.map((e) => `<tr>
        <td style="text-align:center;font-weight:bold">${e.ordre}</td>
        <td style="font-family:monospace;font-weight:bold">${App.echap(e.emplacement)}</td>
        <td>${App.echap(e.allee)} · travée ${String(e.travee).padStart(2, '0')} · niveau ${e.niveau}</td>
        <td>${App.echap(e.sku)}</td>
        <td>${App.echap(e.designation)}</td>
        <td style="text-align:right;font-weight:bold">${e.quantite}</td>
        <td>${App.echap(e.unite)}</td>
        <td style="width:2.2cm"></td>
      </tr>`).join('');
    return `${entete(c, 'Bon de préparation')}
      <p style="margin:.2rem 0 .6rem">
        Préparateur : <b>${App.echap(c.cariste || '..............................')}</b> —
        ${p.etapes.length} ligne(s) — parcours ${p.distance} m — environ ${p.dureeMinutes} min —
        poids total ${p.poidsTotal} kg
      </p>
      <table>
        <thead><tr>
          <th>#</th><th>Emplacement</th><th>Position</th><th>Réf.</th>
          <th>Désignation</th><th>Qté</th><th>Unité</th><th>Prélevé</th>
        </tr></thead>
        <tbody>${lignes}</tbody>
      </table>
      ${c.commentaire ? `<p><b>Consigne :</b> ${App.echap(c.commentaire)}</p>` : ''}
      <div class="plan-impression">
        <p style="margin:.4rem 0 .2rem"><b>Parcours dans le dépôt</b> (suivre les numéros)</p>
        ${Plan.dessiner({ depot: App.etat.depot, etapes: p.etapes, chemin: p.chemin })}
      </div>`;
  }

  function bonLivraison(c) {
    const lignes = c.lignes.map((l) => {
      const a = App.article(l.sku) || {};
      const qte = c.statut === 'BROUILLON' || c.statut === 'A_PREPARER' ? l.quantite : l.quantitePreparee;
      return `<tr>
        <td>${App.echap(l.sku)}</td>
        <td>${App.echap(a.designation || '')}</td>
        <td>${App.echap(a.conditionnement || '')}</td>
        <td style="text-align:right">${l.quantite}</td>
        <td style="text-align:right;font-weight:bold">${qte}</td>
        <td>${l.quantite !== qte ? `Reliquat : ${l.quantite - qte}` : ''} ${App.echap(l.commentaire || '')}</td>
      </tr>`;
    }).join('');
    return `${entete(c, 'Bon de livraison')}
      <table>
        <thead><tr>
          <th>Réf.</th><th>Désignation</th><th>Conditionnement</th>
          <th>Commandé</th><th>Livré</th><th>Observation</th>
        </tr></thead>
        <tbody>${lignes}</tbody>
      </table>
      ${c.commentaire ? `<p><b>Commentaire :</b> ${App.echap(c.commentaire)}</p>` : ''}
      <p style="margin-top:2rem">Préparé par ${App.echap(c.cariste || '—')} le ${App.date(c.prepareeLe)}.</p>
      <p style="margin-top:1.5rem">Signature du client (réserves éventuelles) :</p>
      <div style="height:2.5cm;border:1px solid #999;width:8cm"></div>`;
  }

  return { bonPreparation, bonLivraison };
}());
