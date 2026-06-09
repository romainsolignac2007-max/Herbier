/* ============================================================
   LISTE DES PLANTES
   ------------------------------------------------------------
   Pour AJOUTER une plante : copiez un bloc { ... } ci-dessous,
   collez-le, et changez le texte. Gardez bien la virgule à la fin.

   Champs disponibles :
   - nom        : nom commun (ex: "Lavande")
   - latin      : nom scientifique (ex: "Lavandula angustifolia")
   - famille    : famille botanique (ex: "Lamiacées")
   - emoji      : un emoji qui illustre la plante (s'affiche s'il n'y a pas de photo)
   - photo      : nom du fichier image dans le dossier "images" (ex: "lavande.jpg") — laissez "" si pas de photo
   - lieu       : "Extérieur", "Intérieur" ou "Les deux"
   - soleil     : "Plein soleil", "Mi-ombre" ou "Ombre"
   - eau        : "Peu", "Modéré" ou "Souvent"
   - reconnaitre: comment la reconnaître (texte libre)
   - entretien  : comment l'entretenir (texte libre)
   - saison     : période de floraison / d'intérêt
   ============================================================ */

const PLANTES = [
  {
    nom: "Lavande",
    latin: "Lavandula angustifolia",
    famille: "Lamiacées",
    emoji: "💜",
    photo: "lavande.jpg",
    lieu: "Extérieur",
    soleil: "Plein soleil",
    eau: "Peu",
    saison: "Floraison de juin à août",
    reconnaitre: "Petit arbuste touffu aux feuilles fines, étroites et gris-vert. Tiges florales dressées portant des épis de petites fleurs violettes très parfumées. Parfum reconnaissable entre tous quand on froisse une feuille.",
    entretien: "Adore le soleil et les sols pauvres, secs et bien drainés. Craint l'excès d'eau et l'humidité stagnante. Taillez après la floraison pour garder une forme compacte. Très résistante à la sécheresse une fois installée."
  },
  {
    nom: "Olivier",
    latin: "Olea europaea",
    famille: "Oléacées",
    emoji: "🫒",
    photo: "olivier.jpg",
    lieu: "Extérieur",
    soleil: "Plein soleil",
    eau: "Peu",
    saison: "Feuillage persistant, fleurs au printemps",
    reconnaitre: "Arbre au tronc noueux et tortueux avec l'âge. Feuilles persistantes, vert foncé dessus et argentées dessous. Petites fleurs blanches au printemps, suivies des olives en fin d'été.",
    entretien: "Plein soleil indispensable. Supporte très bien la sécheresse et les sols pauvres. Arrosez peu, surtout les premières années. Craint le gel intense et prolongé. Taille légère en fin d'hiver."
  },
  {
    nom: "Monstera",
    latin: "Monstera deliciosa",
    famille: "Aracées",
    emoji: "🌿",
    photo: "monstera.jpg",
    lieu: "Intérieur",
    soleil: "Mi-ombre",
    eau: "Modéré",
    saison: "Feuillage toute l'année",
    reconnaitre: "Grandes feuilles vert brillant, en forme de cœur, qui se découpent et se perforent en grandissant (les fameux « trous »). Tiges épaisses produisant des racines aériennes.",
    entretien: "Lumière vive mais sans soleil direct. Arrosez quand les premiers centimètres de terre sont secs, sans laisser d'eau stagner. Aime l'humidité ambiante : brumisez les feuilles. Tuteurez-la pour qu'elle grimpe."
  },
  {
    nom: "Rosier",
    latin: "Rosa",
    famille: "Rosacées",
    emoji: "🌹",
    photo: "rosier.jpg",
    lieu: "Extérieur",
    soleil: "Plein soleil",
    eau: "Modéré",
    saison: "Floraison de mai aux gelées",
    reconnaitre: "Arbuste aux tiges épineuses. Feuilles dentées composées de plusieurs folioles. Fleurs très variées en forme et en couleur, souvent parfumées.",
    entretien: "Au moins 6 h de soleil par jour. Sol riche et bien drainé. Arrosez au pied, jamais sur le feuillage, pour éviter les maladies. Taillez en fin d'hiver et retirez les fleurs fanées pour relancer la floraison."
  },
  {
    nom: "Basilic",
    latin: "Ocimum basilicum",
    famille: "Lamiacées",
    emoji: "🌱",
    photo: "basilic.jpg",
    lieu: "Les deux",
    soleil: "Plein soleil",
    eau: "Souvent",
    saison: "De mai à septembre",
    reconnaitre: "Plante aromatique aux feuilles vertes tendres, ovales et brillantes, au parfum puissant. Tiges carrées typiques des Lamiacées. Petites fleurs blanches s'il monte en graine.",
    entretien: "Beaucoup de lumière et de chaleur. Terre toujours légèrement humide, mais sans excès. Pincez régulièrement le haut des tiges pour qu'il se ramifie et retirez les fleurs pour prolonger la production de feuilles."
  },
  {
    nom: "Fougère de Boston",
    latin: "Nephrolepis exaltata",
    famille: "Nephrolépidacées",
    emoji: "🌾",
    photo: "fougere.jpg",
    lieu: "Intérieur",
    soleil: "Ombre",
    eau: "Souvent",
    saison: "Feuillage toute l'année",
    reconnaitre: "Touffe retombante de longues frondes vert clair, finement découpées en multiples petites folioles. Port léger et arqué, très graphique.",
    entretien: "Lumière douce, jamais de soleil direct qui brûle les frondes. Aime une atmosphère humide : brumisez souvent et gardez le terreau frais. Évitez les courants d'air et l'air trop sec du chauffage."
  }
];
