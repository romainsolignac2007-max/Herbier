/* ============================================================
   Herbier — application (navigation, recherche, swipe, quizz, classement)
   ============================================================ */

// Petites icônes
const ICONE_EAU = { "Peu": "💧", "Modéré": "💧💧", "Souvent": "💧💧💧" };
const ICONE_SOLEIL = { "Plein soleil": "☀️", "Mi-ombre": "⛅", "Ombre": "🌑" };
const ICONE_LIEU = { "Intérieur": "🏠", "Extérieur": "🌳", "Les deux": "🏠🌳" };
const ICONE_FLORAISON = { "Printemps": "🌷", "Été": "🌻", "Automne": "🍂", "Hiver": "❄️", "Toute l'année": "🔁" };
// Terreaux : libellés complets (quizz) + version courte + icône (fiches)
const TERREAUX = ["Terreau universel", "Terre de bruyère (sol acide)", "Terreau drainant (méditerranéen/cactées)", "Terreau spécial agrumes"];
const FLORAISONS = ["Printemps", "Été", "Automne", "Hiver", "Toute l'année"];
const TERREAU_COURT = {
  "Terreau universel": "Universel",
  "Terre de bruyère (sol acide)": "Terre de bruyère",
  "Terreau drainant (méditerranéen/cactées)": "Drainant",
  "Terreau spécial agrumes": "Agrumes",
};
const ICONE_TERREAU = {
  "Terreau universel": "🪴",
  "Terre de bruyère (sol acide)": "🍂",
  "Terreau drainant (méditerranéen/cactées)": "🏜️",
  "Terreau spécial agrumes": "🍋",
};
// Résistance au froid (rusticité) : fourchettes de température
const GEL = [
  "Craint le froid (à garder > 10 °C)",
  "Très peu rustique (0 à −5 °C)",
  "Peu rustique (−5 à −10 °C)",
  "Rustique (−10 à −15 °C)",
  "Très rustique (−15 à −25 °C)",
];
const GEL_COURT = {
  "Craint le froid (à garder > 10 °C)": "> 10 °C",
  "Très peu rustique (0 à −5 °C)": "0 à −5 °C",
  "Peu rustique (−5 à −10 °C)": "−5 à −10 °C",
  "Rustique (−10 à −15 °C)": "−10 à −15 °C",
  "Très rustique (−15 à −25 °C)": "−15 à −25 °C",
};
// Feuillage : la plante garde-t-elle ses feuilles ?
const FEUILLAGE = ["Persistant", "Semi-persistant", "Caduc"];
const ICONE_FEUILLAGE = { "Persistant": "🌿", "Semi-persistant": "🍃", "Caduc": "🍂" };
// Cycle de vie
const CYCLE = ["Annuelle", "Bisannuelle", "Vivace", "Arbuste ou arbre"];
const ICONE_CYCLE = { "Annuelle": "🌱", "Bisannuelle": "🗓️", "Vivace": "♻️", "Arbuste ou arbre": "🌳" };

// Source d'image (gère le fichier intégré OU le dossier images/)
function chemin(nom) {
  if (!nom) return null;
  if (typeof PHOTOS !== "undefined" && PHOTOS[nom]) return PHOTOS[nom];
  return "images/" + nom;
}
// Petite photo (pour les cartes)
function srcImage(p) { return chemin(p.photo); }
// Grande photo (pour le swipe et le quizz) — sinon on retombe sur la petite
function srcImageGrande(p) { return chemin(p.photoGrande) || chemin(p.photo); }
function imageHTML(p, classe) {
  const src = srcImage(p);
  if (src) return `<div class="${classe}"><img src="${src}" alt="${p.nom}" onerror="this.parentNode.textContent='${p.emoji || "🌿"}'"></div>`;
  return `<div class="${classe}">${p.emoji || "🌿"}</div>`;
}

// Mélange un tableau (copie)
function melanger(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ===================== NAVIGATION ENTRE LES VUES ===================== */
let swipeConstruit = false;

function naviguer(vueId) {
  fermerFiche(); // ferme la fiche plein écran si elle était ouverte
  document.querySelectorAll(".vue").forEach(v => v.classList.toggle("active", v.id === vueId));
  document.querySelectorAll(".nav-item").forEach(n => n.classList.toggle("actif", n.dataset.aller === vueId));
  document.body.classList.toggle("swipe-actif", vueId === "vue-swipe");
  window.scrollTo(0, 0);

  if (vueId === "vue-swipe" && !swipeConstruit) { construireSwipe(); swipeConstruit = true; }
  if (vueId === "vue-quizz") montrerAccueilQuizz();
  if (vueId === "vue-classement") afficherClassement();
}

// Boutons de la barre + boutons d'accès de l'accueil
document.querySelectorAll("[data-aller]").forEach(btn => {
  btn.addEventListener("click", () => naviguer(btn.dataset.aller));
});

/* ===================== RECHERCHE (grille + filtres) ===================== */
const grille = document.getElementById("grille");
const compteur = document.getElementById("compteur");
const aucun = document.getElementById("aucun");
const champRecherche = document.getElementById("recherche");
const panneauFiltres = document.getElementById("filtres-panel");

// Configuration des filtres (sections dépliables à cases à cocher)
const CATEGORIES = [
  { cle: "soleil", titre: "Lumière", options: [
    { val: "Plein soleil", ico: "☀️" }, { val: "Mi-ombre", ico: "⛅" }, { val: "Ombre", ico: "🌑" } ] },
  { cle: "eau", titre: "Arrosage", options: [
    { val: "Peu", ico: "💧" }, { val: "Modéré", ico: "💧💧" }, { val: "Souvent", ico: "💧💧💧" } ] },
  { cle: "lieu", titre: "Lieu", options: [
    { val: "Intérieur", ico: "🏠" }, { val: "Extérieur", ico: "🌳" } ] },
  { cle: "floraison", titre: "Floraison", options:
    FLORAISONS.map(f => ({ val: f, ico: ICONE_FLORAISON[f] || "🌸" })) },
  { cle: "feuillage", titre: "Feuillage", options:
    FEUILLAGE.map(f => ({ val: f, ico: ICONE_FEUILLAGE[f] })) },
  { cle: "cycle", titre: "Cycle de vie", options:
    CYCLE.map(c => ({ val: c, ico: ICONE_CYCLE[c] })) },
  { cle: "gel", titre: "Résistance au froid", options:
    GEL.map(g => ({ val: g, ico: g.indexOf("Craint") === 0 ? "🏠" : "❄️", label: GEL_COURT[g] })) },
];
const recherche = { texte: "" };
const selections = { soleil: new Set(), eau: new Set(), lieu: new Set(), floraison: new Set(), feuillage: new Set(), cycle: new Set(), gel: new Set() };
const sectionsOuvertes = { soleil: false, eau: false, lieu: false, floraison: false, feuillage: false, cycle: false, gel: false };

// Explications affichées au clic sur le petit ⓘ de chaque filtre
const INFOS = {
  soleil: {
    "Plein soleil": "Au moins 6 h de soleil direct par jour. Pour les plantes qui aiment la chaleur et la pleine lumière.",
    "Mi-ombre": "Soleil le matin ou lumière filtrée, à l'ombre aux heures chaudes. Lumineux mais sans soleil brûlant.",
    "Ombre": "Peu ou pas de soleil direct. Pour les plantes de sous-bois ou de pièces peu éclairées.",
  },
  eau: {
    "Peu": "Arrosage rare : on laisse bien sécher entre deux. Plantes résistantes à la sécheresse.",
    "Modéré": "Arrosage régulier : on laisse sécher la surface du sol entre deux arrosages.",
    "Souvent": "Substrat maintenu frais, arrosages fréquents. La plante craint la sécheresse.",
  },
  lieu: {
    "Intérieur": "Se cultive en pot, à la maison, à l'abri du gel.",
    "Extérieur": "Se cultive au jardin, en pleine terre ou en pot dehors.",
  },
  floraison: {
    "Printemps": "Fleurit surtout au printemps (mars à mai).",
    "Été": "Fleurit surtout en été (juin à août).",
    "Automne": "Fleurit surtout en automne (septembre à novembre).",
    "Hiver": "Fleurit en hiver ou en fin d'hiver (décembre à février).",
    "Toute l'année": "Fleurit très longtemps, ou feuillage décoratif toute l'année.",
  },
  feuillage: {
    "Persistant": "Garde ses feuilles toute l'année.",
    "Semi-persistant": "Conserve une partie de son feuillage selon le climat.",
    "Caduc": "Perd ses feuilles en automne/hiver et repart au printemps.",
  },
  cycle: {
    "Annuelle": "Vit une seule saison : elle pousse, fleurit, grène puis meurt la même année.",
    "Bisannuelle": "Vit deux ans : feuillage la 1re année, floraison la 2e, puis elle meurt.",
    "Vivace": "Vit plusieurs années et repart chaque année (herbacées, bulbes, plantes d'intérieur).",
    "Arbuste ou arbre": "Plante ligneuse (à bois) qui vit de nombreuses années.",
  },
  gel: {
    "Craint le froid (à garder > 10 °C)": "Frileuse : à garder à l'intérieur ou hors gel, au-dessus de 10 °C.",
    "Très peu rustique (0 à −5 °C)": "Supporte un léger gel de courte durée, jusqu'à environ −5 °C.",
    "Peu rustique (−5 à −10 °C)": "Résiste à des gelées modérées, jusqu'à environ −10 °C.",
    "Rustique (−10 à −15 °C)": "Tient des hivers froids, jusqu'à environ −15 °C.",
    "Très rustique (−15 à −25 °C)": "Supporte les hivers rigoureux, jusqu'à environ −25 °C.",
  },
};

// Une plante a-t-elle la valeur d'une option ? (le lieu "Les deux" compte pour Intérieur ET Extérieur)
function plantePossede(cle, val, p) {
  if (cle === "lieu") return p.lieu === val || p.lieu === "Les deux";
  return p[cle] === val;
}
function matchTexte(p) {
  const t = recherche.texte.toLowerCase().trim();
  return !t || p.nom.toLowerCase().includes(t) || p.latin.toLowerCase().includes(t) || p.famille.toLowerCase().includes(t);
}
function matchCategorie(cle, p) {
  const sel = selections[cle];
  return sel.size === 0 || [...sel].some(v => plantePossede(cle, v, p));
}

function carteHTML(p) {
  return `
    <article class="carte" data-index="${PLANTES.indexOf(p)}">
      ${imageHTML(p, "carte-image")}
      <div class="carte-corps">
        <h3 class="nom-plante">${p.nom}</h3>
        <p class="latin-plante">${p.latin}</p>
        <div class="carte-tags">
          <span class="tag">${ICONE_LIEU[p.lieu] || ""} ${p.lieu}</span>
          <span class="tag">${ICONE_SOLEIL[p.soleil] || ""} ${p.soleil}</span>
          <span class="tag">${ICONE_EAU[p.eau] || ""} ${p.eau}</span>
        </div>
      </div>
    </article>`;
}

function brancherCartes(conteneur) {
  conteneur.querySelectorAll(".carte").forEach(carte => {
    carte.addEventListener("click", () => ouvrirFiche(PLANTES[carte.dataset.index]));
  });
}

// Plantes qui passent le texte + toutes les catégories SAUF une (pour calculer les quantités)
function plantesFiltrees(saufCle) {
  return PLANTES.filter(p =>
    matchTexte(p) && CATEGORIES.every(c => c.cle === saufCle || matchCategorie(c.cle, p))
  );
}

// Construit le panneau de filtres (sections dépliables + cases à cocher + quantités)
function construireFiltres() {
  let html = `<div class="filtres-titre"><span>Filtrer</span><button class="filtres-reset" id="filtres-reset" title="Réinitialiser les filtres" aria-label="Réinitialiser les filtres">↻</button></div>`;
  CATEGORIES.forEach(cat => {
    const ouvert = sectionsOuvertes[cat.cle];
    const base = plantesFiltrees(cat.cle); // pour compter sans s'auto-exclure
    html += `
      <div class="filtre-section ${ouvert ? "ouvert" : ""}" data-cle="${cat.cle}">
        <div class="filtre-tete">
          <button class="filtre-toggle" data-toggle="${cat.cle}">
            <span>${cat.titre}</span><span class="chevron">⌄</span>
          </button>
          <button class="filtre-info" data-info="${cat.cle}" title="À quoi correspondent ces choix ?" aria-label="Infos">i</button>
        </div>
        <div class="filtre-aide" hidden>
          ${cat.options.map(o => `<p><b>${o.ico} ${o.label || o.val}</b>${INFOS[cat.cle] && INFOS[cat.cle][o.val] ? " — " + INFOS[cat.cle][o.val] : ""}</p>`).join("")}
        </div>
        <div class="filtre-corps">
          ${cat.options.map(o => {
            const n = base.filter(p => plantePossede(cat.cle, o.val, p)).length;
            const coche = selections[cat.cle].has(o.val);
            return `
              <label class="filtre-opt ${n === 0 && !coche ? "vide" : ""}">
                <input type="checkbox" data-cle="${cat.cle}" data-val="${o.val}" ${coche ? "checked" : ""}>
                <span class="case"></span>
                <span class="opt-nom">${o.ico} ${o.label || o.val}</span>
                <span class="opt-nb">${n}</span>
              </label>`;
          }).join("")}
        </div>
      </div>`;
  });
  panneauFiltres.innerHTML = html;

  // Bouton ↻ : réinitialiser tous les filtres (et la recherche)
  const btnReset = document.getElementById("filtres-reset");
  if (btnReset) btnReset.addEventListener("click", () => {
    Object.values(selections).forEach(s => s.clear());
    recherche.texte = "";
    if (champRecherche) champRecherche.value = "";
    afficher();
  });

  // Déplier / replier une section
  panneauFiltres.querySelectorAll(".filtre-toggle").forEach(t => {
    t.addEventListener("click", () => {
      const cle = t.dataset.toggle;
      const section = t.closest(".filtre-section");
      sectionsOuvertes[cle] = !sectionsOuvertes[cle];
      section.classList.toggle("ouvert", sectionsOuvertes[cle]);
      // fermer aussi l'encart d'info quand on replie le filtre
      const aide = section.querySelector(".filtre-aide");
      if (aide) aide.hidden = true;
    });
  });
  // Petit ⓘ : afficher / masquer les explications des options
  panneauFiltres.querySelectorAll(".filtre-info").forEach(b => {
    b.addEventListener("click", e => {
      e.stopPropagation();
      const section = b.closest(".filtre-section");
      const aide = section.querySelector(".filtre-aide");
      if (!aide) return;
      // si on ouvre l'info alors que le filtre est replié, on déplie aussi le filtre
      if (aide.hidden && !section.classList.contains("ouvert")) {
        sectionsOuvertes[b.dataset.info] = true;
        section.classList.add("ouvert");
      }
      aide.hidden = !aide.hidden;
    });
  });
  // Cocher / décocher une option
  panneauFiltres.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener("change", () => {
      const sel = selections[cb.dataset.cle];
      cb.checked ? sel.add(cb.dataset.val) : sel.delete(cb.dataset.val);
      afficher();
    });
  });
}

function afficher() {
  const resultats = PLANTES.filter(p =>
    matchTexte(p) && CATEGORIES.every(c => matchCategorie(c.cle, p))
  );
  grille.innerHTML = resultats.map(carteHTML).join("");
  const n = resultats.length;
  compteur.textContent = `${n} plante${n > 1 ? "s" : ""} trouvée${n > 1 ? "s" : ""}`;
  aucun.hidden = n !== 0;
  brancherCartes(grille);
  construireFiltres(); // recalcule les quantités à chaque changement
}

champRecherche.addEventListener("input", e => { recherche.texte = e.target.value; afficher(); });

/* ===================== FICHE DÉTAILLÉE ===================== */
const overlay = document.getElementById("overlay");
const ficheContenu = document.getElementById("fiche-contenu");

function ouvrirFiche(p) {
  ficheContenu.innerHTML = `
    ${imageHTML(p, "fiche-banniere")}
    <div class="fiche-texte">
      <h2>${p.nom}</h2>
      <p class="fiche-latin">${p.latin}</p>
      <p class="fiche-famille">${p.famille}</p>
      ${p.presentation ? `<p class="fiche-presentation">${p.presentation}</p>` : ""}
      <div class="fiche-infos">
        <div class="info-box"><div class="ico">${ICONE_LIEU[p.lieu] || "🌿"}</div><div class="lib">Lieu</div><div class="val">${p.lieu}</div></div>
        <div class="info-box"><div class="ico">${ICONE_SOLEIL[p.soleil] || "🌿"}</div><div class="lib">Lumière</div><div class="val">${p.soleil}</div></div>
        <div class="info-box"><div class="ico">${ICONE_EAU[p.eau] || "🌿"}</div><div class="lib">Arrosage</div><div class="val">${p.eau}</div></div>
        ${p.floraison ? `<div class="info-box"><div class="ico">${ICONE_FLORAISON[p.floraison] || "🌸"}</div><div class="lib">Floraison</div><div class="val">${p.floraison}</div></div>` : ""}
        ${p.terreau ? `<div class="info-box"><div class="ico">${ICONE_TERREAU[p.terreau] || "🪴"}</div><div class="lib">Terreau</div><div class="val">${TERREAU_COURT[p.terreau] || p.terreau}</div></div>` : ""}
        ${p.feuillage ? `<div class="info-box"><div class="ico">${ICONE_FEUILLAGE[p.feuillage] || "🍃"}</div><div class="lib">Feuillage</div><div class="val">${p.feuillage}</div></div>` : ""}
        ${p.cycle ? `<div class="info-box"><div class="ico">${ICONE_CYCLE[p.cycle] || "♻️"}</div><div class="lib">Cycle</div><div class="val">${p.cycle}</div></div>` : ""}
        ${p.gel ? `<div class="info-box"><div class="ico">❄️</div><div class="lib">Résiste au froid</div><div class="val">${GEL_COURT[p.gel] || p.gel}</div></div>` : ""}
      </div>
      ${p.hauteur ? `<div class="bloc"><h3>📐 Taille adulte</h3><p><strong>${p.hauteur} × ${p.largeur}</strong> <span class="taille-note">(hauteur × largeur, approx.)</span></p></div>` : ""}
      <div class="bloc"><h3>👁️ Comment la reconnaître</h3><p>${p.reconnaitre}</p></div>
      <div class="bloc"><h3>🪴 Comment l'entretenir</h3><p>${p.entretien}</p></div>
      ${p.saison ? `<div class="bloc"><h3>📅 Saison</h3><p>${p.saison}</p></div>` : ""}
    </div>`;
  overlay.hidden = false;
  document.body.style.overflow = "hidden";
}
function fermerFiche() { overlay.hidden = true; document.body.style.overflow = ""; }
document.getElementById("fermer").addEventListener("click", fermerFiche);
overlay.addEventListener("click", e => { if (e.target === overlay) fermerFiche(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") fermerFiche(); });

/* ===================== ACCUEIL ===================== */

// Astuces de saison : chaque astuce est rattachée aux mois où elle est pertinente.
// L'astuce affichée change chaque semaine (rotation parmi celles du mois en cours).
const MOIS_NOM = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const ASTUCES = [
  // Hiver
  { mois: [12, 1, 2], emoji: "✂️", titre: "Taillez les arbres fruitiers à pépins", texte: "Profitez du repos végétatif, hors période de gel, pour tailler pommiers et poiriers : retirez le bois mort, les branches qui se croisent et aérez le centre pour laisser entrer la lumière." },
  { mois: [12, 1], emoji: "🧤", titre: "Protégez les plantes du gel", texte: "Paillez le pied des plantes fragiles et posez un voile d'hivernage sur les sujets gélifs (agrumes, oliviers en pot). Rentrez les potées non rustiques dans un local clair et frais." },
  { mois: [1], emoji: "🛠️", titre: "Entretenez vos outils", texte: "Saison calme au jardin : nettoyez, affûtez et huilez sécateurs et bêches. Un outil propre et bien tranchant limite la propagation des maladies d'une plante à l'autre." },
  { mois: [11, 12, 1, 2], emoji: "🌳", titre: "Plantez à racines nues", texte: "C'est la période idéale pour planter arbres et arbustes à racines nues : installés maintenant, ils repartiront de plus belle au printemps." },
  { mois: [2, 3], emoji: "🌹", titre: "Taillez les rosiers", texte: "En fin d'hiver, rabattez les rosiers buissons à 3-5 yeux, juste au-dessus d'un œil tourné vers l'extérieur. Coupez en biais et éliminez le bois mort ou chétif." },
  // Printemps
  { mois: [3, 4], emoji: "🪴", titre: "Rempotez les plantes d'intérieur", texte: "La reprise de croissance arrive : rempotez dans un pot à peine plus grand avec du terreau frais. C'est aussi le bon moment pour diviser les touffes devenues trop serrées." },
  { mois: [3], emoji: "🌱", titre: "Lancez vos semis sous abri", texte: "Démarrez tomates, basilic et fleurs annuelles à la chaleur, sur un rebord de fenêtre lumineux. Vous les repiquerez dehors une fois tout risque de gelée écarté." },
  { mois: [3, 4], emoji: "🌿", titre: "Divisez les vivaces", texte: "Séparez en éclats les vivaces (hostas, graminées, asters) en gardant des racines sur chaque morceau : vous rajeunissez la plante et garnissez gratuitement vos massifs." },
  { mois: [4, 5], emoji: "🌸", titre: "Taillez les arbustes de printemps", texte: "Taillez forsythias, lilas et autres arbustes APRÈS leur floraison, jamais avant : tailler trop tôt reviendrait à supprimer les fleurs de l'année." },
  { mois: [4, 5], emoji: "🐞", titre: "Surveillez les pucerons", texte: "Les premières chaleurs amènent les pucerons. Inspectez les jeunes pousses et laissez faire les coccinelles avant de penser aux traitements." },
  { mois: [5], emoji: "🍅", titre: "Installez le potager", texte: "Après la mi-mai (Saints de Glace), plantez sans risque tomates, courgettes et aromatiques en pleine terre, et arrosez régulièrement à la reprise." },
  // Été
  { mois: [6, 7, 8], emoji: "💧", titre: "Arrosez au bon moment", texte: "Arrosez tôt le matin ou le soir, copieusement et au pied plutôt qu'un peu chaque jour : les racines plongent en profondeur et la plante résiste mieux à la sécheresse." },
  { mois: [6, 7], emoji: "🌹", titre: "Retirez les fleurs fanées", texte: "Supprimez régulièrement les fleurs fanées (rosiers, géraniums, vivaces) : la plante, au lieu de faire des graines, relance de nouvelles floraisons tout l'été." },
  { mois: [6, 7], emoji: "🌾", titre: "Paillez contre la sécheresse", texte: "Un bon paillage (tontes séchées, paille, BRF) garde le sol frais, réduit nettement l'arrosage et étouffe les mauvaises herbes." },
  { mois: [7, 8], emoji: "💜", titre: "Taillez la lavande", texte: "Juste après la floraison, taillez la lavande en boule sans entamer le vieux bois : elle restera compacte et refleurira généreusement l'an prochain." },
  { mois: [6, 7, 8], emoji: "🌿", titre: "Bouturez les arbustes", texte: "L'été est parfait pour bouturer en godet (laurier, romarin, hortensia) : prélevez une tige non fleurie et gardez le substrat humide, à l'ombre." },
  // Automne
  { mois: [9, 10], emoji: "🍂", titre: "Plantez vivaces et arbustes", texte: "« À la Sainte-Catherine, tout bois prend racine. » Le sol encore chaud et les pluies d'automne favorisent une plantation réussie avant l'hiver." },
  { mois: [9, 10, 11], emoji: "🌷", titre: "Plantez les bulbes de printemps", texte: "Plantez tulipes, narcisses et crocus à l'automne, à une profondeur de 2 à 3 fois leur hauteur, pour un printemps tout fleuri." },
  { mois: [10, 11], emoji: "🍁", titre: "Recyclez les feuilles mortes", texte: "Mettez les feuilles au compost ou en tas pour obtenir un terreau de feuilles ; gardez-en une couche au pied des plantes frileuses comme protection." },
  { mois: [10, 11], emoji: "🏠", titre: "Rentrez les plantes fragiles", texte: "Avant les premières gelées, rentrez agrumes, géraniums et plantes grasses dans un local clair et hors gel, en réduisant les arrosages." },
  { mois: [9], emoji: "🌱", titre: "Semez ou regarnissez la pelouse", texte: "Septembre, avec un sol chaud et humide, est le meilleur moment pour semer un gazon ou regarnir les zones clairsemées." },
];

function numeroSemaine(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const jour = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - jour + 3);
  const premierJeudi = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((date - premierJeudi) / 86400000 - 3 + ((premierJeudi.getUTCDay() + 6) % 7)) / 7);
}

// Renvoie n astuces du mois courant ; la sélection glisse chaque semaine.
function astucesDeLaSemaine(n = 3) {
  const d = new Date();
  const mois = d.getMonth() + 1;
  let pool = ASTUCES.filter(a => a.mois.includes(mois));
  if (pool.length === 0) pool = ASTUCES;
  const debut = numeroSemaine(d) % pool.length;
  const res = [];
  for (let k = 0; k < Math.min(n, pool.length); k++) {
    res.push(pool[(debut + k) % pool.length]);
  }
  return { mois, liste: res };
}

function remplirAccueil() {
  // Stats
  const familles = new Set(PLANTES.map(p => p.famille)).size;
  document.getElementById("accueil-stats").innerHTML = `
    <div class="stat-bulle"><div class="nb">${PLANTES.length}</div><div class="lb">plantes</div></div>
    <div class="stat-bulle"><div class="nb">${familles}</div><div class="lb">familles</div></div>
    <div class="stat-bulle"><div class="nb">∞</div><div class="lb">à apprendre</div></div>`;

  // Astuces de saison (plusieurs à la fois, renouvelées chaque semaine)
  const { mois, liste } = astucesDeLaSemaine(3);
  document.getElementById("astuce-semaine").innerHTML = `
    <h2 class="section-titre">🌿 Astuces de saison · ${MOIS_NOM[mois - 1]}</h2>
    <p class="section-sous">Les bons gestes du moment — renouvelés chaque semaine.</p>
    <div class="astuces-liste">
      ${liste.map(a => `
        <div class="astuce">
          <div class="astuce-ico">${a.emoji}</div>
          <div class="astuce-corps"><h3>${a.titre}</h3><p>${a.texte}</p></div>
        </div>`).join("")}
    </div>`;

  // À la une : 3 plantes au hasard
  const une = melanger(PLANTES).slice(0, 3);
  const g = document.getElementById("grille-une");
  g.innerHTML = une.map(carteHTML).join("");
  brancherCartes(g);
}

/* ===================== MODE SWIPE (façon TikTok) =====================
   UNE seule plante dans le DOM à la fois (donc une seule image en mémoire) :
   impossible de saturer la mémoire, quel que soit le nombre de plantes.
   Le contenu est remplacé à chaque changement, avec une animation glissée.
   Le texte garde un défilement natif simple (fiable) ; un détecteur de geste
   décide quand passer à la plante suivante (geste sur l'image, ou en bout de texte). */
let swipeListe = [], swipeIndex = 0, swipeConteneur = null, swipeAnime = false, swipeBranche = false;

function slideHTML(p) {
  const src = srcImageGrande(p);
  const photo = src
    ? `<div class="swipe-photo"><img src="${src}" alt="${p.nom}" onerror="this.parentNode.classList.add('swipe-photo-emoji');this.parentNode.textContent='${p.emoji || "🌿"}'"></div>`
    : `<div class="swipe-photo swipe-photo-emoji">${p.emoji || "🌿"}</div>`;
  return `
    <div class="swipe-slide">
      ${photo}
      <div class="swipe-info">
        <h2>${p.nom}</h2>
        <p class="latin">${p.latin} · ${p.famille}</p>
        ${p.presentation ? `<p class="swipe-presentation">${p.presentation}</p>` : ""}
        <div class="swipe-tags">
          <span class="tag">${ICONE_LIEU[p.lieu] || ""} ${p.lieu}</span>
          <span class="tag">${ICONE_SOLEIL[p.soleil] || ""} ${p.soleil}</span>
          <span class="tag">${ICONE_EAU[p.eau] || ""} ${p.eau}</span>
          ${p.floraison ? `<span class="tag">${ICONE_FLORAISON[p.floraison] || "🌸"} ${p.floraison}</span>` : ""}
          ${p.terreau ? `<span class="tag">${ICONE_TERREAU[p.terreau] || "🪴"} ${TERREAU_COURT[p.terreau] || p.terreau}</span>` : ""}
          ${p.feuillage ? `<span class="tag">${ICONE_FEUILLAGE[p.feuillage] || "🍃"} ${p.feuillage}</span>` : ""}
          ${p.cycle ? `<span class="tag">${ICONE_CYCLE[p.cycle] || "♻️"} ${p.cycle}</span>` : ""}
          ${p.gel ? `<span class="tag">❄️ ${GEL_COURT[p.gel] || p.gel}</span>` : ""}
        </div>
        <div class="swipe-bloc"><h3>👁️ Reconnaître</h3><p>${p.reconnaitre}</p></div>
        <div class="swipe-bloc"><h3>🪴 Entretenir</h3><p>${p.entretien}</p></div>
      </div>
    </div>`;
}

function elementDepuisHTML(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

const SWIPE_TRANS = "transform 0.42s cubic-bezier(0.33, 1, 0.68, 1)"; // ralenti doux, façon TikTok

// Précharge les photos voisines (2 suivantes + 1 précédente) pour une transition fluide,
// tout en libérant les éloignées → la mémoire reste basse.
let swipePreload = {};
function prechargerVoisines() {
  const garder = new Set();
  for (let d = -1; d <= 2; d++) {
    const k = swipeIndex + d;
    if (k < 0 || k >= swipeListe.length) continue;
    garder.add(k);
    if (!swipePreload[k]) {
      const src = srcImageGrande(swipeListe[k]);
      if (src) { const im = new Image(); im.src = src; swipePreload[k] = im; }
    }
  }
  Object.keys(swipePreload).forEach(k => { if (!garder.has(+k)) delete swipePreload[+k]; });
}

function construireSwipe() {
  swipeConteneur = document.getElementById("swipe-conteneur");
  swipeListe = melanger(PLANTES);
  swipeIndex = 0;
  swipePreload = {};
  swipeConteneur.innerHTML = "";
  swipeConteneur.appendChild(elementDepuisHTML(slideHTML(swipeListe[0])));
  prechargerVoisines();
  if (!swipeBranche) { brancherSwipe(); swipeBranche = true; }
}

function allerSlide(i) {
  const cible = Math.max(0, Math.min(swipeListe.length - 1, i));
  if (cible === swipeIndex || swipeAnime) return;
  const sens = cible > swipeIndex ? 1 : -1;
  swipeIndex = cible;
  swipeAnime = true;
  prechargerVoisines();

  const ancien = swipeConteneur.querySelector(".swipe-slide");
  const nouveau = elementDepuisHTML(slideHTML(swipeListe[cible]));
  // La nouvelle plante attend juste hors écran (en bas pour "suivant", en haut pour "précédent")
  nouveau.style.transform = sens > 0 ? "translateY(100%)" : "translateY(-100%)";
  swipeConteneur.appendChild(nouveau);
  void nouveau.offsetHeight; // force le reflow avant d'animer

  // Les deux glissent ENSEMBLE, dans le même sens (mouvement continu)
  if (ancien) { ancien.style.transition = SWIPE_TRANS; ancien.style.transform = sens > 0 ? "translateY(-100%)" : "translateY(100%)"; }
  nouveau.style.transition = SWIPE_TRANS;
  nouveau.style.transform = "translateY(0)";

  setTimeout(() => {
    if (ancien) ancien.remove();
    nouveau.style.transition = "";
    swipeAnime = false;
  }, 440);
}

function infoSwipe() { return swipeConteneur.querySelector(".swipe-slide:last-child .swipe-info"); }
// Tolérance large = moins de résistance pour basculer en bout de texte
function texteEnBas() { const i = infoSwipe(); return !i || i.scrollTop + i.clientHeight >= i.scrollHeight - 36; }
function texteEnHaut() { const i = infoSwipe(); return !i || i.scrollTop <= 36; }

function brancherSwipe() {
  let y0 = 0, x0 = 0, surTexte = false;
  const SEUIL = 28; // glissement minimal pour changer de plante (moins de résistance)

  swipeConteneur.addEventListener("touchstart", e => {
    const t = e.touches[0]; y0 = t.clientY; x0 = t.clientX;
    surTexte = !!e.target.closest(".swipe-info");
  }, { passive: true });

  swipeConteneur.addEventListener("touchend", e => {
    if (swipeAnime) return;
    const t = e.changedTouches[0];
    const dy = t.clientY - y0, dx = t.clientX - x0;
    if (Math.abs(dy) < SEUIL || Math.abs(dx) > Math.abs(dy)) return; // pas un swipe vertical net
    if (dy < 0) {                       // vers le haut → plante suivante
      if (!surTexte || texteEnBas()) allerSlide(swipeIndex + 1);
    } else {                            // vers le bas → plante précédente
      if (!surTexte || texteEnHaut()) allerSlide(swipeIndex - 1);
    }
  }, { passive: true });

  // Molette / trackpad (ordinateur)
  let verrou = false;
  swipeConteneur.addEventListener("wheel", e => {
    const surInfo = !!e.target.closest(".swipe-info");
    const versBas = e.deltaY > 0;
    const bloque = versBas ? (!surInfo || texteEnBas()) : (!surInfo || texteEnHaut());
    if (!bloque) return;                // on laisse le texte défiler
    e.preventDefault();
    if (verrou || swipeAnime) return;
    if (Math.abs(e.deltaY) < 10) return; // ignore l'inertie faible (queue du trackpad)
    verrou = true;
    setTimeout(() => { verrou = false; }, 550);
    allerSlide(swipeIndex + (versBas ? 1 : -1));
  }, { passive: false });
}

/* ===================== QUIZZ (thématique) ===================== */
const POINTS_PAR_BONNE = 10;
const NB_QUESTIONS = 10;
let questions = [], qIndex = 0, qScore = 0, themeActuel = null;

// Catégories de quizz. champ = propriété testée ; options = jeu de réponses fixe ;
// poolFrom = on pioche les distracteurs parmi cette propriété ; photoSeule = on cache le nom (deviner la plante).
const QUIZZ_THEMES = [
  { id: "soleil",    emoji: "🌞", titre: "Exposition",           sous: "Plein soleil, mi-ombre ou ombre ?", couleur: "#e8a13a",
    champ: "soleil",   options: ["Plein soleil", "Mi-ombre", "Ombre"],   question: p => `Quelle exposition préfère « ${p.nom} » ?` },
  { id: "eau",       emoji: "💧", titre: "Arrosage",             sous: "Quels besoins en eau ?",            couleur: "#3f8fd0",
    champ: "eau",      options: ["Peu", "Modéré", "Souvent"],             question: p => `Quel arrosage convient à « ${p.nom} » ?` },
  { id: "terreau",   emoji: "🪴", titre: "Terreau",              sous: "Quel substrat utiliser ?",          couleur: "#9c7038",
    champ: "terreau",  options: TERREAUX,                                 question: p => `Quel terreau convient le mieux à « ${p.nom} » ?` },
  { id: "floraison", emoji: "🌸", titre: "Floraison",            sous: "À quelle saison ça fleurit ?",      couleur: "#d96e98",
    champ: "floraison",options: FLORAISONS,                               question: p => `À quelle saison fleurit « ${p.nom} » ?` },
  { id: "lieu",      emoji: "🏡", titre: "Intérieur / extérieur",sous: "Où la cultiver ?",                  couleur: "#2f6b46",
    champ: "lieu",     options: ["Intérieur", "Extérieur", "Les deux"],   question: p => `Où cultive-t-on plutôt « ${p.nom} » ?` },
  { id: "gel",       emoji: "❄️", titre: "Résistance au froid",  sous: "Jusqu'à quelle température ?",       couleur: "#4a90c2",
    champ: "gel",      options: GEL,                                      question: p => `Jusqu'à quel froid « ${p.nom} » résiste-t-elle ?` },
  { id: "feuillage", emoji: "🍃", titre: "Feuillage",            sous: "Persistant ou caduc ?",             couleur: "#6a9c3a",
    champ: "feuillage",options: FEUILLAGE,                                question: p => `Le feuillage de « ${p.nom} » est…` },
  { id: "cycle",     emoji: "♻️", titre: "Cycle de vie",         sous: "Annuelle, vivace, arbuste… ?",       couleur: "#b07a2e",
    champ: "cycle",    options: CYCLE,                                    question: p => `Quel est le cycle de vie de « ${p.nom} » ?` },
  { id: "latin",     emoji: "🔬", titre: "Nom latin",            sous: "Trouvez le nom scientifique",       couleur: "#7b61a8",
    champ: "latin",    poolFrom: "latin",                                 question: p => `Quel est le nom latin de « ${p.nom} » ?` },
  { id: "famille",   emoji: "🌿", titre: "Famille botanique",    sous: "À quelle famille appartient-elle ?",couleur: "#3a8f6f",
    champ: "famille",  poolFrom: "famille",                               question: p => `À quelle famille appartient « ${p.nom} » ?` },
  { id: "photo",     emoji: "📸", titre: "Reconnaître la photo", sous: "Quelle est cette plante ?",         couleur: "#d9694a",
    champ: "nom",      poolFrom: "nom", photoSeule: true,                 question: () => `Quelle est cette plante ?` },
  { id: "adaptatif", emoji: "🎯", titre: "Quizz adaptatif",      sous: "Revois tes erreurs, tous thèmes",   couleur: "#c0573e", adaptatif: true },
  { id: "mix",       emoji: "🎲", titre: "Quizz mêlé",           sous: "Toutes les catégories mélangées",   couleur: "#1f3d2b", mix: true },
];

function distracteurs(bonne, pool, n = 3) {
  return melanger([...new Set(pool)].filter(x => x !== bonne)).slice(0, n);
}

// Construit une question pour un thème donné et une plante donnée
function questionPourTheme(theme, p) {
  const bonne = p[theme.champ];
  let options;
  if (theme.options) {
    options = melanger(theme.options.slice());        // jeu fixe (toutes les réponses possibles)
  } else {
    const pool = PLANTES.map(x => x[theme.poolFrom]); // distracteurs piochés dans les données
    options = melanger([bonne, ...distracteurs(bonne, pool)]);
  }
  return { plante: p, q: theme.question(p), bonne, options, cacherNom: !!theme.photoSeule, themeId: theme.id, themeTitre: theme.titre };
}

// Thèmes « jouables » directement (un champ à tester) — exclut mix et adaptatif
function themesDeBase() { return QUIZZ_THEMES.filter(t => !t.mix && !t.adaptatif); }

function genererQuizz(theme) {
  if (theme.adaptatif) {
    // Repioche les erreurs passées (tous thèmes confondus), du plus récent au plus ancien
    const erreurs = lireStats().erreurs || [];
    const qs = [];
    melanger(erreurs.slice()).forEach(e => {
      const t = QUIZZ_THEMES.find(x => x.id === e.theme);
      const p = PLANTES.find(pl => pl.nom === e.plante);
      if (t && p) qs.push(questionPourTheme(t, p));
    });
    return qs.slice(0, NB_QUESTIONS);
  }
  const plantes = melanger(PLANTES).slice(0, NB_QUESTIONS);
  if (theme.mix) {
    const sous = themesDeBase();
    return plantes.map(p => {
      let st;
      do { st = sous[Math.floor(Math.random() * sous.length)]; } while (st.photoSeule && !srcImageGrande(p));
      return questionPourTheme(st, p);
    });
  }
  if (theme.photoSeule) {
    // Le quizz photo n'utilise que les plantes qui ont une image
    return melanger(PLANTES.filter(p => srcImageGrande(p))).slice(0, NB_QUESTIONS).map(p => questionPourTheme(theme, p));
  }
  return plantes.map(p => questionPourTheme(theme, p));
}

// Page d'accueil : hub avec toutes les catégories
function montrerAccueilQuizz() {
  const meilleur = lireClassement().reduce((m, r) => Math.max(m, r.points), 0);
  const nbErr = (lireStats().erreurs || []).length;
  const cartes = QUIZZ_THEMES.map(t => {
    let sous = t.sous;
    if (t.adaptatif) sous = nbErr ? `${nbErr} erreur${nbErr > 1 ? "s" : ""} à revoir` : "Aucune erreur — bravo !";
    const extra = t.mix ? "mix" : (t.adaptatif ? "adapt" : "");
    return `
    <button class="quizz-carte ${extra}" data-theme="${t.id}" style="--c:${t.couleur}">
      <span class="qc-emoji">${t.emoji}</span>
      <span class="qc-txt"><strong>${t.titre}</strong><span>${sous}</span></span>
      <span class="qc-fleche">›</span>
    </button>`;
  }).join("");
  document.getElementById("quizz").innerHTML = `
    <div class="quizz-hub">
      <div class="quizz-hub-tete">
        <span class="qh-pastille">🧠 Quizz</span>
        <h2>Testez vos connaissances</h2>
        <p>Choisissez un thème — ${NB_QUESTIONS} questions, ${POINTS_PAR_BONNE} pts par bonne réponse.${meilleur ? ` Votre record : <strong>${meilleur} pts</strong>.` : ""}</p>
      </div>
      <div class="quizz-grille">${cartes}</div>
    </div>`;
  document.querySelectorAll(".quizz-carte").forEach(b => {
    b.addEventListener("click", () => demarrerQuizz(b.dataset.theme));
  });
}

function demarrerQuizz(themeId) {
  themeActuel = QUIZZ_THEMES.find(t => t.id === themeId) || QUIZZ_THEMES[QUIZZ_THEMES.length - 1];
  questions = genererQuizz(themeActuel);
  if (!questions.length) {           // surtout : quizz adaptatif sans erreur à revoir
    document.getElementById("quizz").innerHTML = `
      <div class="quizz-hub">
        <div class="quizz-hub-tete">
          <span class="qh-pastille">${themeActuel.emoji} ${themeActuel.titre}</span>
          <h2>Rien à revoir pour l'instant</h2>
          <p>${themeActuel.adaptatif ? "Joue à quelques quizz : tes mauvaises réponses atterriront ici pour que tu puisses les retravailler. 🌱" : "Aucune question disponible."}</p>
        </div>
        <div style="text-align:center"><button class="btn-doux" id="retour-hub">← Retour aux thèmes</button></div>
      </div>`;
    document.getElementById("retour-hub").addEventListener("click", montrerAccueilQuizz);
    return;
  }
  qIndex = 0; qScore = 0;
  montrerQuestion();
}

function montrerQuestion() {
  const q = questions[qIndex];
  const prog = Math.round((qIndex / questions.length) * 100);
  const src = q.plante ? srcImageGrande(q.plante) : null;
  const photo = src ? `<div class="quizz-photo"><img src="${src}" alt="plante" onerror="this.closest('.quizz-photo').style.display='none'"></div>` : "";
  document.getElementById("quizz").innerHTML = `
    <div class="quizz-jeu">
      <div class="quizz-tete">
        <button class="quizz-retour" id="quizz-retour" aria-label="Retour aux thèmes">←</button>
        <span class="quizz-theme">${themeActuel.emoji} ${themeActuel.titre}</span>
      </div>
      <div class="quizz-barre"><i style="width:${prog}%"></i></div>
      <p class="quizz-compte">Question ${qIndex + 1} / ${questions.length} · ${qScore} pts</p>
      ${photo}
      <div class="quizz-question"><h3>${q.q}</h3></div>
      <div class="quizz-options">
        ${q.options.map(o => `<button class="opt">${o}</button>`).join("")}
      </div>
    </div>`;
  document.getElementById("quizz-retour").addEventListener("click", montrerAccueilQuizz);
  document.querySelectorAll("#quizz .opt").forEach(btn => {
    btn.addEventListener("click", () => repondre(btn, q));
  });
}

function repondre(btn, q) {
  const options = document.querySelectorAll("#quizz .opt");
  options.forEach(o => {
    o.disabled = true;
    if (o.textContent === q.bonne) o.classList.add("bon");
  });
  const bon = btn.textContent === q.bonne;
  if (bon) qScore += POINTS_PAR_BONNE;
  else btn.classList.add("mauvais");
  enregistrerReponse(q.themeId, q.plante ? q.plante.nom : "", bon);
  setTimeout(() => {
    qIndex++;
    if (qIndex < questions.length) montrerQuestion();
    else montrerFin();
  }, 850);
}

function montrerFin() {
  const sur = questions.length * POINTS_PAR_BONNE;
  let msg = "Pas mal, continuez à apprendre !";
  if (qScore === sur) msg = "Parfait ! Un vrai botaniste 🌟";
  else if (qScore >= sur * 0.6) msg = "Bravo, beau score ! 🌿";
  document.getElementById("quizz").innerHTML = `
    <div class="quizz-fin">
      <div class="quizz-fin-theme">${themeActuel.emoji} ${themeActuel.titre}</div>
      <div class="score">${qScore} <span>/ ${sur} pts</span></div>
      <p class="msg">${msg}</p>
      <div class="quizz-save">
        <input type="text" id="pseudo" placeholder="Votre prénom / pseudo" maxlength="18" />
        <button class="btn-vert" id="btn-save">Enregistrer mon score</button>
      </div>
      <div class="quizz-fin-actions">
        <button class="btn-doux" id="btn-rejouer">Rejouer ce quizz</button>
        <button class="btn-doux" id="btn-autres">Choisir un autre quizz</button>
      </div>
    </div>`;
  document.getElementById("btn-save").addEventListener("click", () => {
    const nom = (document.getElementById("pseudo").value || "").trim() || "Anonyme";
    enregistrerScore(nom, qScore, themeActuel.titre);
    naviguer("vue-classement");
  });
  document.getElementById("btn-rejouer").addEventListener("click", () => demarrerQuizz(themeActuel.id));
  document.getElementById("btn-autres").addEventListener("click", montrerAccueilQuizz);
}

/* ===================== STATISTIQUES (par thème + erreurs) ===================== */
const CLE_STATS = "herbier_stats";

function lireStats() {
  try {
    const s = JSON.parse(localStorage.getItem(CLE_STATS));
    if (s && s.parTheme) { s.erreurs = s.erreurs || []; return s; }
  } catch (e) {}
  return { parTheme: {}, erreurs: [] };
}
function ecrireStats(s) { localStorage.setItem(CLE_STATS, JSON.stringify(s)); }

// Enregistre une réponse : met à jour le score du thème + le pool d'erreurs (pour l'adaptatif)
function enregistrerReponse(themeId, planteNom, bon) {
  if (!themeId) return;
  const s = lireStats();
  if (!s.parTheme[themeId]) s.parTheme[themeId] = { total: 0, bons: 0 };
  s.parTheme[themeId].total++;
  if (bon) s.parTheme[themeId].bons++;
  const i = s.erreurs.findIndex(e => e.theme === themeId && e.plante === planteNom);
  if (bon) { if (i >= 0) s.erreurs.splice(i, 1); }           // maîtrisée → on retire
  else if (i < 0 && planteNom) s.erreurs.push({ theme: themeId, plante: planteNom });
  ecrireStats(s);
}

/* ===================== CLASSEMENT (local) ===================== */
const CLE_CLASSEMENT = "herbier_classement";

function lireClassement() {
  try { return JSON.parse(localStorage.getItem(CLE_CLASSEMENT)) || []; }
  catch (e) { return []; }
}
function enregistrerScore(nom, points, theme) {
  const liste = lireClassement();
  liste.push({ nom, points, theme: theme || "", t: Date.now() });
  liste.sort((a, b) => b.points - a.points);
  localStorage.setItem(CLE_CLASSEMENT, JSON.stringify(liste.slice(0, 50)));
  dernierNom = nom;
}
let dernierNom = null;

function afficherClassement() {
  const cont = document.getElementById("classement");
  const stats = lireStats();
  const themesJoues = themesDeBase().filter(t => stats.parTheme[t.id] && stats.parTheme[t.id].total > 0);
  const liste = lireClassement();
  let html = "";

  // 1) Résultats par thème (graphique en barres)
  if (themesJoues.length) {
    html += `<h3 class="clt-titre">📊 Résultats par thème</h3><div class="clt-graph">`;
    themesJoues.forEach(t => {
      const st = stats.parTheme[t.id];
      const pct = Math.round((st.bons / st.total) * 100);
      html += `
        <div class="clt-ligne">
          <div class="clt-label">${t.emoji} ${t.titre}</div>
          <div class="clt-barre"><i style="width:${pct}%;background:${t.couleur}"></i></div>
          <div class="clt-val">${pct}%<span> ${st.bons}/${st.total}</span></div>
        </div>`;
    });
    html += `</div>`;
    const totT = themesJoues.reduce((a, t) => a + stats.parTheme[t.id].total, 0);
    const totB = themesJoues.reduce((a, t) => a + stats.parTheme[t.id].bons, 0);
    html += `<p class="clt-global">Global : <strong>${Math.round((totB / totT) * 100)}%</strong> de bonnes réponses sur ${totT} questions.</p>`;
    const nbErr = stats.erreurs.length;
    html += nbErr
      ? `<button class="btn-vert clt-adapt" id="clt-adapt">🎯 Revoir mes ${nbErr} erreur${nbErr > 1 ? "s" : ""} (quizz adaptatif)</button>`
      : `<p class="clt-zero">🎉 Aucune erreur en attente — bravo !</p>`;
  } else {
    html += `<p class="classement-vide">Aucun résultat pour l'instant.<br>Jouez à un quizz pour voir vos stats par thème ! 🌿</p>`;
  }

  // 2) Meilleurs scores enregistrés
  if (liste.length) {
    const medailles = ["🥇", "🥈", "🥉"];
    const classes = ["or", "argent", "bronze"];
    html += `<h3 class="clt-titre">🏆 Meilleurs scores</h3>`;
    html += liste.map((r, i) => `
      <div class="rang ${classes[i] || ""} ${r.nom === dernierNom && r.points === liste[i].points ? "moi" : ""}">
        <div class="pos">${medailles[i] || (i + 1)}</div>
        <div class="nom">${r.nom}${r.theme ? `<span class="rang-theme">${r.theme}</span>` : ""}</div>
        <div class="pts">${r.points} pts</div>
      </div>`).join("");
  }

  cont.innerHTML = html;
  const adapt = document.getElementById("clt-adapt");
  if (adapt) adapt.addEventListener("click", () => { naviguer("vue-quizz"); demarrerQuizz("adaptatif"); });
}

/* ===================== ACCUEIL : animation pilotée au scroll ===================== */
(function () {
  const scene = document.getElementById("acc-scene");
  const wrap = scene ? scene.closest(".acc-wrap") : null;
  const hint = document.getElementById("acc-hint");
  if (!scene || !wrap) return;
  function majAccueil() {
    const acc = document.getElementById("vue-accueil");
    if (!acc || !acc.classList.contains("active")) return;
    const total = wrap.offsetHeight - window.innerHeight;
    const p = total > 0 ? Math.min(1, Math.max(0, -wrap.getBoundingClientRect().top / total)) : 0;
    scene.style.setProperty("--p", p.toFixed(4));
    if (hint) hint.style.opacity = p > 0.06 ? "0" : "";
  }
  majAccueil();
  addEventListener("scroll", () => requestAnimationFrame(majAccueil), { passive: true });
  addEventListener("resize", majAccueil);
})();

/* ===================== DÉMARRAGE ===================== */
afficher();
