/* Test de bout en bout de NutriLog (serveur lancé sur PORT 3999 avec ADMIN_PASSWORD=AdminInitial123) */
const BASE = "http://127.0.0.1:3999";
let echecs = 0;
function ok(cond, msg) { console.log((cond ? "  ✔ " : "  ✘ ") + msg); if (!cond) echecs++; }

function session() {
  let cookie = "";
  return async function (methode, url, corps, opts = {}) {
    const headers = { "X-Requested-With": "NutriLog", ...(corps ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(opts.headers || {}) };
    if (opts.sansCsrf) delete headers["X-Requested-With"];
    const r = await fetch(BASE + url, { method: methode, headers, body: corps ? JSON.stringify(corps) : undefined });
    const sc = r.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    let data = {}; try { data = await r.json(); } catch {}
    return { status: r.status, data, headers: r.headers };
  };
}

const admin = session(), secr = session(), pick = session(), emb = session(), ctrl = session(), anon = session();

console.log("1. Sécurité de base");
let r = await anon("GET", "/api/etat");
ok(r.status === 401, "sans session → 401");
r = await anon("POST", "/api/connexion", { login: "admin", mdp: "AdminInitial123" }, { sansCsrf: true });
ok(r.status === 403, "sans en-tête anti-CSRF → 403");
r = await fetch(BASE + "/../server.js"); ok(r.status === 404 || r.status === 403, "traversée de chemin refusée (" + r.status + ")");
r = await fetch(BASE + "/"); ok(r.headers.get("content-security-policy")?.includes("default-src 'self'"), "CSP présente");
ok(r.headers.get("x-frame-options") === "DENY", "X-Frame-Options DENY");
r = await anon("POST", "/api/connexion", { login: "admin", mdp: "mauvais" });
ok(r.status === 401, "mauvais mot de passe → 401");

console.log("2. Admin : première connexion, changement de mot de passe obligatoire");
r = await admin("POST", "/api/connexion", { login: "admin", mdp: "AdminInitial123" });
ok(r.status === 200 && r.data.moi.doitChangerMdp, "connexion admin ok, mdp à changer");
r = await admin("GET", "/api/etat"); ok(r.status === 403 && r.data.doitChangerMdp, "bloqué tant que le mdp n'est pas changé");
r = await admin("POST", "/api/moi/motdepasse", { ancien: "AdminInitial123", nouveau: "court" }); ok(r.status === 400, "mdp trop court refusé");
r = await admin("POST", "/api/moi/motdepasse", { ancien: "AdminInitial123", nouveau: "AdminSecurise2026" }); ok(r.status === 200, "mdp changé");
r = await admin("GET", "/api/etat"); ok(r.status === 200 && r.data.utilisateurs, "admin voit l'état complet");
const postes = r.data.postes; const [pPick, pEmb, pCtrl] = postes;
const produits = r.data.produits; const clients = r.data.clients;

console.log("3. Admin crée les comptes (un identifiant par personne)");
const creer = async (login, nom, role, ps) => { const x = await admin("POST", "/api/utilisateurs", { login, nom, role, postes: ps, mdp: "Provisoire2026x" }); ok(x.status === 201, `compte ${login} créé`); return x.data; };
await creer("sophie", "Sophie (secrétariat)", "secretariat", []);
await creer("karim", "Karim (picking)", "preparateur", [pPick.id]);
await creer("lea", "Léa (emballage)", "preparateur", [pEmb.id]);
await creer("marc", "Marc (contrôle)", "preparateur", [pCtrl.id]);
r = await admin("POST", "/api/utilisateurs", { login: "sophie", nom: "x", role: "secretariat", mdp: "Provisoire2026x" }); ok(r.status === 409, "identifiant en double refusé");
r = await admin("POST", "/api/utilisateurs", { login: "hack", nom: "x", role: "dieu", mdp: "Provisoire2026x" }); ok(r.status === 400, "rôle inconnu refusé");

const connecter = async (s, login) => {
  let x = await s("POST", "/api/connexion", { login, mdp: "Provisoire2026x" }); ok(x.status === 200, `${login} connecté`);
  x = await s("POST", "/api/moi/motdepasse", { ancien: "Provisoire2026x", nouveau: "MonMdpPerso2026" }); ok(x.status === 200, `${login} a changé son mdp`);
};
await connecter(secr, "sophie"); await connecter(pick, "karim"); await connecter(emb, "lea"); await connecter(ctrl, "marc");

console.log("4. Secrétariat : commande depuis un mail, contrôle avant envoi");
r = await secr("POST", "/api/commandes", { clientId: clients[0].id, sourceMail: "Objet : commande cantine\nBonjour, 10 packs de lait et 5 cartons de yaourts svp", dateMail: "2026-09-28", dateLivraisonSouhaitee: "2026-09-30", priorite: "urgente", lignes: [{ produitId: produits[0].id, quantite: 10 }, { produitId: produits[2].id, quantite: 2 }] });
ok(r.status === 201 && r.data.statut === "brouillon", "brouillon créé n° " + r.data.numero);
const cmd = r.data;
r = await secr("POST", `/api/commandes/${cmd.id}/envoyer`);
ok(r.status === 409 && r.data.blocages.some((b) => b.includes("Fiche de préparation manquante")), "envoi bloqué : fiche manquante → " + (r.data.blocages || []).join(" | "));
r = await secr("PUT", `/api/commandes/${cmd.id}`, { lignes: [{ produitId: produits[0].id, quantite: 10 }, { produitId: produits[1].id, quantite: 5 }] });
ok(r.status === 200 && r.data.etapes.length === 3, "lignes corrigées, circuit à 3 postes");
r = await pick("POST", `/api/commandes/${cmd.id}/envoyer`); ok(r.status === 403, "un préparateur ne peut pas envoyer");
r = await secr("POST", `/api/commandes/${cmd.id}/envoyer`); ok(r.status === 200 && r.data.statut === "a_preparer", "envoyée → à préparer (poste " + pPick.nom + ")");
r = await secr("PUT", `/api/commandes/${cmd.id}`, { note: "x" }); ok(r.status === 400, "plus modifiable une fois envoyée");

console.log("5. Tablettes : chaque poste ne voit que son travail");
r = await emb("GET", "/api/etat"); ok(r.data.commandes.length === 0, "emballage ne voit rien (c'est au picking)");
r = await pick("GET", "/api/etat"); ok(r.data.commandes.length === 1 && !r.data.commandes[0].sourceMail === false, "picking voit la commande");
ok(!r.data.clients[0].email, "le préparateur ne reçoit pas les e-mails clients");
r = await emb("POST", `/api/commandes/${cmd.id}/prendre`); ok(r.status === 403, "emballage ne peut pas prendre l'étape picking");
r = await pick("POST", `/api/commandes/${cmd.id}/prendre`); ok(r.status === 200 && r.data.statut === "en_preparation", "picking prend la commande");
r = await pick("POST", `/api/commandes/${cmd.id}/terminer`); ok(r.status === 409, "impossible de terminer sans tout cocher");
r = await pick("POST", `/api/commandes/${cmd.id}/ligne`, { index: 0, fait: true, lot: "L2409-A", dlc: "2026-11-15" }); ok(r.status === 200 && r.data.lignes[0].lot === "L2409-A", "ligne 1 cochée avec lot + DLC");
r = await pick("POST", `/api/commandes/${cmd.id}/message`, { texte: "Il ne reste que 9 packs de lait, j'en mets 9 + 1 d'un autre lot" }); ok(r.status === 200, "message du préparateur");
r = await pick("POST", `/api/commandes/${cmd.id}/ligne`, { index: 1, fait: true, lot: "Y-118" }); ok(r.status === 200, "ligne 2 cochée");
r = await pick("POST", `/api/commandes/${cmd.id}/terminer`, { remarque: "RAS" }); ok(r.status === 200 && r.data.statut === "a_preparer" && r.data.etapeIndex === 1, "picking terminé → transmis à l'emballage");
r = await pick("GET", "/api/etat"); ok(r.data.commandes.length === 1, "picking voit encore la commande (il y a travaillé)");
r = await emb("GET", "/api/etat"); ok(r.data.commandes.length === 1, "emballage voit maintenant la commande");
r = await emb("POST", `/api/commandes/${cmd.id}/prendre`); ok(r.status === 200, "emballage prend");
r = await emb("POST", `/api/commandes/${cmd.id}/rendre`, { remarque: "plus de caisses isothermes" }); ok(r.status === 200 && r.data.statut === "a_preparer", "emballage remet dans la file");
r = await secr("POST", `/api/commandes/${cmd.id}/message`, { texte: "Caisses livrées, vous pouvez reprendre" }); ok(r.status === 200 && r.data.messages.length === 2, "réponse du secrétariat dans le fil");
r = await emb("POST", `/api/commandes/${cmd.id}/prendre`); ok(r.status === 200, "emballage reprend");
await emb("POST", `/api/commandes/${cmd.id}/ligne`, { index: 0, fait: true }); await emb("POST", `/api/commandes/${cmd.id}/ligne`, { index: 1, fait: true });
r = await emb("POST", `/api/commandes/${cmd.id}/terminer`); ok(r.status === 200 && r.data.etapeIndex === 2, "emballage terminé → contrôle");
r = await ctrl("POST", `/api/commandes/${cmd.id}/prendre`); ok(r.status === 200, "contrôle prend");
r = await ctrl("POST", `/api/commandes/${cmd.id}/expedier`); ok(r.status === 403, "un préparateur ne peut pas expédier");
await ctrl("POST", `/api/commandes/${cmd.id}/ligne`, { index: 0, fait: true }); await ctrl("POST", `/api/commandes/${cmd.id}/ligne`, { index: 1, fait: true });
r = await ctrl("POST", `/api/commandes/${cmd.id}/terminer`); ok(r.status === 200 && r.data.statut === "preparee", "contrôle terminé → retour secrétariat (préparée)");
r = await secr("GET", "/api/etat"); ok(r.data.produits[0].stock === 70 && r.data.produits[1].stock === 145, "stock décrémenté (80→70, 150→145)");

console.log("6. Secrétariat : renvoi puis expédition, historique");
r = await secr("POST", `/api/commandes/${cmd.id}/renvoyer`, { etape: 2, remarque: "étiquette illisible" }); ok(r.status === 200 && r.data.statut === "a_preparer" && r.data.etapeIndex === 2, "renvoyée au contrôle");
r = await secr("GET", "/api/etat"); ok(r.data.produits[0].stock === 80, "stock re-crédité au renvoi");
await ctrl("POST", `/api/commandes/${cmd.id}/prendre`); await ctrl("POST", `/api/commandes/${cmd.id}/ligne`, { index: 0, fait: true }); await ctrl("POST", `/api/commandes/${cmd.id}/ligne`, { index: 1, fait: true });
r = await ctrl("POST", `/api/commandes/${cmd.id}/terminer`); ok(r.data.statut === "preparee", "contrôle refait");
r = await secr("POST", `/api/commandes/${cmd.id}/expedier`, { transporteur: "Chronofresh", suivi: "CF123456" }); ok(r.status === 200 && r.data.statut === "expediee", "expédiée");
ok(r.data.historique.length >= 12, "historique complet (" + r.data.historique.length + " entrées)");
console.log("     " + r.data.historique.map((x) => (x.poste ? "[" + x.poste + "] " : "") + x.qui + " — " + x.texte).join("\n     "));

console.log("7. Audit & blocage anti-force-brute");
r = await secr("GET", "/api/audit"); ok(r.status === 403, "le secrétariat n'a pas accès à l'audit");
r = await admin("GET", "/api/audit"); ok(r.status === 200 && r.data.some((l) => l.action === "commande.expedier"), "audit admin contient l'expédition");
const bf = session();
for (let i = 0; i < 5; i++) await bf("POST", "/api/connexion", { login: "sophie", mdp: "faux" + i });
r = await bf("POST", "/api/connexion", { login: "sophie", mdp: "MonMdpPerso2026" }); ok(r.status === 429, "compte verrouillé après 5 échecs, même avec le bon mdp");
r = await admin("PUT", `/api/utilisateurs/${(await admin("GET", "/api/etat")).data.utilisateurs.find((u) => u.login === "marc").id}`, { actif: false }); ok(r.status === 200, "admin désactive marc");
r = await ctrl("GET", "/api/etat"); ok(r.status === 401, "session de marc coupée immédiatement");

console.log(echecs ? `\n${echecs} ÉCHEC(S)` : "\nTOUT EST OK");
process.exit(echecs ? 1 : 0);
