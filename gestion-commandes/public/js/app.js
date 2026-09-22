/* Noyau de l'application : état partagé, appels API, navigation, utilitaires. */
'use strict';

const App = (function () {
  const etat = {
    version: 0,
    depot: null,
    articles: [],
    commandes: [],
    charge: false,
    enLigne: true,
  };

  const vues = {};       // nom -> { monter(el), rafraichir() }
  let vueCourante = null;
  let periodique = null;

  /* ---------------------------------------------------------- utilitaires */

  const LIBELLES = {
    BROUILLON: 'Brouillon',
    A_PREPARER: 'À préparer',
    EN_PREPARATION: 'En préparation',
    PREPAREE: 'Préparée',
    EXPEDIEE: 'Expédiée',
    ANNULEE: 'Annulée',
  };

  const LIBELLES_LIGNE = {
    A_PRELEVER: 'À prélever',
    PRELEVE: 'Prélevé',
    PARTIEL: 'Partiel',
    MANQUANT: 'Manquant',
  };

  function echap(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function date(iso, avecHeure) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return echap(iso);
    const opts = avecHeure
      ? { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }
      : { day: '2-digit', month: '2-digit', year: 'numeric' };
    return d.toLocaleString('fr-FR', opts);
  }

  function jour(iso) {
    if (!iso) return '—';
    const d = new Date(`${iso}T12:00:00`);
    return Number.isNaN(d.getTime()) ? echap(iso) : d.toLocaleDateString('fr-FR');
  }

  function acteur() {
    return (document.getElementById('acteur').value || '').trim() || 'anonyme';
  }

  function toast(message, type) {
    const el = document.createElement('div');
    el.className = `toast ${type || ''}`;
    el.textContent = message;
    document.getElementById('toasts').appendChild(el);
    setTimeout(() => el.remove(), type === 'erreur' ? 6000 : 3500);
  }

  /* ------------------------------------------------------------------ API */

  async function requete(methode, url, corps) {
    const opts = { method: methode, headers: {} };
    if (corps !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(Object.assign({ acteur: acteur() }, corps));
    }
    const rep = await fetch(url, opts);
    let donnees = {};
    try { donnees = await rep.json(); } catch (e) { /* réponse vide */ }
    if (!rep.ok) {
      const err = new Error(donnees.erreur || `Erreur ${rep.status}`);
      err.donnees = donnees;
      throw err;
    }
    return donnees;
  }

  const api = {
    etat: () => requete('GET', '/api/etat'),
    commande: (numero) => requete('GET', `/api/commandes/${encodeURIComponent(numero)}`),
    creer: (corps) => requete('POST', '/api/commandes', corps),
    action: (numero, nom, corps) =>
      requete('POST', `/api/commandes/${encodeURIComponent(numero)}/${nom}`, corps || {}),
    modifier: (numero, corps) => requete('PATCH', `/api/commandes/${encodeURIComponent(numero)}`, corps),
    majArticle: (sku, corps) => requete('PATCH', `/api/articles/${encodeURIComponent(sku)}`, corps),
  };

  /* ---------------------------------------------------------------- état */

  async function synchroniser(forcer) {
    try {
      const donnees = await api.etat();
      const change = donnees.version !== etat.version || forcer;
      etat.version = donnees.version;
      etat.depot = donnees.depot;
      etat.articles = donnees.articles;
      etat.commandes = donnees.commandes;
      etat.charge = true;
      if (!etat.enLigne) { etat.enLigne = true; majSync(); }
      if (change) rafraichir();
    } catch (e) {
      if (etat.enLigne) { etat.enLigne = false; majSync(); }
    }
  }

  function majSync() {
    const el = document.getElementById('sync');
    el.classList.toggle('hs', !etat.enLigne);
    el.textContent = etat.enLigne ? 'connecté' : 'hors ligne — reconnexion…';
  }

  function article(sku) {
    return etat.articles.find((a) => a.sku === sku) || null;
  }

  function commande(numero) {
    return etat.commandes.find((c) => c.numero === numero) || null;
  }

  function rafraichir() {
    majPastille();
    if (vueCourante && vues[vueCourante]) vues[vueCourante].rafraichir();
  }

  function majPastille() {
    const n = etat.commandes.filter((c) => c.statut === 'A_PREPARER').length;
    const el = document.getElementById('pastille-file');
    el.hidden = n === 0;
    el.textContent = n;
  }

  /** Recharge l'état puis rend la main (après une action qui modifie les données). */
  async function apresAction() {
    await synchroniser(true);
  }

  /* --------------------------------------------------------- navigation */

  function enregistrerVue(nom, module) {
    vues[nom] = module;
  }

  function aller(nom) {
    if (!vues[nom]) nom = 'compta';
    vueCourante = nom;
    document.querySelectorAll('#onglets button').forEach((b) => {
      b.classList.toggle('actif', b.dataset.vue === nom);
    });
    document.querySelectorAll('.vue').forEach((s) => {
      s.classList.toggle('active', s.id === `vue-${nom}`);
    });
    if (location.hash !== `#${nom}`) location.hash = nom;
    vues[nom].rafraichir();
  }

  /* --------------------------------------------------------- impression */

  function imprimer(html) {
    document.getElementById('impression').innerHTML = html;
    window.print();
  }

  /* --------------------------------------------------------- démarrage */

  async function demarrer() {
    const champ = document.getElementById('acteur');
    champ.value = localStorage.getItem('herbier.acteur') || '';
    champ.addEventListener('change', () => localStorage.setItem('herbier.acteur', champ.value.trim()));

    document.getElementById('onglets').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-vue]');
      if (b) aller(b.dataset.vue);
    });
    window.addEventListener('hashchange', () => {
      const nom = location.hash.slice(1);
      if (nom && nom !== vueCourante) aller(nom);
    });

    await synchroniser(true);

    Object.keys(vues).forEach((nom) => {
      vues[nom].monter(document.getElementById(`vue-${nom}`));
    });

    aller(location.hash.slice(1) || 'compta');
    periodique = setInterval(synchroniser, 2500);
  }

  return {
    etat, api, demarrer, enregistrerVue, aller, rafraichir, apresAction, synchroniser,
    echap, date, jour, toast, acteur, article, commande, imprimer,
    LIBELLES, LIBELLES_LIGNE,
    get periodique() { return periodique; },
  };
}());
