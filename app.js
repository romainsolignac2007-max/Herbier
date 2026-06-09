/* ============================================================
   Herbier — application (navigation, recherche, swipe, quizz, classement)
   ============================================================ */

// Petites icônes
const ICONE_EAU = { "Peu": "💧", "Modéré": "💧💧", "Souvent": "💧💧💧" };
const ICONE_SOLEIL = { "Plein soleil": "☀️", "Mi-ombre": "⛅", "Ombre": "🌑" };
const ICONE_LIEU = { "Intérieur": "🏠", "Extérieur": "🌳", "Les deux": "🏠🌳" };

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
];
const recherche = { texte: "" };
const selections = { soleil: new Set(), eau: new Set(), lieu: new Set() };
const sectionsOuvertes = { soleil: true, eau: true, lieu: true };

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
  let html = `<div class="filtres-titre">Filtrer</div>`;
  CATEGORIES.forEach(cat => {
    const ouvert = sectionsOuvertes[cat.cle];
    const base = plantesFiltrees(cat.cle); // pour compter sans s'auto-exclure
    html += `
      <div class="filtre-section ${ouvert ? "ouvert" : ""}" data-cle="${cat.cle}">
        <button class="filtre-tete" data-toggle="${cat.cle}">
          <span>${cat.titre}</span><span class="chevron">⌄</span>
        </button>
        <div class="filtre-corps">
          ${cat.options.map(o => {
            const n = base.filter(p => plantePossede(cat.cle, o.val, p)).length;
            const coche = selections[cat.cle].has(o.val);
            return `
              <label class="filtre-opt ${n === 0 && !coche ? "vide" : ""}">
                <input type="checkbox" data-cle="${cat.cle}" data-val="${o.val}" ${coche ? "checked" : ""}>
                <span class="case"></span>
                <span class="opt-nom">${o.ico} ${o.val}</span>
                <span class="opt-nb">${n}</span>
              </label>`;
          }).join("")}
        </div>
      </div>`;
  });
  panneauFiltres.innerHTML = html;

  // Déplier / replier une section
  panneauFiltres.querySelectorAll(".filtre-tete").forEach(t => {
    t.addEventListener("click", () => {
      const cle = t.dataset.toggle;
      sectionsOuvertes[cle] = !sectionsOuvertes[cle];
      t.closest(".filtre-section").classList.toggle("ouvert", sectionsOuvertes[cle]);
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
      <div class="fiche-infos">
        <div class="info-box"><div class="ico">${ICONE_LIEU[p.lieu] || "🌿"}</div><div class="lib">Lieu</div><div class="val">${p.lieu}</div></div>
        <div class="info-box"><div class="ico">${ICONE_SOLEIL[p.soleil] || "🌿"}</div><div class="lib">Lumière</div><div class="val">${p.soleil}</div></div>
        <div class="info-box"><div class="ico">${ICONE_EAU[p.eau] || "🌿"}</div><div class="lib">Arrosage</div><div class="val">${p.eau}</div></div>
      </div>
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
function remplirAccueil() {
  // Stats
  const familles = new Set(PLANTES.map(p => p.famille)).size;
  document.getElementById("accueil-stats").innerHTML = `
    <div class="stat-bulle"><div class="nb">${PLANTES.length}</div><div class="lb">plantes</div></div>
    <div class="stat-bulle"><div class="nb">${familles}</div><div class="lb">familles</div></div>
    <div class="stat-bulle"><div class="nb">∞</div><div class="lb">à apprendre</div></div>`;
  // À la une : 3 plantes au hasard
  const une = melanger(PLANTES).slice(0, 3);
  const g = document.getElementById("grille-une");
  g.innerHTML = une.map(carteHTML).join("");
  brancherCartes(g);
}

/* ===================== MODE SWIPE (façon TikTok) ===================== */
function construireSwipe() {
  const c = document.getElementById("swipe-conteneur");
  c.innerHTML = melanger(PLANTES).map(p => {
    const src = srcImageGrande(p);
    const photo = src
      ? `<div class="swipe-photo"><img src="${src}" alt="${p.nom}"></div>`
      : `<div class="swipe-photo swipe-photo-emoji">${p.emoji || "🌿"}</div>`;
    return `
      <div class="swipe-slide">
        ${photo}
        <div class="swipe-info">
          <h2>${p.nom}</h2>
          <p class="latin">${p.latin} · ${p.famille}</p>
          <div class="swipe-tags">
            <span class="tag">${ICONE_LIEU[p.lieu] || ""} ${p.lieu}</span>
            <span class="tag">${ICONE_SOLEIL[p.soleil] || ""} ${p.soleil}</span>
            <span class="tag">${ICONE_EAU[p.eau] || ""} ${p.eau}</span>
          </div>
          <div class="swipe-bloc"><h3>👁️ Reconnaître</h3><p>${p.reconnaitre}</p></div>
          <div class="swipe-bloc"><h3>🪴 Entretenir</h3><p>${p.entretien}</p></div>
        </div>
      </div>`;
  }).join("");
}

/* ===================== QUIZZ ===================== */
const POINTS_PAR_BONNE = 10;
const NB_QUESTIONS = 8;
let questions = [], qIndex = 0, qScore = 0;

// Génère une banque de questions à partir des données des plantes
function genererBanque() {
  const banque = [];
  const famillesToutes = [...new Set(PLANTES.map(p => p.famille))];
  const latinsTous = PLANTES.map(p => p.latin);

  function distracteurs(bonne, pool, n = 3) {
    return melanger(pool.filter(x => x !== bonne)).slice(0, n);
  }

  PLANTES.forEach(p => {
    // Famille
    banque.push({
      plante: p,
      q: `À quelle famille appartient cette plante ?`,
      bonne: p.famille,
      options: melanger([p.famille, ...distracteurs(p.famille, famillesToutes)])
    });
    // Nom latin
    banque.push({
      plante: p,
      q: `Quel est le nom latin de « ${p.nom} » ?`,
      bonne: p.latin,
      options: melanger([p.latin, ...distracteurs(p.latin, latinsTous)])
    });
    // Arrosage
    banque.push({
      plante: p,
      q: `Quel arrosage convient à « ${p.nom} » ?`,
      bonne: p.eau,
      options: melanger([p.eau, ...distracteurs(p.eau, ["Peu", "Modéré", "Souvent"], 2)])
    });
    // Lumière
    banque.push({
      plante: p,
      q: `Quelle exposition préfère « ${p.nom} » ?`,
      bonne: p.soleil,
      options: melanger([p.soleil, ...distracteurs(p.soleil, ["Plein soleil", "Mi-ombre", "Ombre"], 2)])
    });
  });
  return banque;
}

function montrerAccueilQuizz() {
  const meilleur = lireClassement().reduce((m, r) => Math.max(m, r.points), 0);
  document.getElementById("quizz").innerHTML = `
    <div class="quizz-accueil">
      <div class="big">❓</div>
      <h2>Quizz des plantes</h2>
      <p>${NB_QUESTIONS} questions · ${POINTS_PAR_BONNE} points par bonne réponse${meilleur ? `<br>Meilleur score : <strong>${meilleur} pts</strong>` : ""}</p>
      <button class="btn-vert" id="btn-demarrer">Commencer le quizz</button>
    </div>`;
  document.getElementById("btn-demarrer").addEventListener("click", demarrerQuizz);
}

function demarrerQuizz() {
  questions = melanger(genererBanque()).slice(0, NB_QUESTIONS);
  qIndex = 0; qScore = 0;
  montrerQuestion();
}

function montrerQuestion() {
  const q = questions[qIndex];
  const prog = Math.round((qIndex / questions.length) * 100);
  const src = q.plante ? srcImageGrande(q.plante) : null;
  const photo = src ? `<div class="quizz-photo"><img src="${src}" alt="plante"></div>` : "";
  document.getElementById("quizz").innerHTML = `
    <div class="quizz-barre"><i style="width:${prog}%"></i></div>
    <p class="quizz-compte">Question ${qIndex + 1} / ${questions.length} · ${qScore} pts</p>
    ${photo}
    <div class="quizz-question"><h3>${q.q}</h3></div>
    <div class="quizz-options">
      ${q.options.map(o => `<button class="opt">${o}</button>`).join("")}
    </div>`;
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
  if (btn.textContent === q.bonne) {
    qScore += POINTS_PAR_BONNE;
  } else {
    btn.classList.add("mauvais");
  }
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
      <div class="score">${qScore} pts</div>
      <p class="msg">${msg}</p>
      <div class="quizz-save">
        <input type="text" id="pseudo" placeholder="Votre prénom / pseudo" maxlength="18" />
        <button class="btn-vert" id="btn-save">Enregistrer mon score</button>
      </div>
      <button class="btn-doux" id="btn-rejouer">Rejouer</button>
    </div>`;
  document.getElementById("btn-save").addEventListener("click", () => {
    const nom = (document.getElementById("pseudo").value || "").trim() || "Anonyme";
    enregistrerScore(nom, qScore);
    naviguer("vue-classement");
  });
  document.getElementById("btn-rejouer").addEventListener("click", demarrerQuizz);
}

/* ===================== CLASSEMENT (local) ===================== */
const CLE_CLASSEMENT = "herbier_classement";

function lireClassement() {
  try { return JSON.parse(localStorage.getItem(CLE_CLASSEMENT)) || []; }
  catch (e) { return []; }
}
function enregistrerScore(nom, points) {
  const liste = lireClassement();
  liste.push({ nom, points, t: Date.now() });
  liste.sort((a, b) => b.points - a.points);
  localStorage.setItem(CLE_CLASSEMENT, JSON.stringify(liste.slice(0, 50)));
  dernierNom = nom;
}
let dernierNom = null;

function afficherClassement() {
  const liste = lireClassement();
  const cont = document.getElementById("classement");
  if (liste.length === 0) {
    cont.innerHTML = `<p class="classement-vide">Aucun score pour l'instant.<br>Jouez au quizz pour entrer dans le classement ! 🏆</p>`;
    return;
  }
  const medailles = ["🥇", "🥈", "🥉"];
  const classes = ["or", "argent", "bronze"];
  cont.innerHTML = liste.map((r, i) => `
    <div class="rang ${classes[i] || ""} ${r.nom === dernierNom && r.points === liste[i].points ? "moi" : ""}">
      <div class="pos">${medailles[i] || (i + 1)}</div>
      <div class="nom">${r.nom}</div>
      <div class="pts">${r.points} pts</div>
    </div>`).join("");
}

/* ===================== DÉMARRAGE ===================== */
remplirAccueil();
afficher();
