# NutriLog — logistique des commandes d'un dépôt de distribution alimentaire

Logiciel interne qui suit une commande client de la réception du mail jusqu'à l'expédition, en passant
par les tablettes des préparateurs, poste par poste.

> Ce dossier est **indépendant** du site Herbier : il ne partage ni code ni données avec lui et peut être
> déplacé tel quel dans un dépôt dédié.

## Le circuit

```
Mail du client
   │
   ▼
Secrétariat : saisie de la commande (client, produits, quantités, extrait du mail)
   │
   ▼
Contrôle automatique avant envoi — la commande est BLOQUÉE tant que :
   • un produit n'a pas sa fiche de préparation (instructions générales)
   • un produit n'a pas de consigne pour un poste du circuit
   • le stock est insuffisant
   • aucun préparateur actif n'est affecté à un poste du circuit
   │
   ▼
Poste 1 (ex. Picking)  ──▶  Poste 2 (ex. Emballage)  ──▶  Poste 3 (ex. Contrôle)
   chaque poste ne voit que ce qui l'attend, avec SES consignes pour chaque produit ;
   il prend la commande, coche les lignes (lot, DLC), peut la remettre dans la file,
   puis la transmet automatiquement au poste suivant
   │
   ▼
Retour au secrétariat : validation, transporteur, n° de suivi → Expédiée
   (le secrétariat peut aussi renvoyer la commande à n'importe quel poste avec une raison)
```

À chaque étape : **fil de messages** sur la commande (secrétariat ↔ préparateurs), **historique
horodaté** (qui, quel poste, quoi) et **journal d'audit** global pour l'administrateur.

## Rôles (un identifiant par personne)

| Rôle | Ce qu'il peut faire |
|---|---|
| **Secrétariat** | créer / modifier les commandes, les envoyer en préparation, les rappeler ou renvoyer à un poste, expédier, annuler ; gérer produits (fiches) et clients ; écrire dans le fil |
| **Préparateur** | voir uniquement les commandes qui attendent **son ou ses postes**, prendre, cocher, saisir lot / DLC, remettre dans la file, terminer l'étape ; écrire dans le fil |
| **Administrateur** | tout ce qui précède + comptes utilisateurs, postes du circuit, journal d'audit |

Les postes (Picking, Emballage, Contrôle par défaut) sont modifiables : on peut en ajouter, les renommer,
changer leur ordre. Chaque préparateur est affecté à un ou plusieurs postes.

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

Les données sont dans `data/db.json` (écrit de façon atomique) et le journal d'audit dans
`data/audit.log` (ajout seul). **Sauvegardez ce dossier** régulièrement.

## Sécurité : ce qui est intégré

- Authentification obligatoire ; mots de passe hachés avec **scrypt + sel**, jamais stockés en clair ;
  12 caractères minimum ; changement forcé à la première connexion et après réinitialisation.
- Sessions à jeton aléatoire (256 bits), cookie **HttpOnly + SameSite=Strict** (+ `Secure` en HTTPS),
  expiration après 8 h d'inactivité et 24 h maximum ; désactiver un compte coupe ses sessions immédiatement.
- **Rôles et postes vérifiés côté serveur** pour chaque action : un préparateur ne peut ni expédier, ni
  prendre l'étape d'un autre poste, ni voir les e-mails des clients ; le secrétariat n'a pas accès à l'audit.
- **Anti-force-brute** : 5 échecs → blocage 15 min, par adresse IP et par compte ; réponse identique que le
  compte existe ou non.
- **Anti-CSRF** (en-tête personnalisé + contrôle d'origine + SameSite) ; en-têtes de sécurité
  (Content-Security-Policy stricte, X-Frame-Options DENY, nosniff, Referrer-Policy, HSTS en HTTPS).
- Validation stricte de toutes les entrées (types, longueurs, valeurs autorisées), taille des requêtes
  limitée, aucun détail technique renvoyé en cas d'erreur, protection contre la traversée de chemins.
- **Journal d'audit** en ajout seul : chaque connexion (réussie, échouée, bloquée), chaque action métier,
  avec l'utilisateur, le rôle, l'adresse IP et l'horodatage. Historique complet par commande.

## Sécurité : ce qui reste à faire pour une mise en production

Aucun logiciel n'est « 100 % sûr » ; la sécurité dépend autant de l'hébergement et des pratiques que du
code. Pour une exploitation réelle en entreprise, il faut au minimum :

1. **HTTPS** obligatoire (`TLS_KEY` / `TLS_CERT`, certificat interne ou Let's Encrypt) — sans cela les
   mots de passe transitent en clair sur le Wi-Fi.
2. Le serveur accessible **uniquement sur le réseau interne / VPN**, jamais exposé directement sur Internet
   (pare-feu, ou reverse proxy type nginx/Caddy devant).
3. **Sauvegardes** automatiques et testées du dossier `data/` (chiffrées si hors site).
4. Lancer le serveur sous un **compte système dédié sans privilèges**, avec un service (systemd, NSSM sous
   Windows) pour le redémarrage automatique ; garder Node.js à jour.
5. Une politique de comptes : un identifiant par personne (jamais partagé), désactivation immédiate au
   départ d'un salarié, revue périodique du journal d'audit.
6. Pour aller plus loin : base de données serveur (PostgreSQL) au lieu du fichier JSON dès que le volume
   augmente, double authentification (TOTP), et un **audit de sécurité indépendant / test d'intrusion**
   avant la mise en production — c'est la seule façon d'avoir une assurance externe.

## Tests

Un scénario complet (secrétariat → 3 postes → renvoi → expédition, plus les contrôles de sécurité) est
joué par `test/test.mjs` :

```bash
cd nutrilog
npm test
```

## Structure

```
nutrilog/
├── server.js          serveur HTTP/HTTPS + API + règles métier + sécurité (aucune dépendance)
├── public/
│   ├── index.html     écrans : connexion, changement de mot de passe, application
│   ├── app.js         interface secrétariat / tablettes / admin (rafraîchissement auto toutes les 4 s)
│   └── style.css
├── test/test.mjs      scénario de bout en bout
└── data/              créé au 1er lancement (db.json, audit.log) — non versionné
```

## Évolutions prévues

- **Référencement produits** : import du catalogue complet (CSV / lien avec le site) — à venir.
- Impression du bon de préparation / étiquettes colis.
- Notifications (son sur la tablette quand une commande arrive à son poste, e-mail au client à l'expédition).
