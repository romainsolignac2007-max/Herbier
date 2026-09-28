/* ============================================================
   NutriLog — démo en ligne : branchement de l'interface sur le serveur
   exécuté dans le navigateur, données d'exemple et bandeau de rôles.
   ============================================================ */
"use strict";

const MDP_DEMO = "Demo2026demo";
const COMPTES_DEMO = [
  { login: "sophie", nom: "Sophie Martin", role: "secretariat", poste: null, lib: "Secrétariat" },
  { login: "karim", nom: "Karim Benali", role: "preparateur", poste: 0, lib: "Picking" },
  { login: "lea", nom: "Léa Dubois", role: "preparateur", poste: 1, lib: "Emballage" },
  { login: "marc", nom: "Marc Petit", role: "preparateur", poste: 2, lib: "Contrôle" },
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

/* Données d'exemple : comptes, commandes à différents stades du circuit */
async function preparerDemo() {
  try { await appelDemo("POST", "/api/connexion", { login: "sophie", mdp: MDP_DEMO }); await appelDemo("POST", "/api/deconnexion"); return; } catch (e) { /* pas encore préparée */ }
  await appelDemo("POST", "/api/connexion", { login: "admin", mdp: "Demo2026admin" });
  await appelDemo("POST", "/api/moi/motdepasse", { ancien: "Demo2026admin", nouveau: MDP_DEMO });
  const etat = await appelDemo("GET", "/api/etat");
  const postes = etat.postes, [croq, pate, barf, litiere] = etat.produits, cl = etat.clients;
  for (const c of COMPTES_DEMO.filter((x) => x.login !== "admin"))
    await appelDemo("POST", "/api/utilisateurs", { login: c.login, nom: c.nom, role: c.role, postes: c.poste === null ? [] : [postes[c.poste].id], mdp: "Provisoire2026x" });
  await appelDemo("POST", "/api/deconnexion");
  for (const c of COMPTES_DEMO.filter((x) => x.login !== "admin")) {
    await appelDemo("POST", "/api/connexion", { login: c.login, mdp: "Provisoire2026x" });
    await appelDemo("POST", "/api/moi/motdepasse", { ancien: "Provisoire2026x", nouveau: MDP_DEMO });
    await appelDemo("POST", "/api/deconnexion");
  }
  const en = async (login, f) => { await appelDemo("POST", "/api/connexion", { login, mdp: MDP_DEMO }); await f(); await appelDemo("POST", "/api/deconnexion"); };
  const cmd = {};
  const nouvelle = (k, client, lignes, extra) => appelDemo("POST", "/api/commandes", { clientId: cl[client].id, dateMail: "2026-09-28", dateLivraisonSouhaitee: "2026-10-01", sourceMail: "Objet : commande\nBonjour, merci de nous livrer la commande ci-dessous.", lignes, ...extra }).then((c) => (cmd[k] = c));
  const etapeComplete = async (login, c) => {
    await en(login, async () => {
      await appelDemo("POST", `/api/commandes/${c.id}/prendre`);
      for (let i = 0; i < c.lignes.length; i++) await appelDemo("POST", `/api/commandes/${c.id}/ligne`, { index: i, fait: true, ...(login === "karim" ? { lot: "L2409-" + (i + 1), dlc: "2027-03-15" } : {}) });
      await appelDemo("POST", `/api/commandes/${c.id}/terminer`);
    });
  };
  await en("sophie", async () => {
    await nouvelle("expediee", 1, [{ produitId: pate.id, quantite: 6 }, { produitId: litiere.id, quantite: 4 }]);
    await nouvelle("urgente", 0, [{ produitId: croq.id, quantite: 6 }, { produitId: pate.id, quantite: 4 }, { produitId: litiere.id, quantite: 10 }], { priorite: "urgente", note: "Livrer avant 10 h, quai arrière" });
    await nouvelle("emballage", 1, [{ produitId: pate.id, quantite: 12 }]);
    await nouvelle("elevage", 2, [{ produitId: croq.id, quantite: 20 }]);
    await nouvelle("brouillon", 0, [{ produitId: barf.id, quantite: 2 }], { note: "Viande surgelée : fiche de préparation à compléter" });
    for (const k of ["expediee", "urgente", "emballage", "elevage"]) await appelDemo("POST", `/api/commandes/${cmd[k].id}/envoyer`);
  });
  await etapeComplete("karim", cmd.expediee); await etapeComplete("lea", cmd.expediee); await etapeComplete("marc", cmd.expediee);
  await en("sophie", () => appelDemo("POST", `/api/commandes/${cmd.expediee.id}/expedier`, { transporteur: "Geodis", suivi: "GE4471203" }));
  await etapeComplete("karim", cmd.emballage);
  await en("lea", () => appelDemo("POST", `/api/commandes/${cmd.emballage.id}/prendre`));
  await en("karim", () => appelDemo("POST", `/api/commandes/${cmd.elevage.id}/message`, { texte: "Il reste 18 sacs du lot A, je complète avec 2 sacs du lot B." }));
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
