/* ============================================================
   NutriLog — démo en ligne : branchement de l'interface sur le serveur
   exécuté dans le navigateur, données d'exemple et bandeau de rôles.
   ============================================================ */
"use strict";

const MDP_DEMO = "Demo2026demo";
const COMPTES_DEMO = [
  { login: "sophie", nom: "Sophie Martin", role: "secretariat", poste: null, lib: "Secrétariat" },
  { login: "lea", nom: "Léa Dubois", role: "preparateur", poste: 0, lib: "Emballage" },
  { login: "admin", nom: "Administrateur", role: "admin", poste: null, lib: "Administrateur" },
];

/* Toute requête « /api/... » de l'interface est servie par server.js dans la page */
const fetchOrigine = window.fetch.bind(window);
window.fetch = (url, opts) => (typeof url === "string" && url.startsWith("/api/") ? NutriDemo.appeler(NutriServeur.gerer, url, opts) : fetchOrigine(url, opts));
// Le cadre des artefacts n'affiche pas les boîtes de dialogue : dans la démo, on confirme d'office
window.confirm = () => true;
window.prompt = (m) => (/mot de passe/i.test(m) ? "Provisoire2026x" : "Motif saisi dans la démo");

async function appelDemo(methode, url, corps) {
  const r = await NutriDemo.appeler(NutriServeur.gerer, url, { method: methode, headers: { "X-Requested-With": "NutriLog", "Content-Type": "application/json" }, body: corps ? JSON.stringify(corps) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(url + " → " + r.status + " " + (d.erreur || ""));
  return d;
}

/* Données d'exemple : le vrai catalogue Solignac Nutrition, quelques stocks et fiches remplis,
   des clients FICTIFS et des commandes à différents stades du circuit */
async function preparerDemo() {
  try { await appelDemo("POST", "/api/connexion", { login: "sophie", mdp: MDP_DEMO }); await appelDemo("POST", "/api/deconnexion"); return; } catch (e) { /* pas encore préparée */ }
  await appelDemo("POST", "/api/connexion", { login: "admin", mdp: "Demo2026admin" });
  await appelDemo("POST", "/api/moi/motdepasse", { ancien: "Demo2026admin", nouveau: MDP_DEMO });
  let etat = await appelDemo("GET", "/api/etat");
  const emb = etat.postes[0];
  for (const c of COMPTES_DEMO.filter((x) => x.login !== "admin"))
    await appelDemo("POST", "/api/utilisateurs", { login: c.login, nom: c.nom, role: c.role, postes: c.poste === null ? [] : [emb.id], mdp: "Provisoire2026x" });

  // Clients fictifs (types de clientèle du dépôt)
  const clients = [];
  for (const c of [
    { nom: "Élevage canin du Causse (fictif)", email: "contact@elevage-causse.example", adresse: "Route du Causse, 12000 Rodez", telephone: "05 65 00 00 00" },
    { nom: "Ferme de la Bouriette (fictif)", email: "ferme.bouriette@example.fr", adresse: "Lieu-dit La Bouriette, 31660 Bessières", telephone: "05 61 00 00 00" },
    { nom: "Animalerie du Tarn (fictif)", email: "commandes@animalerie-tarn.example", adresse: "8 avenue de Toulouse, 81000 Albi", telephone: "05 63 00 00 00" },
  ]) clients.push(await appelDemo("POST", "/api/clients", c));

  // Fiche type pour les sacs Croccitanie, MSM et Céréales d'Occitanie ; Ownat et Saniterpen restent « à compléter »
  const groupe = etat.produits.filter((p) => ["Croccitanie", "MSM Pet Food", "Céréales d'Occitanie"].includes(p.marque)).map((p) => p.id);
  await appelDemo("POST", "/api/produits/fiche-groupee", { ids: groupe, preparation: {
    instructions: "Vérifier la DDM (au moins 3 mois restants) et que le sac est intact, sans déchirure.",
    conditionnement: "Sac seul filmé, ou palette filmée au-delà de 6 sacs",
    vigilance: "Sacs lourds : au-delà de 15 kg, porter à deux ; ne pas empiler plus de 5 sacs.",
    parPoste: { [emb.id]: "Prélever les DDM les plus courtes en premier (FIFO), noter le n° de lot imprimé sur le sac. Filmer, étiqueter le colis au nom du client." },
  } });

  // Stocks et emplacements de quelques références
  const ref = (idSite) => etat.produits.find((p) => p.idSite === idSite);
  const stocks = [
    ["croccitanie-eco-actif-chien-20-kg", 40, "A1"], ["msm-podium-adult-lamb-rice-14-kg", 25, "A3"], ["msm-podium-adult-lamb-rice-2-5-kg", 60, "B2"],
    ["cereales-occitanie-ble-20-kg", 80, "E1"], ["cereales-occitanie-super-galinette-20-kg", 50, "E2"], ["ownat-care-dermatologic-chien-3-kg", 12, "C4"],
  ];
  for (const [idSite, stock, emplacement] of stocks) { const p = ref(idSite); if (p) await appelDemo("PUT", `/api/produits/${p.id}`, { stock, stockAvant: 0, emplacement }); }
  etat = await appelDemo("GET", "/api/etat");
  await appelDemo("POST", "/api/deconnexion");

  for (const c of COMPTES_DEMO.filter((x) => x.login !== "admin")) {
    await appelDemo("POST", "/api/connexion", { login: c.login, mdp: "Provisoire2026x" });
    await appelDemo("POST", "/api/moi/motdepasse", { ancien: "Provisoire2026x", nouveau: MDP_DEMO });
    await appelDemo("POST", "/api/deconnexion");
  }
  const en = async (login, f) => { await appelDemo("POST", "/api/connexion", { login, mdp: MDP_DEMO }); await f(); await appelDemo("POST", "/api/deconnexion"); };
  const l = (idSite, quantite) => ({ produitId: ref(idSite).id, quantite });
  const cmd = {};
  const nouvelle = (k, client, lignes, extra) => appelDemo("POST", "/api/commandes", { clientId: clients[client].id, dateMail: "2026-09-28", dateLivraisonSouhaitee: "2026-10-02", sourceMail: "Objet : commande\nBonjour, merci de nous préparer la commande ci-dessous.", lignes, ...extra }).then((c) => (cmd[k] = c));
  await en("sophie", async () => {
    await nouvelle("expediee", 1, [l("cereales-occitanie-ble-20-kg", 4), l("cereales-occitanie-super-galinette-20-kg", 6)]);
    await nouvelle("urgente", 0, [l("croccitanie-eco-actif-chien-20-kg", 8), l("msm-podium-adult-lamb-rice-14-kg", 2)], { priorite: "urgente", note: "Livrer avant 10 h, quai arrière" });
    await nouvelle("emballage", 2, [l("msm-podium-adult-lamb-rice-2-5-kg", 10)]);
    await nouvelle("message", 0, [l("msm-podium-adult-lamb-rice-14-kg", 3)]);
    await nouvelle("brouillon", 2, [l("ownat-care-dermatologic-chien-3-kg", 2)], { note: "Fiche Ownat à compléter avant envoi" });
    for (const k of ["expediee", "urgente", "emballage", "message"]) await appelDemo("POST", `/api/commandes/${cmd[k].id}/envoyer`);
  });
  await en("lea", async () => {
    const c = cmd.expediee;
    await appelDemo("POST", `/api/commandes/${c.id}/prendre`);
    for (let i = 0; i < c.lignes.length; i++) await appelDemo("POST", `/api/commandes/${c.id}/ligne`, { index: i, fait: true, lot: "L2409-" + (i + 1), dlc: "2027-03-15" });
    await appelDemo("POST", `/api/commandes/${c.id}/terminer`);
    await appelDemo("POST", `/api/commandes/${cmd.emballage.id}/prendre`);
    await appelDemo("POST", `/api/commandes/${cmd.message.id}/message`, { texte: "Il reste 1 sac du lot A, je complète avec 2 sacs du lot B." });
  });
  await en("sophie", () => appelDemo("POST", `/api/commandes/${cmd.expediee.id}/expedier`, { transporteur: "Livraison Solignac", suivi: "TOURNEE-0930" }));
}

/* Bandeau : changer de personne en un clic */
async function seConnecterComme(login) {
  document.querySelectorAll("[data-demo-login]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.demoLogin === login)));
  try { await api("POST", "/api/deconnexion"); } catch (e) { /* pas connecté */ }
  montrerConnexion();
  const { moi } = await api("POST", "/api/connexion", { login, mdp: MDP_DEMO });
  S.moi = moi; S.onglet = "";
  await montrerApp();
}

document.getElementById("demo-roles").innerHTML = COMPTES_DEMO.map((c) =>
  `<button type="button" class="demo-role" data-demo-login="${c.login}" aria-pressed="false"><b>${c.nom}</b><span>${c.lib}</span></button>`).join("");
document.getElementById("demo-roles").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-demo-login]");
  if (b) seConnecterComme(b.dataset.demoLogin).catch((e) => toast(e.message, true));
});
document.getElementById("demo-reinit").addEventListener("click", () => { NutriDemo.effacer(); location.reload(); });

preparerDemo()
  .then(() => seConnecterComme("sophie"))
  .catch((e) => { console.error(e); toast("La démo n'a pas pu se préparer : " + e.message, true); });
