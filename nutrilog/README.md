# NutriLog — logistique des commandes d'un dépôt de distribution d'aliments pour animaux

Logiciel interne qui suit une commande client (animalerie, vétérinaire, éleveur…) de la réception du mail
jusqu'à l'expédition, en passant par les tablettes des préparateurs, poste par poste. Produits : croquettes,
pâtées, friandises, litière, aliments frais ou surgelés (BARF), avec traçabilité lot + DDM/DLC.

> Ce dossier est **indépendant** du site Herbier : il ne partage ni code ni données avec lui et peut être
> déplacé tel quel dans un dépôt dédié.

## Le circuit

```
Mail du client
   │
   ▼
Secrétariat : saisie de la commande (client, produits, quantités, extrait du mail, dates contrôlées)
   │
   ▼
Contrôle automatique avant envoi — la commande est BLOQUÉE tant que :
   • un produit n'a pas sa fiche de préparation (instructions générales)
   • un produit n'a pas de consigne pour un poste du circuit
   • le stock DISPONIBLE est insuffisant (quantités cumulées par produit)
   • aucun préparateur actif n'est affecté à un poste du circuit
   │   dès l'envoi, les quantités sont RÉSERVÉES : deux commandes ne peuvent pas se partager le même stock
   │   (rappel au secrétariat ou annulation → stock libéré ; chaque mouvement est historisé)
   ▼
Poste 1 (ex. Picking)  ──▶  Poste 2 (ex. Emballage)  ──▶  Poste 3 (ex. Contrôle)
   chaque poste ne voit que ce qui l'attend, avec SES consignes pour chaque produit ;
   il prend la commande, coche les lignes, saisit lot + DDM/DLC (chaque saisie est historisée),
   peut la remettre dans la file, puis la transmet automatiquement au poste suivant ;
   seul celui qui a pris l'étape peut la faire avancer — aucun poste ne peut être sauté
   │
   ▼
Retour au secrétariat : validation, transporteur, n° de suivi → Expédiée
   (le secrétariat peut renvoyer la commande à l'étape en cours ou à une étape déjà faite, avec une raison ;
   une commande passée en préparation ne peut plus être supprimée, seulement annulée)
```

À chaque étape : **fil de messages** sur la commande (secrétariat ↔ préparateurs), **historique
horodaté** (qui, quel poste, quoi) et **journal d'audit** global pour l'administrateur.

## Rôles (un identifiant par personne)

| Rôle | Ce qu'il peut faire |
|---|---|
| **Secrétariat** | créer / modifier les commandes, les envoyer en préparation, les rappeler ou renvoyer à un poste, expédier, annuler ; gérer produits (fiches) et clients ; écrire dans le fil |
| **Préparateur** | voir uniquement les commandes qui attendent **son ou ses postes** (ou sur lesquelles il a travaillé), prendre, cocher, saisir lot / DDM, remettre dans la file, terminer l'étape ; écrire dans le fil. La tablette ne reçoit ni l'extrait du mail, ni les coordonnées des clients, ni la liste du personnel. |
| **Administrateur** | tout ce qui précède + comptes utilisateurs, postes du circuit, journal d'audit |

Les postes (Picking, Emballage, Contrôle par défaut) sont modifiables : on peut en ajouter, les renommer,
changer leur ordre. Chaque préparateur est affecté à un ou plusieurs postes. Si l'admin retire un
préparateur d'un poste (ou désactive / supprime son compte) alors qu'il tient une étape, celle-ci est
automatiquement remise dans la file de son poste, et c'est tracé.

## Installation

Pré-requis : [Node.js](https://nodejs.org) 18 ou plus. Aucune dépendance à installer.

```bash
cd nutrilog
ADMIN_PASSWORD='UnMotDePasseInitial2026' node server.js
```

Au **premier lancement**, le compte `admin` est créé (mot de passe = `ADMIN_PASSWORD`, ou généré et
affiché dans la console). Il doit être changé à la première connexion. Ensuite l'admin crée les comptes
de chaque secrétaire et de chaque préparateur (onglet *Utilisateurs*), avec un mot de passe provisoire que
la personne devra changer à sa première connexion.

- PC du secrétariat : `http://localhost:3000`
- Tablettes : `http://<adresse-IP-du-PC-serveur>:3000` (même réseau Wi-Fi / VPN)

Variables d'environnement :

| Variable | Rôle | Défaut |
|---|---|---|
| `PORT` | port d'écoute | `3000` |
| `HOST` | adresse d'écoute (`127.0.0.1` pour n'accepter que le PC local) | `0.0.0.0` |
| `ADMIN_PASSWORD` | mot de passe initial du compte admin (1er lancement seulement) | généré |
| `TLS_KEY`, `TLS_CERT` | chemins clé + certificat → active HTTPS | — |
| `DATA_DIR` | dossier des données | `./data` |
| `TRUST_PROXY` | `1` uniquement derrière un reverse proxy HTTPS (nginx : `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`, Caddy : par défaut). Active cookie `Secure` + HSTS et lit l'adresse réelle des postes. Exige `HOST=127.0.0.1` (refus de démarrer sinon) ; toute requête sans `X-Forwarded-For` est refusée (proxy mal configuré). | — |
| `SESSION_INACTIVITE_MIN` | minutes sans action avant déconnexion (le rafraîchissement automatique des écrans ne compte pas) — ex. `30` pour des tablettes partagées | `480` |
| `ADMIN_RESET_PASSWORD` | **récupération** du compte `admin` (mot de passe oublié) : réinitialisé au démarrage, à changer à la connexion, tracé dans l'audit. **À retirer ensuite.** | — |

Les données sont dans `data/db.json` (écrit de façon atomique) et le journal d'audit dans
`data/audit.log` (ajout seul). **Sauvegardez ce dossier** régulièrement. Si `db.json` devient illisible
(disque, édition manuelle…), le serveur **refuse de démarrer** plutôt que de repartir d'une base vide : il
garde une copie `db.json.illisible-<date>` et demande de restaurer la dernière sauvegarde. Une fois démarré,
un incident de lecture passager renvoie « service momentanément indisponible » sans jamais arrêter le serveur.

## Sécurité : ce qui est intégré

- Authentification obligatoire ; mots de passe hachés avec **scrypt + sel**, jamais stockés en clair ;
  12 caractères minimum ; changement forcé à la première connexion et après réinitialisation.
- Sessions à jeton aléatoire (256 bits), cookie **HttpOnly + SameSite=Strict** (+ `Secure` en HTTPS),
  expiration après 8 h **sans action** (le rafraîchissement automatique d'une tablette oubliée ne la
  maintient pas) et 24 h maximum ; désactiver un compte coupe ses sessions immédiatement ; changer son mot
  de passe déconnecte ses autres appareils.
- **Rôles et postes vérifiés côté serveur** pour chaque action : un préparateur ne peut ni expédier, ni
  prendre l'étape d'un autre poste, ni agir sur l'étape d'un collègue, ni voir les mails ou coordonnées des
  clients (il reçoit « introuvable » pour toute commande qui ne le concerne pas) ; même l'admin ne peut pas
  agir sous le nom d'un préparateur ; le secrétariat n'a pas accès à l'audit.
- **Anti-force-brute** : 5 échecs en 15 min depuis une adresse → adresse bloquée 15 min ; 20 échecs sur un
  même compte (toutes adresses) → compte bloqué 15 min, déblocable par l'admin — sauf depuis les postes
  d'où ce compte s'est déjà connecté : un tiers ne peut pas empêcher le titulaire de travailler. Une
  connexion réussie ne remet pas à zéro le compteur d'une adresse (blocage non contournable). Même limite sur l'« ancien mot de passe » depuis une session
  ouverte. Temps de réponse identique que le compte existe ou non (pas d'énumération des identifiants).
- **Anti-CSRF** (en-tête personnalisé + contrôle d'origine + SameSite) ; en-têtes de sécurité
  (Content-Security-Policy stricte, X-Frame-Options DENY, nosniff, Referrer-Policy, HSTS en HTTPS).
- Validation stricte de toutes les entrées (types, longueurs, valeurs autorisées), taille des requêtes
  limitée, aucun détail technique renvoyé en cas d'erreur, protection contre la traversée de chemins ;
  une requête refusée ne laisse **aucune modification partielle** ; aucune requête ne peut arrêter le serveur.
- **Journal d'audit** en ajout seul : chaque connexion (réussie, échouée, passage en blocage), chaque action
  métier avec son détail (lot / DDM avant → après, mouvements de stock, transporteur, raison d'un renvoi…),
  l'utilisateur, le rôle, l'adresse IP et l'horodatage. Les tentatives rejetées pendant un blocage ne sont
  pas journalisées une à une (le journal ne peut pas être inondé). Historique complet par commande.

## Sécurité : ce qui reste à faire pour une mise en production

Aucun logiciel n'est « 100 % sûr » ; la sécurité dépend autant de l'hébergement et des pratiques que du
code. Pour une exploitation réelle en entreprise, il faut au minimum :

1. **HTTPS** obligatoire (`TLS_KEY` / `TLS_CERT`, certificat interne ou Let's Encrypt) — sans cela les
   mots de passe transitent en clair sur le Wi-Fi.
2. Le serveur accessible **uniquement sur le réseau interne / VPN**, jamais exposé directement sur Internet
   (pare-feu, ou reverse proxy type nginx/Caddy devant, avec `TRUST_PROXY=1` et `HOST=127.0.0.1`).
3. **Sauvegardes** automatiques et testées du dossier `data/` (chiffrées si hors site).
4. Lancer le serveur sous un **compte système dédié sans privilèges**, avec un service (systemd, NSSM sous
   Windows) pour le redémarrage automatique ; garder Node.js à jour.
5. Une politique de comptes : un identifiant par personne (jamais partagé), désactivation immédiate au
   départ d'un salarié, revue périodique du journal d'audit, **un second compte administrateur de secours**.
6. Pour aller plus loin : base de données serveur (PostgreSQL) au lieu du fichier JSON dès que le volume
   augmente, double authentification (TOTP), et un **audit de sécurité indépendant / test d'intrusion**
   avant la mise en production — c'est la seule façon d'avoir une assurance externe.

## Tests

- `npm test` : scénario complet par l'API (secrétariat → 3 postes → renvoi → expédition), contrôles de
  sécurité (CSRF, traversée de chemins en requêtes brutes, force brute, verrouillages, fuite de données),
  réservation de stock, reverse proxy, inactivité, base corrompue, récupération admin (~130 vérifications).
- `npm run test:navigateur` : l'interface dans Chromium (Playwright requis) — réseau coupé pendant la saisie
  d'un lot, double appui, rafraîchissement pendant une saisie, expiration de session, onglet Audit.

```bash
cd nutrilog
npm test
npm run test:navigateur
```

## Structure

```
nutrilog/
├── server.js          serveur HTTP/HTTPS + API + règles métier + sécurité (aucune dépendance)
├── public/
│   ├── index.html     écrans : connexion, changement de mot de passe, application
│   ├── app.js         interface secrétariat / tablettes / admin (rafraîchissement auto toutes les 4 s)
│   └── style.css
├── test/
│   ├── run.mjs        lance le serveur de test puis test.mjs
│   ├── test.mjs       scénario de bout en bout (API)
│   └── navigateur.mjs test de l'interface dans Chromium
└── data/              créé au 1er lancement (db.json, audit.log) — non versionné
```

## Évolutions prévues

- **Référencement produits** : import du catalogue complet (CSV / lien avec le site, marques, gammes, poids) — à venir.
- Impression du bon de préparation / étiquettes colis.
- Notifications (son sur la tablette quand une commande arrive à son poste, e-mail au client à l'expédition).
