/* Rendu du plan du dépôt (vue de dessus) et de l'élévation d'une allée, en SVG.
   Toutes les coordonnées sont en mètres : le viewBox fait le reste. */
'use strict';

const Plan = (function () {
  const COULEURS = {
    A_PRELEVER: '#1f6f4a',
    PRELEVE: '#8a97a5',
    PARTIEL: '#b7791f',
    MANQUANT: '#b32d2d',
  };

  function cle(allee, travee) {
    return `${allee}-${String(travee).padStart(2, '0')}`;
  }

  function txt(x, y, contenu, style) {
    return `<text x="${x}" y="${y}" ${style || ''}>${App.echap(contenu)}</text>`;
  }

  /**
   * @param {object} o
   * @param {object} o.depot
   * @param {Array}  [o.etapes]      étapes du parcours à mettre en évidence
   * @param {Array}  [o.chemin]      polyligne du parcours
   * @param {number} [o.etapeActive] numéro d'ordre de l'étape en cours
   * @param {boolean}[o.interactif]  cases cliquables (data-emplacement)
   * @param {object} [o.occupation]  { "A-03": ["VRT-0103", …] } pour le survol
   */
  function dessiner(o) {
    const d = o.depot;
    if (!d) return '';
    const h = d.hauteurTravee;
    const etapes = o.etapes || [];
    const parCase = new Map();
    for (const e of etapes) {
      const k = cle(e.allee, e.travee);
      if (!parCase.has(k)) parCase.set(k, []);
      parCase.get(k).push(e);
    }

    const morceaux = [];
    morceaux.push(`<svg viewBox="-1.2 -1.6 ${d.largeur + 2.4} ${d.hauteur + 3} "
      xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Plan du dépôt">`);
    morceaux.push(`<style>
      .sol { fill: #fafbfa; stroke: #c3ccd6; stroke-width: .08; }
      .rack { fill: #eef1f5; stroke: #9aa5b1; stroke-width: .06; }
      .case-fond { fill: #eef1f5; stroke: #c3ccd6; stroke-width: .03; }
      .case-txt { font: .5px "Segoe UI", sans-serif; fill: #8a97a5; text-anchor: middle; dominant-baseline: central; }
      .allee-txt { font: bold .75px "Segoe UI", sans-serif; text-anchor: middle; }
      .allee-nom { font: .42px "Segoe UI", sans-serif; fill: #6b7683; text-anchor: middle; }
      .chemin { fill: none; stroke: #1f6f4a; stroke-width: .16; stroke-dasharray: .7 .45;
                stroke-linejoin: round; stroke-linecap: round; opacity: .85; }
      .borne { fill: #14492f; }
      .borne-txt { font: bold .5px "Segoe UI", sans-serif; fill: #fff; text-anchor: middle; dominant-baseline: central; }
      .badge-txt { font: bold .72px "Segoe UI", sans-serif; fill: #fff; text-anchor: middle; dominant-baseline: central; }
      .badge-actif { stroke: #14492f; stroke-width: .18; }
      .couloir-txt { font: .45px "Segoe UI", sans-serif; fill: #a0aab5; text-anchor: middle; }
    </style>`);

    morceaux.push(`<rect class="sol" x="0" y="0" width="${d.largeur}" height="${d.hauteur}" rx=".3"/>`);

    // ---- racks, travées, cases
    for (const a of d.allees) {
      const hauteur = a.travees * h;
      morceaux.push(`<g class="allee" data-allee="${a.code}">`);
      morceaux.push(`<rect class="rack" x="${a.x}" y="${a.y}" width="${a.profondeur}" height="${hauteur}" rx=".15"/>`);
      for (let t = 1; t <= a.travees; t += 1) {
        const k = cle(a.code, t);
        const y = a.y + (t - 1) * h;
        const dedans = parCase.get(k);
        let fond = '';
        if (dedans) {
          const st = dedans.some((e) => e.statut === 'MANQUANT') ? 'MANQUANT'
            : dedans.every((e) => e.statut === 'PRELEVE') ? 'PRELEVE'
              : dedans.some((e) => e.statut === 'PARTIEL') ? 'PARTIEL' : 'A_PRELEVER';
          fond = ` fill="${COULEURS[st]}" fill-opacity="${st === 'PRELEVE' ? .35 : .8}" stroke="#fff" stroke-width=".06"`;
        }
        morceaux.push(
          `<g class="case${dedans ? ' case-active' : ' case-vide'}"${o.interactif ? ` data-emplacement="${k}"` : ''}>` +
          `<rect class="case-fond" x="${a.x}" y="${y}" width="${a.profondeur}" height="${h}"${fond}/>` +
          `<title>${App.echap(`${k} — ${a.nom}`)}</title>` +
          txt(a.x + a.profondeur / 2, y + h / 2, String(t).padStart(2, '0'),
            `class="case-txt"${dedans ? ' fill="#fff" font-weight="bold"' : ''}`) +
          '</g>'
        );
      }
      const nomCourt = a.nom.length > 22 ? `${a.nom.slice(0, 21)}…` : a.nom;
      morceaux.push(txt(a.x + a.profondeur / 2, a.y - 0.95, a.code, `class="allee-txt" fill="${a.couleur}"`));
      morceaux.push(`<g>${txt(a.x + a.profondeur / 2, a.y - 0.3, nomCourt, 'class="allee-nom"')}` +
        `<title>${App.echap(`Allée ${a.code} — ${a.nom}`)}</title></g>`);
      morceaux.push('</g>');
    }

    // ---- couloirs
    const couloirs = [...new Set(d.allees.map((a) => (
      a.couloir === 'gauche' ? a.x - 1.8 : a.x + a.profondeur + 1.8
    )).map((x) => x.toFixed(2)))];
    couloirs.forEach((x, i) => {
      morceaux.push(txt(Number(x), d.hauteur - 4.6, `couloir ${i + 1}`, 'class="couloir-txt"'));
    });

    // ---- parcours
    if (o.chemin && o.chemin.length > 1) {
      const points = o.chemin.map((p) => `${p.x},${p.y}`).join(' ');
      morceaux.push(`<polyline class="chemin" points="${points}"/>`);
    }

    // ---- pastilles numérotées
    for (const e of etapes) {
      const actif = o.etapeActive === e.ordre;
      const couleur = COULEURS[e.statut] || COULEURS.A_PRELEVER;
      const r = actif ? 0.95 : 0.72;
      const bx = e.bx == null ? e.x : e.bx;
      const by = e.by == null ? e.y : e.by;
      morceaux.push(
        `<g class="badge"><circle cx="${bx}" cy="${by}" r="${r}" fill="${couleur}"` +
        `${actif ? ' class="badge-actif"' : ''}/>` +
        txt(bx, by, String(e.ordre), `class="badge-txt"${actif ? ' font-size=".9px"' : ''}`) +
        `<title>${App.echap(`${e.ordre}. ${e.emplacement} — ${e.designation} ×${e.quantite}`)}</title></g>`
      );
    }

    // ---- départ / expédition
    for (const b of [d.depart, d.expedition]) {
      morceaux.push(
        `<g><rect class="borne" x="${b.x - 2.4}" y="${b.y - 0.7}" width="4.8" height="1.4" rx=".35"/>` +
        txt(b.x, b.y, b.libelle, 'class="borne-txt"') + '</g>'
      );
    }

    morceaux.push('</svg>');
    return morceaux.join('');
  }

  /** Vue de face du rack : montre à quel niveau se trouve l'article. */
  function elevation(depot, etape) {
    const allee = depot.allees.find((a) => a.code === etape.allee);
    if (!allee) return '';
    const L = 1.6;        // largeur d'une travée dessinée
    const H = 1.1;        // hauteur d'un niveau
    const l = allee.travees * L;
    const haut = allee.niveaux * H;
    const m = [];
    m.push(`<svg viewBox="-1 -1.4 ${l + 2} ${haut + 3} " xmlns="http://www.w3.org/2000/svg">`);
    m.push(`<style>
      .c { fill: #f2f5f8; stroke: #9aa5b1; stroke-width: .04; }
      .c.on { fill: ${COULEURS[etape.statut] || COULEURS.A_PRELEVER}; stroke: #fff; stroke-width: .08; }
      .l { font: .38px "Segoe UI", sans-serif; fill: #6b7683; text-anchor: middle; dominant-baseline: central; }
      .l.on { fill: #fff; font-weight: bold; }
      .ax { font: .34px "Segoe UI", sans-serif; fill: #8a97a5; }
      .sol2 { fill: #dfe4ea; }
    </style>`);
    for (let t = 1; t <= allee.travees; t += 1) {
      for (let n = 1; n <= allee.niveaux; n += 1) {
        const x = (t - 1) * L;
        const y = haut - n * H;
        const on = t === etape.travee && n === etape.niveau;
        m.push(`<rect class="c${on ? ' on' : ''}" x="${x}" y="${y}" width="${L}" height="${H}" rx=".08"/>`);
        if (on) m.push(txt(x + L / 2, y + H / 2, `N${n}`, 'class="l on"'));
      }
      m.push(txt((t - 1) * L + L / 2, haut + 0.45, String(t).padStart(2, '0'), 'class="l"'));
    }
    m.push(`<rect class="sol2" x="-.3" y="${haut}" width="${l + .6}" height=".14"/>`);
    m.push(txt(l / 2, -0.7, `Allée ${allee.code} — vue de face (travées 01 à ${String(allee.travees).padStart(2, '0')})`, 'class="ax" text-anchor="middle"'));
    m.push(txt(l / 2, haut + 1.25, `Prendre en travée ${String(etape.travee).padStart(2, '0')}, niveau ${etape.niveau} sur ${allee.niveaux}`, 'class="ax" text-anchor="middle"'));
    m.push('</svg>');
    return m.join('');
  }

  function legende() {
    return `<div class="legende">
      <span style="color:${COULEURS.A_PRELEVER}">à prélever</span>
      <span style="color:${COULEURS.PRELEVE}">prélevé</span>
      <span style="color:${COULEURS.PARTIEL}">partiel</span>
      <span style="color:${COULEURS.MANQUANT}">manquant / rupture</span>
      <span style="color:#c3ccd6">emplacement libre</span>
    </div>`;
  }

  return { dessiner, elevation, legende, cle, COULEURS };
}());
