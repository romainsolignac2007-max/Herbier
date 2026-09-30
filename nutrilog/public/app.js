/* ============================================================
   NutriLog — interface (secrétariat, tablettes préparateurs, admin)
   ============================================================ */
"use strict";

/* ---------- État global ---------- */
const S = {
  moi: null,
  etat: null,         // données renvoyées par /api/etat (filtrées selon le rôle)
  onglet: "",
  recherche: "",
  filtre: "",
  filtreUnivers: "", filtreMarque: "", filtreFiche: "", // onglet Produits
  modale: null,       // fonction qui (re)dessine la modale ouverte
  modaleFormulaire: false, // true = formulaire de saisie : on ne le redessine jamais automatiquement
  minuteur: null,
  horsLigne: false,
  seqEnvoi: 0,        // numéro de la dernière demande d'état envoyée…
  seqApplique: 0,     // …et de la dernière appliquée : une réponse en retard n'écrase jamais un état plus récent
  audit: null,        // journal d'audit chargé (rechargé seulement sur demande)
  ancienId: null,     // utilisateur dont la session a expiré (pour lui rendre sa saisie après reconnexion)
};

const LIB_STATUT = { brouillon: "Brouillon", a_preparer: "À préparer", en_preparation: "En préparation", preparee: "Préparée", expediee: "Expédiée", annulee: "Annulée" };
const LIB_ROLE = { admin: "Administrateur", secretariat: "Secrétariat", preparateur: "Préparateur" };
const LIB_CONS = { ambiant: "Ambiant", frais: "Frais (0–4 °C)", surgele: "Surgelé (−18 °C)" };
const LIB_CAT = { chien: "Chien", chat: "Chat", cheval: "Cheval", bassecour: "Basse-cour", cereales: "Céréales", rongeur: "Rongeur", oiseau: "Oiseau", autre: "Autre" };
/* Nom affiché d'une référence : le produit du catalogue + son format (un même produit existe en plusieurs poids) */
const libelle = (p) => (p ? p.nom + (p.poids ? " — " + p.poids : "") : "?");
const libelleSaisie = (p) => `${libelle(p)} [${p.reference || p.id}]`; // unique : sert à retrouver le produit tapé
const badgeCons = (c) => (c && c !== "ambiant" ? `<span class="pastille cons-${h(c)}">${c === "frais" ? "FRAIS" : "SURGELÉ"}</span>` : "");

/* ---------- Utilitaires ---------- */
const $ = (sel) => document.querySelector(sel);
const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—");
const fmtJour = (j) => (j ? new Date(j + "T00:00:00").toLocaleDateString("fr-FR") : "—");
const produit = (id) => (S.etat.produits || []).find((p) => p.id === id);
const client = (id) => (S.etat.clients || []).find((c) => c.id === id);
const poste = (id) => (S.etat.postes || []).find((p) => p.id === id);
const nomPoste = (id) => (poste(id) ? poste(id).nom : "?");
const etapeCourante = (c) => (c.etapes && c.etapes[c.etapeIndex]) || null;
const estClos = (c) => c.statut === "expediee" || c.statut === "annulee";
const jourLocal = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const aujourdhui = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }; // date LOCALE
/* Quantité d'un produit réservée par les commandes envoyées en préparation et pas encore expédiées */
const stockActif = () => !!(S.etat && S.etat.gestionStock); // gestion du stock : désactivée pour l'instant
const reserve = (pid) => (S.etat.commandes || []).filter((c) => c.stockReserve && ["a_preparer", "en_preparation", "preparee"].includes(c.statut))
  .reduce((t, c) => t + c.lignes.filter((l) => l.produitId === pid).reduce((u, l) => u + l.quantite, 0), 0);
const pastille = (statut) => `<span class="pastille p-${h(statut)}">${h(LIB_STATUT[statut] || statut)}</span>`;

function toast(msg, erreur) {
  const t = $("#toast");
  t.textContent = msg; t.className = "toast" + (erreur ? " erreur" : ""); t.hidden = false;
  clearTimeout(t._m); t._m = setTimeout(() => (t.hidden = true), erreur ? 5000 : 2500);
}

async function api(methode, url, corps) {
  let rep;
  try {
    rep = await fetch(url, {
      method: methode,
      headers: { "X-Requested-With": "NutriLog", ...(corps ? { "Content-Type": "application/json" } : {}) },
      body: corps ? JSON.stringify(corps) : undefined,
      credentials: "same-origin",
    });
  } catch (e) {
    setHorsLigne(true);
    throw new Error("Serveur injoignable. Vérifiez le réseau.");
  }
  setHorsLigne(false);
  const data = await rep.json().catch(() => ({}));
  if (rep.status === 401 && !url.endsWith("/connexion")) {
    if (S.moi) montrerConnexion("Votre session a expiré ou a été fermée : reconnectez-vous. Votre saisie en cours est conservée.");
    throw new Error(data.erreur || "Connexion requise.");
  }
  if (rep.status === 403 && data.doitChangerMdp) { montrerMdp(true); throw new Error(data.erreur); }
  if (!rep.ok) { const e = new Error(data.erreur || "Erreur " + rep.status); e.data = data; throw e; }
  return data;
}

function setHorsLigne(v) {
  S.horsLigne = v;
  const b = $("#badge-connexion");
  if (b) { b.classList.toggle("hors-ligne", v); b.title = v ? "Serveur injoignable" : "Connecté au serveur"; }
}

/* ---------- Écrans ---------- */
/* motif : message affiché (session expirée). Un formulaire en cours de saisie n'est pas détruit :
   il est masqué et rendu à la MÊME personne si elle se reconnecte (jamais à un autre compte). */
function montrerConnexion(motif) {
  clearInterval(S.minuteur);
  S.ancienId = motif && S.moi ? S.moi.id : null;
  // Fenêtre à garder pour la même personne : formulaire, ou fiche commande avec une saisie non enregistrée
  const saisieEnCours = S.modaleFormulaire || $("#modale-contenu [data-non-sauve]")
    || ["#prep-remarque", "#exp-transporteur", "#exp-suivi", "#modale-contenu form[data-form=message] input"].some((sel) => $(sel)?.value);
  if (motif && S.modale && saisieEnCours) $("#voile").hidden = true; else fermerModale();
  if (!motif) { S.recherche = ""; S.onglet = ""; } // déconnexion volontaire : rien ne passe à la personne suivante
  S.moi = null; S.etat = null; S.audit = null;
  // L'écran de la session précédente est effacé : la personne suivante ne doit rien en voir
  $("#contenu").innerHTML = ""; $("#onglets").innerHTML = ""; $("#qui").textContent = "";
  $("#app").hidden = true; $("#ecran-mdp").hidden = true; $("#ecran-connexion").hidden = false;
  $("#form-connexion").reset();
  $("#erreur-connexion").textContent = motif || ""; $("#erreur-connexion").hidden = !motif;
  setTimeout(() => $("#form-connexion input[name=login]").focus(), 50);
}

function montrerMdp(obligatoire) {
  $("#ecran-connexion").hidden = true; $("#app").hidden = !!obligatoire; $("#ecran-mdp").hidden = false;
  $("#form-mdp").reset(); $("#erreur-mdp").hidden = true;
  $("#mdp-annuler").hidden = !!obligatoire;
  $("#mdp-explication").textContent = obligatoire
    ? "Première connexion : choisissez un mot de passe personnel (12 caractères minimum, lettres et chiffres). Ne le communiquez à personne."
    : "Nouveau mot de passe : 12 caractères minimum, lettres et chiffres.";
  setTimeout(() => $("#form-mdp input[name=ancien]").focus(), 50);
}

async function montrerApp() {
  const reprise = !!S.modale;
  try {
    await rafraichir(true); // l'application n'est affichée qu'une fois les données de CETTE personne reçues
  } catch (e) {
    if (!S.moi) return; // déjà renvoyé à la connexion (session refusée)
    montrerConnexion(); $("#erreur-connexion").textContent = e.message; $("#erreur-connexion").hidden = false;
    return;
  }
  $("#ecran-connexion").hidden = true; $("#ecran-mdp").hidden = true; $("#app").hidden = false;
  if (reprise) {
    if (S.moi.id === S.ancienId) { $("#voile").hidden = false; redessinerModale(); }
    else fermerModale();
  }
  if (S.ancienId && S.moi.id !== S.ancienId) { S.recherche = ""; S.onglet = ""; } // autre personne : on repart de zéro
  S.ancienId = null;
  if (!onglets().some(([id]) => id === S.onglet)) S.onglet = S.moi.role === "preparateur" ? "afaire" : "commandes";
  dessiner();
  clearInterval(S.minuteur);
  S.minuteur = setInterval(() => rafraichir(false).catch(() => {}), 4000);
}

async function rafraichir(force) {
  const seq = ++S.seqEnvoi;
  const etat = await api("GET", "/api/etat");
  if (seq < S.seqApplique) return; // réponse dépassée par une demande plus récente : ignorée
  S.seqApplique = seq;
  const signature = (e) => e.commandes.map((c) => c.id).join();
  const change = force || !S.etat || etat.derniereMaj !== S.etat.derniereMaj || signature(etat) !== signature(S.etat) || jourLocal(new Date()) !== S.jour;
  S.jour = jourLocal(new Date());
  S.etat = etat; S.moi = etat.moi;
  $("#qui").textContent = `${S.moi.nom} · ${LIB_ROLE[S.moi.role]}${S.moi.role === "preparateur" ? " (" + (S.moi.postes.map(nomPoste).join(", ") || "aucun poste") + ")" : ""}`;
  if (change && !force) { dessiner(); redessinerModale(); }
}

/* Redessine la modale ouverte SANS perdre ce que l'utilisateur est en train de saisir
   (remarque, transporteur, message, lot/DLC) ni le focus. Un formulaire de saisie n'est jamais
   redessiné automatiquement : il sera simplement validé sur des données à jour côté serveur. */
function redessinerModale() {
  if (!S.modale || S.modaleFormulaire) return;
  const cont = $("#modale-contenu");
  const actif = document.activeElement;
  const cle = (el) => el.id || (el.dataset.lot !== undefined ? "lot" + el.dataset.lot : el.dataset.dlc !== undefined ? "dlc" + el.dataset.dlc : el.name);
  const sauve = new Map();
  const saisieLibre = (el) => !el.dataset.lot && !el.dataset.dlc; // remarque, transporteur, message…
  cont.querySelectorAll("input:not([type=checkbox]),textarea").forEach((el) => sauve.set(cle(el), { v: el.value, focus: el === actif, nonSauve: !!el.dataset.nonSauve, libre: saisieLibre(el), s: el.selectionStart, e: el.selectionEnd }));
  const defilement = cont.parentElement.scrollTop;
  S.modale();
  cont.parentElement.scrollTop = defilement;
  cont.querySelectorAll("input:not([type=checkbox]),textarea").forEach((el) => {
    const s = sauve.get(cle(el)); if (!s) return;
    // Lot / DDM : la valeur du serveur fait foi, sauf saisie en cours ou pas encore enregistrée (réseau coupé)
    if (s.focus || s.nonSauve || (s.libre && s.v && !el.value)) el.value = s.v;
    if (s.nonSauve) marquerNonSauve(el, true);
    if (s.focus) { el.focus(); try { el.setSelectionRange(s.s, s.e); } catch (e) { /* type=date */ } }
  });
}

function marquerNonSauve(el, oui) {
  if (oui) el.dataset.nonSauve = "1"; else delete el.dataset.nonSauve;
  el.classList.toggle("non-sauve", oui);
  el.title = oui ? "Pas encore enregistré (réseau ?) — sera renvoyé automatiquement" : "";
}

/* Envoie une saisie lot / DDM ; en cas d'échec le champ reste marqué et sera renvoyé avant « Terminer ». */
async function envoyerLotDlc(id, el) {
  const i = Number(el.dataset.lot ?? el.dataset.dlc);
  const corps = { index: i }; // pas de « fait » : la case de la ligne n'est pas touchée par une saisie de lot
  if (el.dataset.lot !== undefined) corps.lot = el.value; else corps.dlc = el.value;
  marquerNonSauve(el, true);
  await api("POST", `/api/commandes/${id}/ligne`, corps);
  marquerNonSauve(el, false);
}

/* ---------- Navigation ---------- */
function onglets() {
  const r = S.moi.role;
  const cs = S.etat.commandes || [];
  if (r === "preparateur") {
    const mesPostes = S.moi.postes;
    const aFaire = cs.filter((c) => c.statut === "a_preparer" && etapeCourante(c) && mesPostes.includes(etapeCourante(c).posteId)).length;
    const enCours = cs.filter((c) => c.statut === "en_preparation" && etapeCourante(c) && etapeCourante(c).preparateurId === S.moi.id).length;
    return [["afaire", "À faire", aFaire], ["encours", "En cours", enCours], ["terminees", "Terminées"]];
  }
  const l = [["commandes", "Commandes", cs.filter((c) => c.statut === "preparee").length], ["produits", "Produits & fiches"], ["clients", "Clients"]];
  if (r === "admin") l.push(["utilisateurs", "Utilisateurs"], ["postes", "Postes"], ["audit", "Audit"]);
  return l;
}

function dessiner() {
  // Le champ de recherche est reconstruit : on lui rend le focus et le curseur
  const a = document.activeElement;
  const garde = a && a.matches && a.matches("#contenu [data-recherche]") ? { s: a.selectionStart, e: a.selectionEnd } : null;
  const defilement = window.scrollY;
  $("#onglets").innerHTML = onglets().map(([id, lib, n]) => `<button class="onglet${S.onglet === id ? " actif" : ""}" data-onglet="${id}">${h(lib)}${n ? `<span class="compteur">${n}</span>` : ""}</button>`).join("");
  const vues = { commandes: vueCommandes, produits: vueProduits, clients: vueClients, utilisateurs: vueUtilisateurs, postes: vuePostes, audit: vueAudit, afaire: vueAFaire, encours: vueEnCours, terminees: vueTerminees };
  const f = vues[S.onglet] || vueCommandes;
  $("#contenu").innerHTML = f();
  window.scrollTo(0, defilement);
  if (garde) { const i = $("#contenu [data-recherche]"); if (i) { i.focus(); try { i.setSelectionRange(garde.s, garde.e); } catch (e) { /* */ } } }
}

/* =====================================================================
   VUES SECRÉTARIAT
   ===================================================================== */
function carteCmd(c) {
  const cl = client(c.clientId);
  const e = etapeCourante(c);
  let ou = "";
  if (c.statut === "a_preparer" && e) ou = `Attend le poste <b>${h(nomPoste(e.posteId))}</b>`;
  if (c.statut === "en_preparation" && e) ou = `En cours : ${h(nomPoste(e.posteId))} — ${h(e.preparateur)}`;
  if (c.statut === "preparee") ou = `Prête, à expédier`;
  return `<div class="cmd${c.priorite === "urgente" ? " urgente" : ""}" data-ouvrir="${c.id}">
    <div class="titre"><span>${h(cl ? cl.nom : "(sans client)")}</span><span class="num">n° ${c.numero}</span></div>
    <div class="meta">${c.lignes.length} ligne${c.lignes.length > 1 ? "s" : ""} · livraison ${fmtJour(c.dateLivraisonSouhaitee)} ${c.priorite === "urgente" ? '<span class="pastille p-urgente">URGENT</span>' : ""}</div>
    ${ou ? `<div class="meta">${ou}</div>` : ""}
    ${c.messages && c.messages.length ? `<div class="messages-nb">${c.messages.length} message${c.messages.length > 1 ? "s" : ""}</div>` : ""}
  </div>`;
}

function filtrerCommandes(liste) {
  const q = S.recherche.trim().toLowerCase();
  if (!q) return liste;
  return liste.filter((c) => {
    const cl = client(c.clientId);
    return String(c.numero).includes(q) || (cl && cl.nom.toLowerCase().includes(q)) || c.lignes.some((l) => { const p = produit(l.produitId); return p && p.nom.toLowerCase().includes(q); });
  });
}

function vueCommandes() {
  const cs = filtrerCommandes(S.etat.commandes).slice().sort((a, b) => (b.priorite === "urgente") - (a.priorite === "urgente") || a.numero - b.numero);
  const col = (statut, titre) => {
    const l = cs.filter((c) => c.statut === statut);
    return `<div class="colonne"><h3><span>${h(titre)}</span><span>${l.length}</span></h3><div class="pile">${l.length ? l.map(carteCmd).join("") : '<div class="vide">Aucune</div>'}</div></div>`;
  };
  const dateClot = (c) => c.expedieeLe || (c.historique[c.historique.length - 1] || {}).date || "";
  const closes = cs.filter(estClos).sort((a, b) => dateClot(b).localeCompare(dateClot(a)) || b.numero - a.numero).slice(0, 30); // les 30 plus récentes
  return `
    <div class="barre-outils">
      <button class="btn btn-primaire" data-action="nouvelle-commande">Nouvelle commande (mail reçu)</button>
      <input type="search" placeholder="Rechercher n°, client, produit…" value="${h(S.recherche)}" data-recherche />
    </div>
    <div class="colonnes">
      ${col("brouillon", "Brouillons (à compléter)")}
      ${col("a_preparer", "En attente d'un poste")}
      ${col("en_preparation", "En préparation")}
      ${col("preparee", "Préparées → à expédier")}
    </div>
    <h2 class="mt">Commandes closes — les 30 plus récentes</h2>
    <div class="tableau-scroll"><table class="tableau"><thead><tr><th>N°</th><th>Client</th><th>Statut</th><th>Créée</th><th>Clôturée</th><th>Transporteur / suivi</th></tr></thead><tbody>
      ${closes.length ? closes.map((c) => `<tr class="cliquable" data-ouvrir="${c.id}"><td>${c.numero}</td><td>${h(client(c.clientId)?.nom || "—")}</td><td>${pastille(c.statut)}</td><td>${fmtDate(c.creeLe)}</td><td>${fmtDate(c.expedieeLe || (c.historique[c.historique.length - 1] || {}).date)}</td><td>${h(c.transporteur || "")} ${h(c.suivi || "")}</td></tr>`).join("") : '<tr><td colspan="6" class="vide">Aucune commande close</td></tr>'}
    </tbody></table></div>`;
}

const ficheComplete = (p) => !!p.preparation.instructions && S.etat.postes.every((po) => p.preparation.parPoste?.[po.id]);

function produitsFiltres() {
  const mots = S.recherche.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return S.etat.produits.filter((p) => {
    if (S.filtreUnivers && p.categorie !== S.filtreUnivers) return false;
    if (S.filtreMarque && p.marque !== S.filtreMarque) return false;
    if (S.filtreFiche === "ko" && ficheComplete(p)) return false;
    if (S.filtreFiche === "ok" && !ficheComplete(p)) return false;
    if (S.filtreFiche === "sansstock" && p.stock > 0) return false;
    const texte = [p.nom, p.poids, p.marque, p.gamme, p.reference, p.emplacement].join(" ").toLowerCase();
    return mots.every((m) => texte.includes(m)); // « ownat chiot 14 » trouve le bon format
  });
}

function vueProduits() {
  const ps = produitsFiltres();
  const postes = S.etat.postes;
  const tous = S.etat.produits;
  const marques = [...new Set(tous.map((p) => p.marque).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
  const univers = [...new Set(tous.map((p) => p.categorie))];
  const aCompleter = tous.filter((p) => !ficheComplete(p)).length;
  const opt = (v, lib, cour) => `<option value="${h(v)}" ${v === cour ? "selected" : ""}>${h(lib)}</option>`;
  return `
    <div class="barre-outils">
      <button class="btn btn-primaire" data-action="nouveau-produit">Nouveau produit</button>
      <button class="btn btn-secondaire" data-action="importer-catalogue">Importer / mettre à jour depuis le site</button>
      <input type="search" placeholder="Rechercher : nom, marque, poids, référence…" value="${h(S.recherche)}" data-recherche />
    </div>
    <div class="barre-outils filtres">
      <select data-filtre="filtreUnivers" aria-label="Univers">${opt("", "Tous les univers", S.filtreUnivers)}${univers.map((u) => opt(u, LIB_CAT[u] || u, S.filtreUnivers)).join("")}</select>
      <select data-filtre="filtreMarque" aria-label="Marque">${opt("", "Toutes les marques", S.filtreMarque)}${marques.map((m) => opt(m, m, S.filtreMarque)).join("")}</select>
      <select data-filtre="filtreFiche" aria-label="État">${opt("", "Toutes les fiches", S.filtreFiche)}${opt("ko", `Fiche à compléter (${aCompleter})`, S.filtreFiche)}${opt("ok", "Fiche complète", S.filtreFiche)}${stockActif() ? opt("sansstock", "Sans stock", S.filtreFiche) : ""}</select>
      <span class="compte">${ps.length} / ${tous.length} références</span>
      ${ps.length ? `<button class="btn btn-secondaire btn-petit" data-action="fiche-type">Fiche type pour ces ${ps.length} références</button>` : ""}
    </div>
    <p class="aide">Une commande ne peut partir en préparation que si chaque produit a sa fiche de préparation complète (instructions générales + consigne pour chaque poste du circuit).${stockActif() ? " Le stock affiché est le stock <b>disponible</b> : les quantités des commandes envoyées en préparation sont déjà réservées." : ""}</p>
    <div class="tableau-scroll"><table class="tableau"><thead><tr><th>Produit</th><th>Marque</th><th>Univers</th><th>Conservation</th>${stockActif() ? `<th title="Stock physique moins les commandes en préparation">Stock dispo.</th><th>Réservé</th>` : ""}<th>Empl.</th><th>Fiche générale</th>${postes.map((p) => `<th>${h(p.nom)}</th>`).join("")}</tr></thead><tbody>
      ${ps.map((p) => `<tr class="cliquable" data-produit="${p.id}">
        <td><b>${h(p.nom)}</b>${p.poids ? ` <span class="poids">${h(p.poids)}</span>` : ""}</td><td>${h(p.marque || "—")}</td><td>${h(LIB_CAT[p.categorie] || "—")}</td><td>${h(LIB_CONS[p.conservation] || "Ambiant")}</td>
        ${stockActif() ? `<td class="${p.stock <= 5 ? "stock-bas" : ""}">${p.stock} ${h(p.unite)}</td><td>${reserve(p.id) || "—"}</td>` : ""}<td>${h(p.emplacement)}</td>
        <td class="${p.preparation.instructions ? "fiche-ok" : "fiche-ko"}">${p.preparation.instructions ? "complète" : "manquante"}</td>
        ${postes.map((po) => `<td class="${p.preparation.parPoste?.[po.id] ? "fiche-ok" : "fiche-ko"}">${p.preparation.parPoste?.[po.id] ? "oui" : "à faire"}</td>`).join("")}
      </tr>`).join("") || '<tr><td colspan="12" class="vide">Aucun produit</td></tr>'}
    </tbody></table></div>`;
}

function vueClients() {
  const q = S.recherche.trim().toLowerCase();
  const cs = S.etat.clients.filter((c) => !q || c.nom.toLowerCase().includes(q) || (c.email || "").toLowerCase().includes(q));
  return `
    <div class="barre-outils">
      <button class="btn btn-primaire" data-action="nouveau-client">Nouveau client</button>
      <input type="search" placeholder="Rechercher un client…" value="${h(S.recherche)}" data-recherche />
    </div>
    <div class="tableau-scroll"><table class="tableau"><thead><tr><th>Client</th><th>E-mail</th><th>Téléphone</th><th>Adresse</th><th>Commandes</th></tr></thead><tbody>
      ${cs.map((c) => `<tr class="cliquable" data-client="${c.id}"><td><b>${h(c.nom)}</b></td><td>${h(c.email)}</td><td>${h(c.telephone)}</td><td>${h(c.adresse)}</td><td>${S.etat.commandes.filter((x) => x.clientId === c.id).length}</td></tr>`).join("") || '<tr><td colspan="5" class="vide">Aucun client</td></tr>'}
    </tbody></table></div>`;
}

/* =====================================================================
   VUES PRÉPARATEUR (tablette)
   ===================================================================== */
function carteTablette(c) {
  const e = etapeCourante(c);
  const cl = client(c.clientId);
  const dureeTotale = c.lignes.reduce((s, l) => s + ((produit(l.produitId)?.preparation.dureeMin || 0) * 1), 0);
  return `<div class="cmd${c.priorite === "urgente" ? " urgente" : ""}" data-ouvrir="${c.id}">
    <div class="titre"><span>n° ${c.numero} — ${h(cl ? cl.nom : "")}</span>${c.priorite === "urgente" ? '<span class="pastille p-urgente">URGENT</span>' : ""}</div>
    <div class="meta">Poste : <b>${h(e ? nomPoste(e.posteId) : "—")}</b> · ${c.lignes.length} ligne${c.lignes.length > 1 ? "s" : ""}${dureeTotale ? ` · ≈ ${dureeTotale} min` : ""} · livraison ${fmtJour(c.dateLivraisonSouhaitee)}</div>
    ${e && e.preparateur ? `<div class="meta">Pris par ${h(e.preparateur)}</div>` : ""}
    ${c.messages && c.messages.length ? `<div class="messages-nb">${c.messages.length} message${c.messages.length > 1 ? "s" : ""}</div>` : ""}
  </div>`;
}

function vueAFaire() {
  const l = S.etat.commandes.filter((c) => c.statut === "a_preparer" && etapeCourante(c) && S.moi.postes.includes(etapeCourante(c).posteId))
    .sort((a, b) => (b.priorite === "urgente") - (a.priorite === "urgente") || (a.dateLivraisonSouhaitee || "9").localeCompare(b.dateLivraisonSouhaitee || "9") || a.numero - b.numero);
  if (!S.moi.postes.length) return `<div class="alerte">Aucun poste ne vous est affecté. Demandez à l'administrateur.</div>`;
  return `<h2>À faire — poste${S.moi.postes.length > 1 ? "s" : ""} ${h(S.moi.postes.map(nomPoste).join(", "))}</h2>
    <div class="grille">${l.length ? l.map(carteTablette).join("") : '<div class="vide">Rien en attente pour votre poste.</div>'}</div>`;
}

function vueEnCours() {
  const l = S.etat.commandes.filter((c) => c.statut === "en_preparation" && etapeCourante(c) && etapeCourante(c).preparateurId === S.moi.id);
  const autres = S.etat.commandes.filter((c) => c.statut === "en_preparation" && etapeCourante(c) && etapeCourante(c).preparateurId !== S.moi.id && S.moi.postes.includes(etapeCourante(c).posteId));
  return `<h2>Mes commandes en cours</h2>
    <div class="grille">${l.length ? l.map(carteTablette).join("") : '<div class="vide">Aucune commande en cours. Prenez-en une dans « À faire ».</div>'}</div>
    ${autres.length ? `<h2 class="mt">En cours par un collègue de mon poste</h2><div class="grille">${autres.map(carteTablette).join("")}</div>` : ""}`;
}

function vueTerminees() {
  const auj = aujourdhui();
  const miennes = (c) => c.etapes.filter((e) => e.preparateurId === S.moi.id && e.statut === "faite" && e.fin && jourLocal(e.fin) === auj);
  const l = S.etat.commandes.filter((c) => miennes(c).length).sort((a, b) => b.numero - a.numero);
  return `<h2>Terminées aujourd'hui</h2>
    <p class="aide">La liste repart à zéro chaque jour à minuit : les commandes des jours précédents ne sont plus accessibles depuis la tablette.</p>
    <div class="tableau-scroll"><table class="tableau"><thead><tr><th>N°</th><th>Client</th><th>Mon poste</th><th>Terminée le</th><th>Statut actuel</th></tr></thead><tbody>
      ${l.length ? l.flatMap((c) => miennes(c).map((e) => `<tr class="cliquable" data-ouvrir="${c.id}"><td>${c.numero}</td><td>${h(client(c.clientId)?.nom || "")}</td><td>${h(nomPoste(e.posteId))}</td><td>${fmtDate(e.fin)}</td><td>${pastille(c.statut)}</td></tr>`)).join("") : '<tr><td colspan="5" class="vide">Rien terminé aujourd\'hui pour l\'instant</td></tr>'}
    </tbody></table></div>`;
}

/* =====================================================================
   VUES ADMIN
   ===================================================================== */
function vueUtilisateurs() {
  const us = S.etat.utilisateurs || [];
  return `
    <div class="barre-outils"><button class="btn btn-primaire" data-action="nouvel-utilisateur">Nouvel utilisateur</button></div>
    <p class="aide">Un identifiant par personne. Chaque nouvel utilisateur doit changer son mot de passe à sa première connexion.</p>
    <div class="tableau-scroll"><table class="tableau"><thead><tr><th>Nom</th><th>Identifiant</th><th>Rôle</th><th>Postes</th><th>État</th><th></th></tr></thead><tbody>
      ${us.map((u) => `<tr><td><b>${h(u.nom)}</b></td><td>${h(u.login)}</td><td>${h(LIB_ROLE[u.role])}</td><td>${h((u.postes || []).map(nomPoste).join(", "))}</td>
        <td>${u.actif ? "actif" : '<span class="fiche-ko">désactivé</span>'}${u.doitChangerMdp ? ' · <span class="pastille p-a_preparer">mdp à changer</span>' : ""}</td>
        <td><button class="btn btn-petit" data-utilisateur="${u.id}">Modifier</button></td></tr>`).join("")}
    </tbody></table></div>`;
}

function vuePostes() {
  const ps = S.etat.postes;
  return `
    <div class="barre-outils"><button class="btn btn-primaire" data-action="nouveau-poste">Nouveau poste</button></div>
    <p class="aide">Les postes définissent le circuit de préparation, dans cet ordre. Chaque préparateur est affecté à un ou plusieurs postes ; chaque produit a une consigne par poste.</p>
    <div class="tableau-scroll"><table class="tableau"><thead><tr><th>Ordre</th><th>Poste</th><th>Description</th><th>Préparateurs</th><th></th></tr></thead><tbody>
      ${ps.map((p, i) => `<tr><td>${i + 1}
          <button class="btn btn-petit" data-poste-monter="${p.id}" ${i === 0 ? "disabled" : ""}>▲</button>
          <button class="btn btn-petit" data-poste-descendre="${p.id}" ${i === ps.length - 1 ? "disabled" : ""}>▼</button></td>
        <td><b>${h(p.nom)}</b></td><td>${h(p.description)}</td>
        <td>${h((S.etat.utilisateurs || []).filter((u) => u.actif && u.role === "preparateur" && (u.postes || []).includes(p.id)).map((u) => u.nom).join(", ") || "—")}</td>
        <td><button class="btn btn-petit" data-poste="${p.id}">Modifier</button></td></tr>`).join("") || '<tr><td colspan="5" class="vide">Aucun poste</td></tr>'}
    </tbody></table></div>`;
}

function vueAudit() {
  if (!S.audit) {
    if (!S.auditEnCours) {
      S.auditEnCours = true;
      api("GET", "/api/audit").then((l) => { S.audit = l; if (S.onglet === "audit") dessiner(); })
        .catch((e) => toast(e.message, true)).finally(() => { S.auditEnCours = false; });
    }
    return `<p class="aide">Chargement du journal…</p>`;
  }
  return `<div class="barre-outils"><button class="btn btn-secondaire" data-action="actualiser-audit">Actualiser</button></div>
    <h2>Journal d'audit (300 dernières actions)</h2>
    <div class="tableau-scroll"><table class="tableau"><thead><tr><th>Date</th><th>Utilisateur</th><th>Rôle</th><th>IP</th><th>Action</th><th>Détails</th></tr></thead><tbody>
    ${S.audit.map((l) => `<tr><td>${fmtDate(l.date)}</td><td>${h(l.utilisateur)}</td><td>${h(l.role)}</td><td>${h(l.ip)}</td><td>${h(l.action)}</td><td>${h(JSON.stringify(l.details))}</td></tr>`).join("") || '<tr><td colspan="6" class="vide">Journal vide</td></tr>'}
    </tbody></table></div>`;
}

/* =====================================================================
   MODALES
   ===================================================================== */
function ouvrirModale(fn, formulaire) {
  S.modale = fn; S.modaleFormulaire = !!formulaire; $("#voile").hidden = false; fn();
}
function fermerModale() {
  S.modale = null; S.modaleFormulaire = false; $("#voile").hidden = true; $("#modale-contenu").innerHTML = "";
  delete $("#modale-contenu").dataset.commande;
}
function modale(html) { $("#modale-contenu").innerHTML = html; }

/* ---------- Détail d'une commande ---------- */
function blocagesClient(c) { // même logique que le serveur, pour afficher en direct
  const b = [];
  if (!client(c.clientId)) b.push("Aucun client associé.");
  if (!c.lignes.length) b.push("La commande ne contient aucun produit.");
  if (!c.etapes.length) b.push("Aucun poste de préparation sélectionné.");
  c.lignes.forEach((l) => {
    const p = produit(l.produitId);
    if (!p) { b.push("Produit inconnu."); return; }
    if (!p.preparation.instructions) b.push(`Fiche de préparation manquante : « ${p.nom} ».`);
    c.etapes.forEach((e) => { if (!p.preparation.parPoste?.[e.posteId]) b.push(`« ${p.nom} » : pas d'instruction pour le poste ${nomPoste(e.posteId)}.`); });
  });
  const demande = new Map();
  c.lignes.forEach((l) => demande.set(l.produitId, (demande.get(l.produitId) || 0) + l.quantite));
  if (stockActif()) demande.forEach((q, pid) => { const p = produit(pid); if (p && p.stock < q) b.push(`Stock disponible insuffisant pour « ${p.nom} » (${p.stock} disponibles, ${q} demandés).`); });
  c.etapes.forEach((e) => { if (!(S.etat.utilisateurs || []).some((u) => u.actif !== false && u.role === "preparateur" && (u.postes || []).includes(e.posteId))) b.push(`Aucun préparateur actif n'est affecté au poste ${nomPoste(e.posteId)}.`); });
  return b;
}

function ouvrirCommande(id) {
  ouvrirModale(() => {
    const c = S.etat.commandes.find((x) => x.id === id);
    if (!c) { fermerModale(); return; }
    $("#modale-contenu").dataset.commande = c.id;
    const r = S.moi.role, cl = client(c.clientId), e = etapeCourante(c);
    const secretariat = r === "admin" || r === "secretariat";
    const monEtape = e && c.statut === "en_preparation" && e.statut === "en_cours" && e.preparateurId === S.moi.id; // seul celui qui tient l'étape agit
    const peutPrendre = e && c.statut === "a_preparer" && (S.moi.postes.includes(e.posteId) || r === "admin") && r !== "secretariat";

    /* Circuit */
    const circuit = `<div class="circuit">${c.etapes.map((et, i) => `<div class="etape ${et.statut}${i === c.etapeIndex && !estClos(c) && c.statut !== "brouillon" && c.statut !== "preparee" ? " courante" : ""}${et.preparateurId === S.moi.id ? " moi" : ""}">
        <div class="nom">${i + 1}. ${h(nomPoste(et.posteId))}</div>
        <div class="qui-etape">${et.statut === "faite" ? "Faite par " + h(et.preparateur) + " · " + fmtDate(et.fin) : et.statut === "en_cours" ? "En cours : " + h(et.preparateur) + " depuis " + fmtDate(et.debut) : "en attente"}</div>
        ${et.remarque ? `<div class="qui-etape">« ${h(et.remarque)} »</div>` : ""}
      </div>`).join("")}</div>`;

    /* Lignes */
    let lignes;
    if (monEtape) {
      lignes = c.lignes.map((l, i) => {
        const p = produit(l.produitId) || { nom: "?", preparation: {} };
        const fait = e.coches[i];
        return `<div class="ligne-prep${fait ? " faite" : ""}">
          <div class="haut">
            <label><input type="checkbox" data-coche="${i}" ${fait ? "checked" : ""} /> ${h(libelle(p))} ${p.marque ? `<small>${h(p.marque)}</small>` : ""} ${p.emplacement ? `<span class="emplacement">${h(p.emplacement)}</span>` : ""} ${badgeCons(p.conservation)} ${p.categorie && p.categorie !== "autre" ? `<small>${h(LIB_CAT[p.categorie])}</small>` : ""}</label>
            <div class="qte">× ${l.quantite} ${h(p.unite)}</div>
          </div>
          <div class="lot-dlc"><label>N° de lot<input data-lot="${i}" maxlength="40" value="${h(l.lot)}" placeholder="lot" /></label><label>DDM / DLC<input type="date" data-dlc="${i}" value="${h(l.dlc)}" /></label></div>
          <div class="instr">
            <p><span class="cle">Consigne ${h(nomPoste(e.posteId))}</span><br />${h(p.preparation.parPoste?.[e.posteId] || "—")}</p>
            ${p.preparation.instructions ? `<p><span class="cle">Général</span><br />${h(p.preparation.instructions)}</p>` : ""}
            ${p.preparation.conditionnement ? `<p><span class="cle">Conditionnement</span><br />${h(p.preparation.conditionnement)}</p>` : ""}
            ${p.preparation.vigilance ? `<p class="vigilance">Attention : ${h(p.preparation.vigilance)}</p>` : ""}
          </div>
        </div>`;
      }).join("");
    } else {
      lignes = `<div class="tableau-scroll"><table class="tableau"><thead><tr><th>Produit</th><th>Qté</th><th>Empl.</th><th>Lot / DDM</th>${secretariat && stockActif() ? "<th>Stock dispo.</th>" : ""}${c.etapes.map((et) => `<th>${h(nomPoste(et.posteId))}</th>`).join("")}</tr></thead><tbody>
        ${c.lignes.map((l) => { const p = produit(l.produitId) || { nom: "?", preparation: {} }; return `<tr><td><b>${h(libelle(p))}</b> ${badgeCons(p.conservation)}</td><td>${l.quantite} ${h(p.unite || "")}</td><td>${h(p.emplacement || "")}</td><td>${h(l.lot || "—")} / ${fmtJour(l.dlc)}</td>${secretariat && stockActif() ? `<td class="${c.statut === "brouillon" && (p.stock ?? 0) < l.quantite ? "stock-bas" : ""}">${p.stock ?? "?"}</td>` : ""}${c.etapes.map((et) => `<td class="${p.preparation.parPoste?.[et.posteId] ? "" : "fiche-ko"}">${h(p.preparation.parPoste?.[et.posteId] || "manquante")}</td>`).join("")}</tr>`; }).join("")}
      </tbody></table></div>`;
    }

    /* Actions */
    const A = [];
    if (secretariat) {
      if (c.statut === "brouillon") {
        const b = blocagesClient(c);
        A.push(`<div class="bloc"><h3>Contrôle avant envoi aux préparateurs</h3>${b.length ? `<ul class="blocages">${b.map((x) => `<li>${h(x)}</li>`).join("")}</ul>` : '<div class="ok-envoi">Tout est prêt : la commande peut partir en préparation.</div>'}
          <div class="ligne-boutons">
            ${c.envoyeeLe ? "" : `<button class="btn btn-danger" data-action="supprimer-commande" data-id="${c.id}">Supprimer</button>`}
            <button class="btn btn-secondaire" data-action="modifier-commande" data-id="${c.id}">Modifier</button>
            <button class="btn btn-primaire" data-action="envoyer" data-id="${c.id}" ${b.length ? "disabled" : ""}>Envoyer au poste ${h(c.etapes[0] ? nomPoste(c.etapes[0].posteId) : "")} →</button>
          </div></div>`);
      }
      if (c.statut === "a_preparer" && c.etapeIndex === 0) A.push(`<div class="ligne-boutons"><button class="btn btn-secondaire" data-action="rappeler" data-id="${c.id}">Rappeler au secrétariat</button></div>`);
      if (["a_preparer", "en_preparation", "preparee"].includes(c.statut)) A.push(`<div class="ligne-boutons"><button class="btn btn-secondaire" data-action="renvoyer" data-id="${c.id}">Renvoyer à un poste…</button></div>`);
      if (c.statut === "preparee") A.push(`<div class="bloc"><h3>Expédition</h3>
        <div class="deux-col"><label>Transporteur<input id="exp-transporteur" maxlength="80" placeholder="Geodis, DB Schenker, coursier…" /></label><label>N° de suivi<input id="exp-suivi" maxlength="80" placeholder="numéro seul, pas l'URL" /></label></div>
        <div class="ligne-boutons"><button class="btn btn-succes" data-action="expedier" data-id="${c.id}">Valider l'expédition</button></div></div>`);
      if (!estClos(c)) A.push(`<div class="ligne-boutons"><button class="btn btn-lien" data-action="annuler" data-id="${c.id}">Annuler la commande</button></div>`);
    }
    if (peutPrendre) A.push(`<div class="ligne-boutons"><button class="btn btn-primaire btn-large" data-action="prendre" data-id="${c.id}">Je prends cette commande (poste ${h(nomPoste(e.posteId))})</button></div>`);
    if (monEtape) {
      const tout = e.coches.every(Boolean);
      A.push(`<div class="bloc"><label>Remarque pour la suite (facultatif)<input id="prep-remarque" placeholder="ex. carton 2 sur 2 plus lourd, lot remplacé…" /></label>
        <div class="ligne-boutons">
          <button class="btn btn-secondaire" data-action="rendre" data-id="${c.id}">Je ne peux pas continuer → remettre dans la file</button>
          <button class="btn btn-succes btn-large" data-action="terminer" data-id="${c.id}" ${tout ? "" : "disabled"}>${c.etapeIndex + 1 < c.etapes.length ? `Étape terminée → transmettre au poste ${h(nomPoste(c.etapes[c.etapeIndex + 1].posteId))}` : "Terminé → retour au secrétariat"}</button>
        </div>${tout ? "" : '<p class="aide">Cochez toutes les lignes pour pouvoir terminer.</p>'}</div>`);
    }

    /* Messages & historique */
    const messages = `<div class="bloc"><h3>Messages (secrétariat ↔ préparateurs)</h3>
      <div class="fil">${(c.messages || []).length ? c.messages.map((m) => `<div class="msg${m.auteurId === S.moi.id ? " moi" : ""}"><div class="entete-msg"><b>${h(m.auteur)}</b> · ${h(LIB_ROLE[m.role] || m.role)} · ${fmtDate(m.date)}</div>${h(m.texte)}</div>`).join("") : '<div class="vide">Aucun message</div>'}</div>
      ${estClos(c) ? '<p class="aide">Commande close : le fil est fermé.</p>' : `<form class="msg-form" data-form="message" data-id="${c.id}"><input name="texte" maxlength="1000" placeholder="Écrire un message visible par tous les intervenants…" required autocomplete="off" /><button class="btn btn-primaire" type="submit">Envoyer</button></form>`}</div>`;
    const historique = `<div class="bloc"><h3>Historique</h3><ul class="historique">${c.historique.slice().reverse().map((x) => `<li><span class="date">${fmtDate(x.date)}</span><span>${x.poste ? `<span class="poste-h">[${h(x.poste)}]</span> ` : ""}<b>${h(x.qui)}</b> — ${h(x.texte)}</span></li>`).join("")}</ul></div>`;

    modale(`
      <div class="entete-cmd"><h2>Commande n° ${c.numero} — ${h(cl ? cl.nom : "(sans client)")}</h2><div>${c.priorite === "urgente" ? '<span class="pastille p-urgente">URGENT</span> ' : ""}${pastille(c.statut)}</div></div>
      <div class="bloc"><dl class="infos">
        <div><dt>Livraison souhaitée</dt><dd>${fmtJour(c.dateLivraisonSouhaitee)}</dd></div>
        <div><dt>Mail reçu le</dt><dd>${fmtJour(c.dateMail)}</dd></div>
        <div><dt>Créée</dt><dd>${fmtDate(c.creeLe)} par ${h(c.creePar)}</dd></div>
        ${cl && cl.adresse ? `<div><dt>Adresse</dt><dd>${h(cl.adresse)}</dd></div>` : ""}
        ${secretariat && cl && cl.email ? `<div><dt>Contact</dt><dd>${h(cl.email)} ${h(cl.telephone || "")}</dd></div>` : ""}
        ${c.note ? `<div><dt>Note (visible par les préparateurs)</dt><dd class="pre">${h(c.note)}</dd></div>` : ""}
        ${secretariat && c.sourceMail ? `<div><dt>Extrait du mail</dt><dd class="pre">${h(c.sourceMail)}</dd></div>` : ""}
      </dl></div>
      <div class="bloc"><h3>Circuit de préparation</h3>${circuit}</div>
      <div class="bloc"><h3>Produits (${c.lignes.length})</h3>${lignes}</div>
      ${A.join("")}
      ${messages}
      ${historique}`);
  });
}

/* ---------- Formulaire commande ---------- */
function formulaireCommande(c) {
  const brouillon = c ? JSON.parse(JSON.stringify(c)) : { clientId: "", sourceMail: "", dateMail: aujourdhui(), dateLivraisonSouhaitee: "", priorite: "normale", note: "", lignes: [{ produitId: "", quantite: 1 }], etapes: S.etat.postes.map((p) => ({ posteId: p.id })) };
  const postesChoisis = new Set(brouillon.etapes.map((e) => e.posteId));
  ouvrirModale(() => {
    const saisie = (l) => l.saisie ?? (produit(l.produitId) ? libelleSaisie(produit(l.produitId)) : "");
    modale(`<h2>${c ? "Modifier la commande n° " + c.numero : "Nouvelle commande (à partir du mail du client)"}</h2>
      <form data-form="commande" data-id="${c ? c.id : ""}">
        <div class="bloc"><div class="deux-col">
          <label>Client<select name="clientId" required><option value="">— choisir —</option>${S.etat.clients.map((x) => `<option value="${x.id}" ${x.id === brouillon.clientId ? "selected" : ""}>${h(x.nom)}</option>`).join("")}</select></label>
          <label>Priorité<select name="priorite"><option value="normale" ${brouillon.priorite === "normale" ? "selected" : ""}>Normale</option><option value="urgente" ${brouillon.priorite === "urgente" ? "selected" : ""}>Urgente</option></select></label>
          <label>Date du mail<input type="date" name="dateMail" value="${h(brouillon.dateMail)}" /></label>
          <label>Livraison souhaitée<input type="date" name="dateLivraisonSouhaitee" value="${h(brouillon.dateLivraisonSouhaitee)}" /></label>
        </div>
        <label>Extrait / copie du mail (traçabilité)<textarea name="sourceMail" maxlength="3000" placeholder="Collez ici l'objet et le contenu utile du mail du client">${h(brouillon.sourceMail)}</textarea></label>
        <label>Note (visible par les préparateurs)<input name="note" maxlength="1000" value="${h(brouillon.note)}" placeholder="ex. livrer avant 10h, prévenir à l'arrivée…" /></label></div>
        <div class="bloc"><h3>Produits commandés</h3><div class="lignes-edit" id="lignes-edit">
          ${brouillon.lignes.map((l, i) => `<div class="ligne-edit"><input name="p${i}" list="liste-produits" value="${h(saisie(l))}" placeholder="Tapez : marque, nom, poids…" autocomplete="off" required /><input type="number" name="q${i}" min="1" max="1000000" value="${l.quantite}" required aria-label="Quantité" /><button class="btn btn-petit" type="button" data-suppr-ligne="${i}" aria-label="Retirer la ligne">✕</button></div>`).join("")}
        </div>
        <datalist id="liste-produits">${S.etat.produits.map((p) => `<option value="${h(libelleSaisie(p))}">${h(`${p.marque || ""}${stockActif() ? ` · ${p.stock} ${p.unite} dispo.` : ""}${ficheComplete(p) ? "" : " · fiche à compléter"}`)}</option>`).join("")}</datalist>
        <p class="aide">Commencez à taper (ex. « ownat chiot 14 ») puis choisissez le format dans la liste.</p><button class="btn btn-secondaire btn-petit" type="button" data-action="ajouter-ligne">Ajouter un produit</button></div>
        <div class="bloc"><h3>Circuit de préparation (postes, dans l'ordre)</h3><div class="cases">
          ${S.etat.postes.map((p) => `<label><input type="checkbox" name="poste" value="${p.id}" ${postesChoisis.has(p.id) ? "checked" : ""} /> ${h(p.nom)}</label>`).join("")}
        </div><p class="aide">Décochez un poste si cette commande n'a pas besoin d'y passer.</p></div>
        <div class="ligne-boutons"><button class="btn btn-secondaire" type="button" data-action="fermer">Annuler</button><button class="btn btn-primaire" type="submit">${c ? "Enregistrer" : "Créer le brouillon"}</button></div>
      </form>`);
    // Ajout / suppression de lignes sans perdre la saisie
    $("#modale-contenu [data-action=ajouter-ligne]").onclick = () => { lireLignes(); brouillon.lignes.push({ produitId: "", quantite: 1 }); S.modale(); };
    $("#modale-contenu").querySelectorAll("[data-suppr-ligne]").forEach((b) => (b.onclick = () => { lireLignes(); brouillon.lignes.splice(Number(b.dataset.supprLigne), 1); S.modale(); }));
    function lireLignes() {
      const f = $("#modale-contenu form");
      brouillon.lignes = brouillon.lignes.map((_, i) => { const v = f[`p${i}`].value; const p = produitDepuisSaisie(v); return { produitId: p ? p.id : "", saisie: v, quantite: Number(f[`q${i}`].value) || 1 }; });
      brouillon.clientId = f.clientId.value; brouillon.priorite = f.priorite.value; brouillon.dateMail = f.dateMail.value; brouillon.dateLivraisonSouhaitee = f.dateLivraisonSouhaitee.value; brouillon.sourceMail = f.sourceMail.value; brouillon.note = f.note.value;
      postesChoisis.clear(); f.querySelectorAll("input[name=poste]:checked").forEach((x) => postesChoisis.add(x.value));
    }
  }, true);
}

function produitDepuisSaisie(v) {
  v = String(v || "").trim();
  return S.etat.produits.find((p) => libelleSaisie(p) === v) || S.etat.produits.find((p) => p.reference === v) || null;
}

/* ---------- Formulaire produit ---------- */
function formulaireProduit(p) {
  const pr = p ? p.preparation : { parPoste: {} };
  ouvrirModale(() => modale(`<h2>${p ? "Produit : " + h(p.nom) : "Nouveau produit"}</h2>
    <form data-form="produit" data-id="${p ? p.id : ""}">
      <div class="bloc"><div class="deux-col">
        <label>Nom<input name="nom" required maxlength="120" value="${h(p?.nom)}" /></label>
        <label>Référence<input name="reference" maxlength="80" value="${h(p?.reference)}" /></label>
        <label>Marque<input name="marque" maxlength="60" value="${h(p?.marque)}" /></label>
        <label>Gamme<input name="gamme" maxlength="60" value="${h(p?.gamme)}" /></label>
        <label>Format / poids<input name="poids" maxlength="30" value="${h(p?.poids)}" placeholder="ex. 14 kg" /></label>
        <label>Unité<input name="unite" maxlength="20" value="${h(p?.unite || "unité")}" /></label>
        ${stockActif() ? `<label>Stock disponible<input type="number" name="stock" min="0" value="${p ? p.stock : 0}" /></label>` : ""}
        ${stockActif() && p && reserve(p.id) ? `<p class="aide">+ ${reserve(p.id)} ${h(p.unite)} réservés par des commandes en préparation → stock physique attendu : <b>${p.stock + reserve(p.id)}</b>. Après un inventaire, saisissez ici le compté <b>moins</b> ${reserve(p.id)}.</p>` : ""}
        <label>Emplacement<input name="emplacement" maxlength="40" value="${h(p?.emplacement)}" placeholder="ex. A1" /></label>
        <label>Durée indicative (min / ligne)<input type="number" name="dureeMin" min="0" max="600" value="${pr.dureeMin || 0}" /></label>
        <label>Univers<select name="categorie">${Object.entries(LIB_CAT).map(([k, v]) => `<option value="${k}" ${(p?.categorie || "autre") === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        <label>Conservation<select name="conservation">${Object.entries(LIB_CONS).map(([k, v]) => `<option value="${k}" ${(p?.conservation || "ambiant") === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        <label>DDM / DLC habituelle (jours, 0 = sans date)<input type="number" name="dlcJours" min="0" max="3650" value="${p?.dlcJours || 0}" /></label>
      </div></div>
      ${p && p.description ? `<div class="bloc"><h3>Description (site)</h3><p class="aide">${h(p.description)}</p></div>` : ""}
      <div class="bloc"><h3>Fiche de préparation</h3>
        <p class="aide">Obligatoire pour qu'une commande contenant ce produit puisse être envoyée aux préparateurs.</p>
        <label>Instructions générales *<textarea name="instructions" maxlength="2000" required>${h(pr.instructions)}</textarea></label>
        <label>Conditionnement<input name="conditionnement" maxlength="300" value="${h(pr.conditionnement)}" /></label>
        <label>Point de vigilance<input name="vigilance" maxlength="500" value="${h(pr.vigilance)}" placeholder="ex. fragile, chaîne du froid, périssable…" /></label>
      </div>
      <div class="bloc fiche-postes"><h3>Consigne par poste</h3>
        ${S.etat.postes.map((po) => `<label>${h(po.nom)} <small>— ${h(po.description)}</small><textarea name="poste_${po.id}" maxlength="1000">${h(pr.parPoste?.[po.id])}</textarea></label>`).join("")}
      </div>
      <div class="ligne-boutons">
        ${p && S.moi.role === "admin" ? `<button class="btn btn-danger" type="button" data-action="supprimer-produit" data-id="${p.id}">Supprimer</button>` : ""}
        <button class="btn btn-secondaire" type="button" data-action="fermer">Annuler</button><button class="btn btn-primaire" type="submit">Enregistrer</button></div>
    </form>`), true);
}

/* ---------- Import du catalogue depuis le site ---------- */
function formulaireImport() {
  ouvrirModale(() => modale(`<h2>Importer le catalogue du site</h2>
    <form data-form="import"><div class="bloc">
      <p>Choisissez la page du site (fichier <b>.html</b>, avec la liste des produits) ou un export <b>.json</b>.</p>
      <label>Fichier<input type="file" name="fichier" accept=".html,.htm,.json" required /></label>
      <p class="aide">Chaque format (ex. 3 kg, 14 kg) devient une référence à part. Les références existantes sont mises à jour (nom, marque, poids…) ; l'<b>emplacement</b> et les <b>consignes de préparation</b> déjà saisis ne sont jamais modifiés. Rien n'est supprimé.</p>
    </div>
    <div class="ligne-boutons"><button class="btn btn-secondaire" type="button" data-action="fermer">Annuler</button><button class="btn btn-primaire" type="submit">Importer</button></div>
    </form>`), true);
}

/* Lit la liste des produits dans la page du site (constante PRODUITS_DEFAUT) ou dans un export JSON */
function extraireProduitsSite(texte) {
  let liste = null;
  try { const j = JSON.parse(texte); liste = Array.isArray(j) ? j : j.produits; } catch (e) {
    const m = texte.match(/PRODUITS_DEFAUT\s*=\s*(\[[\s\S]*?\n\s*\]);/);
    if (m) { try { liste = JSON.parse(m[1]); } catch (e2) { /* format inattendu */ } }
  }
  if (!Array.isArray(liste) || !liste.length) throw new Error("Aucune liste de produits trouvée dans ce fichier.");
  const champs = ["id", "cat", "marque", "gamme", "nom", "desc", "conditionnement", "poids", "photo"];
  return liste.map((x) => Object.fromEntries(champs.map((k) => [k, x && x[k] != null ? x[k] : ""])));
}

/* ---------- Fiche type pour un groupe de produits ---------- */
function formulaireFicheType(ids) {
  ouvrirModale(() => modale(`<h2>Fiche type pour ${ids.length} référence${ids.length > 1 ? "s" : ""}</h2>
    <form data-form="fiche-type"><div class="bloc">
      <p class="aide">Les consignes saisies ici sont copiées dans les ${ids.length} fiches affichées (filtres de l'onglet Produits). Laissez un champ vide pour ne pas y toucher.</p>
      <label>Instructions générales<textarea name="instructions" maxlength="2000" placeholder="ex. Vérifier la DDM (au moins 3 mois restants), sac intact."></textarea></label>
      <label>Conditionnement<input name="conditionnement" maxlength="300" /></label>
      <label>Point de vigilance<input name="vigilance" maxlength="500" /></label>
      ${S.etat.postes.map((po) => `<label>Consigne ${h(po.nom)}<textarea name="poste_${po.id}" maxlength="1000"></textarea></label>`).join("")}
      <label class="case"><input type="checkbox" name="ecraser" /> Remplacer aussi les consignes déjà remplies</label>
    </div>
    <div class="ligne-boutons"><button class="btn btn-secondaire" type="button" data-action="fermer">Annuler</button><button class="btn btn-primaire" type="submit">Appliquer</button></div>
    </form>`), true);
  S.ficheTypeIds = ids;
}

/* ---------- Formulaire client ---------- */
function formulaireClient(c) {
  ouvrirModale(() => modale(`<h2>${c ? "Client : " + h(c.nom) : "Nouveau client"}</h2>
    <form data-form="client" data-id="${c ? c.id : ""}"><div class="bloc">
      <label>Nom *<input name="nom" required maxlength="120" value="${h(c?.nom)}" /></label>
      <div class="deux-col"><label>E-mail<input type="email" name="email" maxlength="120" value="${h(c?.email)}" /></label><label>Téléphone<input name="telephone" maxlength="30" value="${h(c?.telephone)}" /></label></div>
      <label>Adresse de livraison<textarea name="adresse" maxlength="300">${h(c?.adresse)}</textarea></label></div>
      <div class="ligne-boutons">
        ${c && S.moi.role === "admin" ? `<button class="btn btn-danger" type="button" data-action="supprimer-client" data-id="${c.id}">Supprimer</button>` : ""}
        <button class="btn btn-secondaire" type="button" data-action="fermer">Annuler</button><button class="btn btn-primaire" type="submit">Enregistrer</button></div>
    </form>`), true);
}

/* ---------- Formulaire utilisateur (admin) ---------- */
function formulaireUtilisateur(u) {
  ouvrirModale(() => modale(`<h2>${u ? "Utilisateur : " + h(u.nom) : "Nouvel utilisateur"}</h2>
    <form data-form="utilisateur" data-id="${u ? u.id : ""}"><div class="bloc">
      <div class="deux-col">
        <label>Nom affiché *<input name="nom" required maxlength="80" value="${h(u?.nom)}" /></label>
        <label>Identifiant *<input name="login" required pattern="[a-z0-9._-]{3,40}" maxlength="40" value="${h(u?.login)}" ${u ? "disabled" : ""} autocapitalize="off" /></label>
        <label>Rôle<select name="role" ${u && u.id === S.moi.id ? "disabled" : ""}>${Object.entries(LIB_ROLE).map(([k, v]) => `<option value="${k}" ${u?.role === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        ${u ? `<label>État<select name="actif" ${u.id === S.moi.id ? "disabled" : ""}><option value="1" ${u.actif ? "selected" : ""}>Actif</option><option value="0" ${!u.actif ? "selected" : ""}>Désactivé (accès bloqué)</option></select></label>` : ""}
      </div>
      <label>Postes (pour un préparateur)</label><div class="cases">${S.etat.postes.map((p) => `<label><input type="checkbox" name="poste" value="${p.id}" ${(u?.postes || []).includes(p.id) ? "checked" : ""} /> ${h(p.nom)}</label>`).join("") || '<span class="aide">Aucun poste défini</span>'}</div>
      ${u ? "" : `<label>Mot de passe initial *<input type="password" name="mdp" required minlength="12" autocomplete="new-password" /></label><p class="aide">12 caractères minimum, lettres et chiffres. La personne devra le changer à sa première connexion.</p>`}
    </div>
    <div class="ligne-boutons">
      ${u && u.id !== S.moi.id ? `<button class="btn btn-danger" type="button" data-action="supprimer-utilisateur" data-id="${u.id}">Supprimer</button><button class="btn btn-secondaire" type="button" data-action="reinit-mdp" data-id="${u.id}">Réinitialiser le mot de passe</button><button class="btn btn-secondaire" type="button" data-action="debloquer" data-id="${u.id}">Débloquer la connexion</button>` : ""}
      <button class="btn btn-secondaire" type="button" data-action="fermer">Annuler</button><button class="btn btn-primaire" type="submit">Enregistrer</button></div>
    </form>`), true);
}

/* ---------- Formulaire poste (admin) ---------- */
function formulairePoste(p) {
  ouvrirModale(() => modale(`<h2>${p ? "Poste : " + h(p.nom) : "Nouveau poste"}</h2>
    <form data-form="poste" data-id="${p ? p.id : ""}"><div class="bloc">
      <label>Nom *<input name="nom" required maxlength="40" value="${h(p?.nom)}" placeholder="ex. Picking, Emballage, Contrôle, Étiquetage…" /></label>
      <label>Description<input name="description" maxlength="300" value="${h(p?.description)}" /></label></div>
      <div class="ligne-boutons">
        ${p ? `<button class="btn btn-danger" type="button" data-action="supprimer-poste" data-id="${p.id}">Supprimer</button>` : ""}
        <button class="btn btn-secondaire" type="button" data-action="fermer">Annuler</button><button class="btn btn-primaire" type="submit">Enregistrer</button></div>
    </form>`), true);
}

/* ---------- Renvoi à un poste (secrétariat) ---------- */
function formulaireRenvoi(c) {
  ouvrirModale(() => modale(`<h2>Renvoyer la commande n° ${c.numero} à un poste</h2>
    <form data-form="renvoyer" data-id="${c.id}"><div class="bloc">
      <label>Reprendre à partir du poste<select name="etape">${c.etapes.slice(0, c.etapeIndex + 1).map((e, i) => `<option value="${i}" ${i === c.etapeIndex ? "selected" : ""}>${i + 1}. ${h(nomPoste(e.posteId))}${i === c.etapeIndex ? " (étape actuelle)" : ""}</option>`).join("")}</select></label>
      <label>Raison *<input name="remarque" required maxlength="500" placeholder="ex. mauvaise quantité sur la ligne 2" /></label>
      <p class="aide">Les étapes à partir de celle-ci seront à refaire ; le préparateur du poste verra la raison dans l'historique et les messages.</p></div>
      <div class="ligne-boutons"><button class="btn btn-secondaire" type="button" data-action="fermer">Annuler</button><button class="btn btn-primaire" type="submit">Renvoyer</button></div>
    </form>`), true);
}

/* =====================================================================
   ACTIONS
   ===================================================================== */
async function agir(fn, msgOk) {
  try { await fn(); if (msgOk) toast(msgOk); await rafraichir(true); dessiner(); redessinerModale(); }
  catch (e) {
    if (e.data && e.data.blocages) toast(e.message + " " + e.data.blocages.join(" "), true);
    else toast(e.message, true);
  }
}

const ACTIONS = {
  "fermer": () => fermerModale(),
  "nouvelle-commande": () => formulaireCommande(null),
  "modifier-commande": (id) => formulaireCommande(S.etat.commandes.find((c) => c.id === id)),
  "supprimer-commande": (id) => confirm("Supprimer ce brouillon ?") && agir(() => api("DELETE", `/api/commandes/${id}`).then(fermerModale), "Brouillon supprimé"),
  "envoyer": (id) => agir(() => api("POST", `/api/commandes/${id}/envoyer`), "Commande envoyée aux préparateurs"),
  "rappeler": (id) => agir(() => api("POST", `/api/commandes/${id}/rappeler`), "Commande rappelée"),
  "renvoyer": (id) => formulaireRenvoi(S.etat.commandes.find((c) => c.id === id)),
  "prendre": (id) => agir(() => api("POST", `/api/commandes/${id}/prendre`), "Commande prise en charge"),
  "rendre": (id) => confirm("Remettre cette commande dans la file de votre poste ?") && agir(() => api("POST", `/api/commandes/${id}/rendre`, { remarque: $("#prep-remarque")?.value || "" }), "Commande remise dans la file"),
  "terminer": (id) => agir(async () => {
    for (const el of document.querySelectorAll("#modale-contenu [data-non-sauve]")) await envoyerLotDlc(id, el); // rien ne se perd
    await api("POST", `/api/commandes/${id}/terminer`, { remarque: $("#prep-remarque")?.value || "" });
  }, "Étape terminée"),
  "actualiser-audit": () => { S.audit = null; dessiner(); },
  "debloquer": (id) => agir(() => api("POST", `/api/utilisateurs/${id}/debloquer`), "Compte débloqué"),
  "expedier": (id) => agir(() => api("POST", `/api/commandes/${id}/expedier`, { transporteur: $("#exp-transporteur").value, suivi: $("#exp-suivi").value }), "Commande expédiée"),
  "annuler": (id) => { const r = prompt("Raison de l'annulation ?"); if (r !== null) agir(() => api("POST", `/api/commandes/${id}/annuler`, { remarque: r }), "Commande annulée"); },
  "nouveau-produit": () => formulaireProduit(null),
  "importer-catalogue": () => formulaireImport(),
  "fiche-type": () => formulaireFicheType(produitsFiltres().map((p) => p.id)),
  "supprimer-produit": (id) => confirm("Supprimer ce produit ?") && agir(() => api("DELETE", `/api/produits/${id}`).then(fermerModale), "Produit supprimé"),
  "nouveau-client": () => formulaireClient(null),
  "supprimer-client": (id) => confirm("Supprimer ce client ?") && agir(() => api("DELETE", `/api/clients/${id}`).then(fermerModale), "Client supprimé"),
  "nouvel-utilisateur": () => formulaireUtilisateur(null),
  "supprimer-utilisateur": (id) => confirm("Supprimer définitivement ce compte ? (préférez la désactivation)") && agir(() => api("DELETE", `/api/utilisateurs/${id}`).then(fermerModale), "Compte supprimé"),
  "reinit-mdp": (id) => { const m = prompt("Nouveau mot de passe provisoire (12 caractères min., lettres et chiffres) :"); if (m) agir(() => api("POST", `/api/utilisateurs/${id}/motdepasse`, { mdp: m }), "Mot de passe réinitialisé — à changer à la prochaine connexion"); },
  "nouveau-poste": () => formulairePoste(null),
  "supprimer-poste": (id) => confirm("Supprimer ce poste ?") && agir(() => api("DELETE", `/api/postes/${id}`).then(fermerModale), "Poste supprimé"),
};

const FORMULAIRES = {
  async commande(f, id) {
    const lignes = [];
    for (let i = 0; f[`p${i}`]; i++) {
      const p = produitDepuisSaisie(f[`p${i}`].value);
      if (!p) throw new Error(`Ligne ${i + 1} : produit introuvable. Tapez son nom puis choisissez-le dans la liste proposée.`);
      lignes.push({ produitId: p.id, quantite: Number(f[`q${i}`].value) });
    }
    const corps = { clientId: f.clientId.value, priorite: f.priorite.value, dateMail: f.dateMail.value, dateLivraisonSouhaitee: f.dateLivraisonSouhaitee.value, sourceMail: f.sourceMail.value, note: f.note.value, lignes, postes: [...f.querySelectorAll("input[name=poste]:checked")].map((x) => x.value) };
    if (!lignes.length) throw new Error("Ajoutez au moins un produit.");
    const c = id ? await api("PUT", `/api/commandes/${id}`, corps) : await api("POST", "/api/commandes", corps);
    await rafraichir(true); ouvrirCommande(c.id);
    return "Commande enregistrée";
  },
  async produit(f, id) {
    const parPoste = {}; S.etat.postes.forEach((p) => (parPoste[p.id] = f[`poste_${p.id}`].value));
    const corps = { nom: f.nom.value, reference: f.reference.value, marque: f.marque.value, gamme: f.gamme.value, poids: f.poids.value, unite: f.unite.value, emplacement: f.emplacement.value, categorie: f.categorie.value, conservation: f.conservation.value, dlcJours: Number(f.dlcJours.value), preparation: { instructions: f.instructions.value, conditionnement: f.conditionnement.value, vigilance: f.vigilance.value, dureeMin: Number(f.dureeMin.value), parPoste } };
    // Stock envoyé seulement s'il a été modifié, avec la valeur lue : le serveur refuse s'il a bougé entre-temps
    if (!f.stock) { /* gestion du stock désactivée : pas de stock envoyé */ }
    else if (!id) corps.stock = Number(f.stock.value);
    else if (f.stock.value !== f.stock.defaultValue) { corps.stock = Number(f.stock.value); corps.stockAvant = Number(f.stock.defaultValue); }
    await (id ? api("PUT", `/api/produits/${id}`, corps) : api("POST", "/api/produits", corps));
    fermerModale(); return "Produit enregistré";
  },
  async import(f) {
    const fichier = f.fichier.files[0];
    if (!fichier) throw new Error("Choisissez un fichier.");
    const produits = extraireProduitsSite(await fichier.text());
    const b = await api("POST", "/api/produits/import", { produits, source: fichier.name });
    fermerModale();
    return `Catalogue importé : ${b.crees} nouvelle(s) référence(s), ${b.misAJour} mise(s) à jour, ${b.inchanges} inchangée(s)${b.absentsDuSite ? `, ${b.absentsDuSite} absente(s) du site (conservées)` : ""}.`;
  },
  async "fiche-type"(f) {
    const parPoste = {}; S.etat.postes.forEach((p) => (parPoste[p.id] = f[`poste_${p.id}`].value));
    const r = await api("POST", "/api/produits/fiche-groupee", { ids: S.ficheTypeIds || [], ecraser: f.ecraser.checked, preparation: { instructions: f.instructions.value, conditionnement: f.conditionnement.value, vigilance: f.vigilance.value, parPoste } });
    fermerModale();
    return `Fiche type appliquée : ${r.modifies} fiche(s) modifiée(s) sur ${r.produits}.`;
  },
  async client(f, id) {
    const corps = { nom: f.nom.value, email: f.email.value, telephone: f.telephone.value, adresse: f.adresse.value };
    await (id ? api("PUT", `/api/clients/${id}`, corps) : api("POST", "/api/clients", corps));
    fermerModale(); return "Client enregistré";
  },
  async utilisateur(f, id) {
    const postes = [...f.querySelectorAll("input[name=poste]:checked")].map((x) => x.value);
    if (id) {
      const corps = { nom: f.nom.value, postes };
      if (!f.role.disabled) corps.role = f.role.value;
      if (f.actif && !f.actif.disabled) corps.actif = f.actif.value === "1";
      await api("PUT", `/api/utilisateurs/${id}`, corps);
    } else {
      await api("POST", "/api/utilisateurs", { nom: f.nom.value, login: f.login.value, role: f.role.value, postes, mdp: f.mdp.value });
    }
    fermerModale(); return "Utilisateur enregistré";
  },
  async poste(f, id) {
    const corps = { nom: f.nom.value, description: f.description.value };
    await (id ? api("PUT", `/api/postes/${id}`, corps) : api("POST", "/api/postes", corps));
    fermerModale(); return "Poste enregistré";
  },
  async message(f, id) {
    await api("POST", `/api/commandes/${id}/message`, { texte: f.texte.value });
    f.reset(); return "";
  },
  async renvoyer(f, id) {
    await api("POST", `/api/commandes/${id}/renvoyer`, { etape: Number(f.etape.value), remarque: f.remarque.value });
    await rafraichir(true); ouvrirCommande(id); return "Commande renvoyée";
  },
};

/* =====================================================================
   ÉVÉNEMENTS
   ===================================================================== */
document.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-onglet],[data-action],[data-ouvrir],[data-produit],[data-client],[data-utilisateur],[data-poste],[data-poste-monter],[data-poste-descendre]");
  if (!el) return;
  const d = el.dataset;
  if (d.onglet) { S.onglet = d.onglet; S.recherche = ""; if (d.onglet === "audit") S.audit = null; dessiner(); return; }
  if (d.action) {
    if (d.action === "ajouter-ligne") return;
    const f = ACTIONS[d.action];
    if (!f || el.disabled || el.dataset.enCours) return;
    const p = f(d.id);
    if (p && typeof p.then === "function") { el.disabled = true; el.dataset.enCours = "1"; p.finally(() => { el.disabled = false; delete el.dataset.enCours; }); }
    return;
  }
  if (d.ouvrir) return ouvrirCommande(d.ouvrir);
  if (d.produit) return formulaireProduit(produit(d.produit));
  if (d.client) return formulaireClient(client(d.client));
  if (d.utilisateur) return formulaireUtilisateur(S.etat.utilisateurs.find((u) => u.id === d.utilisateur));
  if (d.poste) return formulairePoste(poste(d.poste));
  if (d.posteMonter || d.posteDescendre) {
    const ids = S.etat.postes.map((p) => p.id); const pid = d.posteMonter || d.posteDescendre; const i = ids.indexOf(pid); const j = d.posteMonter ? i - 1 : i + 1;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    if (el.dataset.enCours) return;
    el.dataset.enCours = "1";
    agir(() => api("PUT", "/api/postes/ordre", { ordre: ids }), "Ordre modifié").finally(() => delete el.dataset.enCours);
  }
});

document.addEventListener("change", (ev) => {
  const k = ev.target.dataset && ev.target.dataset.filtre;
  if (k) { S[k] = ev.target.value; dessiner(); }
});

document.addEventListener("input", (ev) => {
  if (ev.target.matches("[data-recherche]")) { S.recherche = ev.target.value; dessiner(); }
});

document.addEventListener("change", async (ev) => {
  const id = S.modale && $("#modale-contenu").dataset.commande;
  if (!id) return;
  const el = ev.target;
  if (el.matches("[data-coche]")) {
    const i = Number(el.dataset.coche);
    const corps = { index: i, fait: el.checked };
    // on joint le lot / la DDM affichés : ce qui est à l'écran est ce qui est enregistré
    const lot = $(`#modale-contenu [data-lot="${i}"]`), dlc = $(`#modale-contenu [data-dlc="${i}"]`);
    if (lot && lot.dataset.nonSauve) corps.lot = lot.value;
    if (dlc && dlc.dataset.nonSauve) corps.dlc = dlc.value;
    try {
      await api("POST", `/api/commandes/${id}/ligne`, corps);
      if (lot) marquerNonSauve(lot, false); if (dlc && "dlc" in corps) marquerNonSauve(dlc, false);
      await rafraichir(true); dessiner(); redessinerModale();
    } catch (e) { el.checked = !el.checked; toast("Case non enregistrée : " + e.message, true); } // l'écran reflète le serveur
  } else if (el.matches("[data-lot],[data-dlc]")) {
    try { await envoyerLotDlc(id, el); await rafraichir(true); dessiner(); redessinerModale(); }
    catch (e) { toast("Lot / DDM non enregistré : " + e.message + " — il sera renvoyé automatiquement.", true); }
  }
});

document.addEventListener("submit", async (ev) => {
  const f = ev.target;
  if (!f.dataset.form) return;
  ev.preventDefault();
  const btn = f.querySelector("button[type=submit]"); if (btn) btn.disabled = true;
  try {
    const msg = await FORMULAIRES[f.dataset.form](f, f.dataset.id);
    if (msg) toast(msg);
    await rafraichir(true); dessiner(); redessinerModale();
  } catch (e) { toast(e.message, true); }
  finally { if (btn) btn.disabled = false; }
});

$("#fermer-modale").onclick = fermerModale;
$("#voile").addEventListener("click", (ev) => { if (ev.target === $("#voile")) fermerModale(); });
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && S.modale && !$("#voile").hidden) fermerModale(); });

$("#form-connexion").onsubmit = async (ev) => {
  ev.preventDefault();
  const f = ev.target; $("#erreur-connexion").hidden = true;
  try {
    const { moi } = await api("POST", "/api/connexion", { login: f.login.value, mdp: f.mdp.value });
    S.moi = moi;
    if (moi.doitChangerMdp) montrerMdp(true); else await montrerApp();
  } catch (e) { $("#erreur-connexion").textContent = e.message; $("#erreur-connexion").hidden = false; }
};

$("#form-mdp").onsubmit = async (ev) => {
  ev.preventDefault();
  const f = ev.target; $("#erreur-mdp").hidden = true;
  if (f.nouveau.value !== f.confirme.value) { $("#erreur-mdp").textContent = "Les deux mots de passe ne correspondent pas."; $("#erreur-mdp").hidden = false; return; }
  try {
    await api("POST", "/api/moi/motdepasse", { ancien: f.ancien.value, nouveau: f.nouveau.value });
    toast("Mot de passe modifié"); await montrerApp();
  } catch (e) { $("#erreur-mdp").textContent = e.message; $("#erreur-mdp").hidden = false; }
};
$("#mdp-annuler").onclick = () => { $("#ecran-mdp").hidden = true; $("#app").hidden = false; };
$("#btn-mdp").onclick = () => montrerMdp(false);
$("#btn-deconnexion").onclick = () => api("POST", "/api/deconnexion").catch(() => {}).finally(() => montrerConnexion());

/* Reconnexion automatique si la session est encore valide (rechargement de page) */
api("GET", "/api/moi").then(({ moi }) => { S.moi = moi; return moi.doitChangerMdp ? montrerMdp(true) : montrerApp(); }).catch(() => { if (!S.moi) montrerConnexion(); });
