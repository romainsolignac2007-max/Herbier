/* ===== Logique du site Herbier ===== */

const grille = document.getElementById("grille");
const compteur = document.getElementById("compteur");
const aucun = document.getElementById("aucun");
const champRecherche = document.getElementById("recherche");
const overlay = document.getElementById("overlay");
const ficheContenu = document.getElementById("fiche-contenu");

// État courant des filtres
const filtres = { texte: "", lieu: "", soleil: "", eau: "" };

// Petites icônes selon la quantité d'eau
const ICONE_EAU = { "Peu": "💧", "Modéré": "💧💧", "Souvent": "💧💧💧" };
const ICONE_SOLEIL = { "Plein soleil": "☀️", "Mi-ombre": "⛅", "Ombre": "🌑" };
const ICONE_LIEU = { "Intérieur": "🏠", "Extérieur": "🌳", "Les deux": "🏠🌳" };

// Construit l'image d'une carte (photo si dispo, sinon emoji)
function imageHTML(plante, classe) {
  if (plante.photo) {
    return `<div class="${classe}"><img src="images/${plante.photo}" alt="${plante.nom}" onerror="this.parentNode.textContent='${plante.emoji || "🌿"}'"></div>`;
  }
  return `<div class="${classe}">${plante.emoji || "🌿"}</div>`;
}

// Affiche les cartes correspondant aux filtres
function afficher() {
  const t = filtres.texte.toLowerCase().trim();

  const resultats = PLANTES.filter((p) => {
    const matchTexte =
      !t ||
      p.nom.toLowerCase().includes(t) ||
      p.latin.toLowerCase().includes(t) ||
      p.famille.toLowerCase().includes(t);
    const matchLieu = !filtres.lieu || p.lieu === filtres.lieu || p.lieu === "Les deux";
    const matchSoleil = !filtres.soleil || p.soleil === filtres.soleil;
    const matchEau = !filtres.eau || p.eau === filtres.eau;
    return matchTexte && matchLieu && matchSoleil && matchEau;
  });

  grille.innerHTML = resultats
    .map(
      (p, i) => `
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
      </article>`
    )
    .join("");

  // Compteur + message vide
  const n = resultats.length;
  compteur.textContent = n === 0 ? "" : `${n} plante${n > 1 ? "s" : ""} trouvée${n > 1 ? "s" : ""}`;
  aucun.hidden = n !== 0;

  // Clic sur une carte -> ouvre la fiche
  document.querySelectorAll(".carte").forEach((carte) => {
    carte.addEventListener("click", () => ouvrirFiche(PLANTES[carte.dataset.index]));
  });
}

// Ouvre la fiche détaillée d'une plante
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

      <div class="bloc">
        <h3>👁️ Comment la reconnaître</h3>
        <p>${p.reconnaitre}</p>
      </div>
      <div class="bloc">
        <h3>🪴 Comment l'entretenir</h3>
        <p>${p.entretien}</p>
      </div>
      ${p.saison ? `<div class="bloc"><h3>📅 Saison</h3><p>${p.saison}</p></div>` : ""}
    </div>
  `;
  overlay.hidden = false;
  document.body.style.overflow = "hidden";
}

function fermerFiche() {
  overlay.hidden = true;
  document.body.style.overflow = "";
}

// ===== Écouteurs =====
champRecherche.addEventListener("input", (e) => {
  filtres.texte = e.target.value;
  afficher();
});

document.querySelectorAll(".filtre-groupe").forEach((groupe) => {
  const cle = groupe.dataset.filtre;
  groupe.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      groupe.querySelectorAll(".chip").forEach((c) => c.classList.remove("actif"));
      chip.classList.add("actif");
      filtres[cle] = chip.dataset.valeur;
      afficher();
    });
  });
});

document.getElementById("fermer").addEventListener("click", fermerFiche);
overlay.addEventListener("click", (e) => { if (e.target === overlay) fermerFiche(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") fermerFiche(); });

// Premier affichage
afficher();
