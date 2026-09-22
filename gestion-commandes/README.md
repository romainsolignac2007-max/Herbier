# Préparation de commandes — dépôt Herbier

Logiciel de gestion qui relie la **comptabilité** et le **dépôt** :
la commande saisie au bureau part numériquement vers le cariste, qui reçoit
la **liste de ce qu'il faut prendre**, **où le prendre** (allée / travée / niveau)
et un **plan du dépôt** avec le parcours numéroté.

```
Comptabilité                    Dépôt (cariste)                  Retour comptabilité
─────────────                   ───────────────                  ───────────────────
saisie / import  ──envoi──▶  file des commandes                  avancement en direct
de la commande               parcours optimisé + plan            bon de livraison
                             pointage pris / partiel / manquant  stock mis à jour
```

## Démarrer

Aucune dépendance à installer, Node.js 18 ou plus suffit :

```bash
cd gestion-commandes
npm start                  # http://localhost:3000
PORT=8080 npm start        # autre port
npm test                   # 13 tests automatiques
```

Le poste de la comptabilité et la tablette du cariste ouvrent **la même adresse**
sur le réseau local (`http://<ip-du-serveur>:3000`) : chaque écran se met à jour
tout seul toutes les 2,5 secondes.

## Les quatre écrans

| Écran | Pour qui | À quoi ça sert |
|---|---|---|
| **Comptabilité** | bureau | saisir une commande (recherche d'article, ou collage d'une liste `RÉF ; QTÉ`), l'envoyer au dépôt, suivre l'avancement, imprimer les bons |
| **Dépôt — préparation** | cariste | file des commandes à préparer (urgentes en tête), écran de picking pas à pas, plan et vue de face du rack |
| **Plan du dépôt** | tous | cartographie des allées, contenu de chaque travée, tracé du parcours d'une commande |
| **Catalogue & emplacements** | dépôt | les 66 références, leur emplacement, leur stock, alerte sous le seuil, correction d'un rangement |

Chacun saisit son nom en haut à droite : il est enregistré dans l'historique de
la commande (qui a saisi, qui a préparé, qui a déclaré une rupture).

## Cycle d'une commande

`BROUILLON` → `À PRÉPARER` → `EN PRÉPARATION` → `PRÉPARÉE` → `EXPÉDIÉE` (ou `ANNULÉE`)

- la comptabilité crée la commande et l'**envoie au dépôt** (elle apparaît aussitôt chez le cariste) ;
- le cariste **prend en charge** la commande — elle lui est attribuée, les autres le voient ;
- il pointe chaque ligne : **Pris**, **Partiel** (quantité réelle + motif) ou **Manquant** ;
- **Terminer la préparation** refuse de clôturer s'il reste des lignes non pointées,
  décrémente le stock des quantités réellement prélevées et rend la main à la comptabilité ;
- la comptabilité imprime le **bon de livraison** (avec les reliquats) et marque l'expédition.

## Le parcours de picking

Le dépôt est décrit en mètres dans `data/depot.json`. Chaque emplacement s'écrit
**`ALLÉE-TRAVÉE-NIVEAU`** (par exemple `C-04-2` = allée C, travée 4, niveau 2).

Le parcours est calculé en **serpentin** : on remonte un couloir, on redescend le
suivant, et les **deux racks qui bordent un même couloir sont servis dans le même
passage** — on ne repasse jamais deux fois au même endroit. À travée égale, le
niveau bas est prélevé en premier. Le bon affiche la distance, la durée estimée et
le poids total ; les colis de 15 kg et plus sont signalés **charge lourde**, et une
ligne dont le stock ne suffit pas est signalée avant le départ.

## Adapter au dépôt réel

Tout se règle dans deux fichiers, sans toucher au code :

**`data/depot.json`** — la forme du dépôt :

```json
{ "code": "A", "nom": "Plantes vertes d'intérieur",
  "x": 5, "y": 3, "profondeur": 2.4,
  "travees": 11, "niveaux": 3, "couloir": "droite", "couleur": "#2f855a" }
```

`x`/`y` = coin haut-gauche du rack en mètres, `couloir` = de quel côté le
préparateur circule. `depart` et `expedition` placent le poste de préparation et le
quai. Ajouter une allée suffit à la faire apparaître sur le plan et dans les parcours.

**`data/articles.json`** — le catalogue : `sku`, `designation`, `categorie`, `unite`,
`conditionnement`, `poids` (kg par colis), `emplacement`, `stock`, `seuil`.
L'emplacement se corrige aussi directement depuis l'écran Catalogue.

Les données sont des fichiers JSON écrits de façon atomique : une sauvegarde = une
copie du dossier `data/`.

## Structure

```
gestion-commandes/
├── server.js              API HTTP + service des fichiers (bibliothèque standard uniquement)
├── lib/parcours.js        calcul du parcours en serpentin et des coordonnées
├── data/                  depot.json · articles.json · commandes.json
├── public/
│   ├── index.html
│   ├── css/style.css      écran + feuille d'impression
│   └── js/  app.js (noyau) · plan.js (SVG du dépôt) · impression.js
│             compta.js · cariste.js · vue-plan.js · catalogue.js
└── tests/                 tests du parcours et de l'API (node --test)
```

## API

| Méthode | Route | Effet |
|---|---|---|
| `GET` | `/api/etat` | dépôt, catalogue et commandes (avec parcours calculé) |
| `GET` | `/api/commandes/:numero` | une commande et son parcours |
| `POST` | `/api/commandes` | création (`envoyer: true` pour l'envoyer directement au dépôt) |
| `PATCH` | `/api/commandes/:numero` | modification d'un brouillon |
| `POST` | `/api/commandes/:numero/envoyer` \| `affecter` \| `ligne` \| `terminer` \| `expedier` \| `annuler` | étapes du cycle |
| `PATCH` | `/api/articles/:sku` | corriger un emplacement ou un stock |

## Limites connues

Le logiciel est prévu pour un dépôt et un réseau local de confiance : il n'y a pas
de compte utilisateur ni de mot de passe (chacun déclare son nom), pas de liaison
avec un ERP ou une douchette code-barres, et le stock n'est bougé qu'à la clôture
d'une préparation. Le champ de saisie d'article accepte déjà une référence tapée ou
scannée, ce qui est le point d'entrée naturel pour brancher une douchette.
