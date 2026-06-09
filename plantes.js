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
   - photo      : PETITE photo pour les cartes (ex: "lavande.jpg"). Idéalement bien cadrée pour un petit format.
   - photoGrande: GRANDE photo pour le mode swipe (plein écran) et le quizz (ex: "lavande-grand.jpg").
                  Choisir une belle image où on voit bien toute la plante. Si absente, la petite photo est réutilisée.
   - lieu       : "Extérieur", "Intérieur" ou "Les deux"
   - soleil     : "Plein soleil", "Mi-ombre" ou "Ombre"
   - eau        : "Peu", "Modéré" ou "Souvent"
   - presentation: petit texte qui présente la plante (son charme, son usage) — affiché en grand dans le swipe
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
    photoGrande: "lavande-grand.jpg",
    presentation: "Emblème de la Provence, la lavande séduit par son parfum envoûtant et ses épis d'un violet intense. Mellifère et très facile à vivre, elle structure les massifs, borde les allées et parfume aussi bien le jardin que le linge.",
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
    photoGrande: "olivier-grand.jpg",
    presentation: "Symbole de paix et de la Méditerranée, l'olivier est un arbre presque éternel au tronc noueux plein de caractère. Rustique, graphique et persistant, il apporte une touche du Sud aussi bien en pleine terre qu'en grand pot sur une terrasse.",
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
    photoGrande: "monstera-grand.jpg",
    presentation: "Star incontestée des plantes d'intérieur, la Monstera impressionne par ses grandes feuilles découpées en forme de cœur. Facile à vivre et spectaculaire, elle crée une ambiance jungle très tendance dans n'importe quelle pièce lumineuse.",
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
    photoGrande: "rosier-grand.jpg",
    presentation: "Reine du jardin, le rosier offre des floraisons généreuses et délicatement parfumées du printemps jusqu'aux gelées. Il en existe pour tous les goûts — buisson, tige, grimpant ou couvre-sol — et toutes les couleurs imaginables.",
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
    photoGrande: "basilic-grand.jpg",
    presentation: "Incontournable du potager comme de la cuisine, le basilic embaume dès qu'on effleure ses feuilles. Cultivé en pot sur un rebord de fenêtre ou en pleine terre, il accompagne à merveille tomates, pâtes et plats d'été.",
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
    photoGrande: "fougere-grand.jpg",
    presentation: "Avec ses longues frondes retombantes d'un vert tendre, la fougère de Boston apporte fraîcheur et légèreté à la maison. Très décorative en suspension, elle adore les pièces lumineuses et humides comme la salle de bains.",
    lieu: "Intérieur",
    soleil: "Ombre",
    eau: "Souvent",
    saison: "Feuillage toute l'année",
    reconnaitre: "Touffe retombante de longues frondes vert clair, finement découpées en multiples petites folioles. Port léger et arqué, très graphique.",
    entretien: "Lumière douce, jamais de soleil direct qui brûle les frondes. Aime une atmosphère humide : brumisez souvent et gardez le terreau frais. Évitez les courants d'air et l'air trop sec du chauffage."
  },

  // ===================== LOT 1 — best-sellers de pépinière =====================
  {
    nom: "Hortensia", latin: "Hydrangea macrophylla", famille: "Hortensiacées", emoji: "💙",
    photo: "hortensia.jpg", photoGrande: "hortensia.jpg",
    presentation: "Star des jardins de mi-ombre, l'hortensia offre de généreuses boules de fleurs bleues, roses ou blanches tout l'été. Sa couleur dépend de l'acidité du sol : un terrain acide donne du bleu, un sol calcaire du rose.",
    lieu: "Extérieur", soleil: "Mi-ombre", eau: "Souvent", saison: "Floraison de juin à septembre",
    reconnaitre: "Arbuste arrondi aux grandes feuilles vertes dentées. Grosses inflorescences en boules ou en plateaux, dans les tons bleu, rose, mauve ou blanc.",
    entretien: "Aime la mi-ombre et un sol frais, riche et qui ne sèche jamais. Arrosez abondamment en été. Taillez légèrement en fin d'hiver en gardant les bourgeons. Un sol acide bleuit les fleurs."
  },
  {
    nom: "Érable du Japon", latin: "Acer palmatum", famille: "Sapindacées", emoji: "🍁",
    photo: "erable-japon.jpg", photoGrande: "erable-japon.jpg",
    presentation: "Joyau des jardins, l'érable du Japon séduit par son feuillage finement découpé qui s'embrase de rouge et d'orange en automne. Élégant et compact, il se cultive aussi très bien en grand pot.",
    lieu: "Extérieur", soleil: "Mi-ombre", eau: "Modéré", saison: "Feuillage flamboyant en automne",
    reconnaitre: "Petit arbre au port étalé et gracieux. Feuilles palmées à 5-7 lobes pointus, vertes, pourpres ou rouges selon la variété, virant au feu en automne.",
    entretien: "Mi-ombre à l'abri du vent et du soleil brûlant qui grille le feuillage. Sol frais, drainé, plutôt acide. Arrosez en été sans excès. Taille très légère, hors sève."
  },
  {
    nom: "Laurier-rose", latin: "Nerium oleander", famille: "Apocynacées", emoji: "🌸",
    photo: "laurier-rose.jpg", photoGrande: "laurier-rose.jpg",
    presentation: "Incontournable du Midi, le laurier-rose fleurit sans relâche tout l'été. Très résistant à la sécheresse, il fait de superbes haies et potées sur les terrasses ensoleillées. Attention : toutes ses parties sont toxiques.",
    lieu: "Extérieur", soleil: "Plein soleil", eau: "Peu", saison: "Floraison de juin à octobre",
    reconnaitre: "Arbuste touffu aux longues feuilles étroites, vert foncé et coriaces. Bouquets de fleurs roses, blanches, rouges ou jaunes au bout des rameaux.",
    entretien: "Plein soleil et chaleur. Très résistant à la sécheresse une fois installé. Craint le gel fort : à rentrer ou protéger en hiver. Taillez après la floraison. Toxique : à éloigner des enfants et animaux."
  },
  {
    nom: "Géranium", latin: "Pelargonium", famille: "Géraniacées", emoji: "🌺",
    photo: "geranium.jpg", photoGrande: "geranium.jpg",
    presentation: "Roi des balcons, le géranium (pélargonium) fleurit avec générosité de mai aux gelées. Facile et increvable, il colore jardinières et terrasses et n'aime rien tant que le soleil.",
    lieu: "Les deux", soleil: "Plein soleil", eau: "Modéré", saison: "Floraison de mai à octobre",
    reconnaitre: "Plante touffue aux feuilles rondes et veloutées, souvent marquées d'un cercle plus foncé. Bouquets de fleurs vives, rouges, roses, blanches ou saumon.",
    entretien: "Soleil et chaleur. Laissez sécher la terre entre deux arrosages. Retirez les fleurs fanées pour relancer la floraison. Rentrez-le hors gel en hiver."
  },
  {
    nom: "Bambou", latin: "Phyllostachys aurea", famille: "Poacées", emoji: "🎍",
    photo: "bambou.jpg", photoGrande: "bambou.jpg",
    presentation: "Pour une ambiance zen et un brise-vue rapide, le bambou est imbattable. Ses cannes élancées et son feuillage bruissant au vent créent un écran végétal très décoratif. Pensez à la barrière anti-rhizome.",
    lieu: "Extérieur", soleil: "Mi-ombre", eau: "Modéré", saison: "Feuillage persistant toute l'année",
    reconnaitre: "Cannes creuses et ligneuses, souvent dorées ou vertes, portant un feuillage fin et léger. Pousse en touffe ou s'étale par rhizomes traçants.",
    entretien: "Soleil ou mi-ombre, sol frais. Arrosez bien la première année. Installez une barrière anti-rhizome pour les variétés traçantes, sinon il envahit. Très vigoureux."
  },
  {
    nom: "Buis", latin: "Buxus sempervirens", famille: "Buxacées", emoji: "🌳",
    photo: "buis.jpg", photoGrande: "buis.jpg",
    presentation: "Grand classique des jardins à la française, le buis se taille en boules, haies et topiaires. Son feuillage dense et persistant structure le jardin toute l'année. Surveillez la pyrale du buis.",
    lieu: "Extérieur", soleil: "Mi-ombre", eau: "Modéré", saison: "Feuillage persistant toute l'année",
    reconnaitre: "Arbuste très dense à petites feuilles ovales, vert foncé et luisantes. Croissance lente, se prête parfaitement à la taille en formes géométriques.",
    entretien: "Soleil ou mi-ombre, tout sol drainé. Taillez 1 à 2 fois par an pour garder la forme. Surveillez la pyrale (chenilles) et le dépérissement. Arrosage modéré."
  },
  {
    nom: "Camélia", latin: "Camellia japonica", famille: "Théacées", emoji: "🌹",
    photo: "camelia.jpg", photoGrande: "camelia.jpg",
    presentation: "Le camélia illumine la fin d'hiver de ses grandes fleurs élégantes, alors que le jardin est encore endormi. Son beau feuillage vernissé reste décoratif toute l'année à la mi-ombre.",
    lieu: "Extérieur", soleil: "Mi-ombre", eau: "Modéré", saison: "Floraison de janvier à avril",
    reconnaitre: "Arbuste au feuillage persistant, vert foncé et brillant. Grandes fleurs simples ou doubles, blanches, roses ou rouges, en fin d'hiver.",
    entretien: "Mi-ombre à l'abri du soleil du matin sur le gel. Sol acide (terre de bruyère), frais et drainé. Arrosez à l'eau non calcaire. Ne taillez quasiment pas."
  },
  {
    nom: "Glycine", latin: "Wisteria sinensis", famille: "Fabacées", emoji: "💜",
    photo: "glycine.jpg", photoGrande: "glycine.jpg",
    presentation: "Reine des grimpantes, la glycine déroule au printemps de spectaculaires grappes parfumées mauves ou blanches. Vigoureuse et longévive, elle habille pergolas et façades d'une cascade fleurie.",
    lieu: "Extérieur", soleil: "Plein soleil", eau: "Modéré", saison: "Floraison en avril-mai",
    reconnaitre: "Plante grimpante ligneuse aux tiges torsadées très vigoureuses. Longues grappes pendantes de fleurs mauves, lilas ou blanches, parfumées.",
    entretien: "Plein soleil pour bien fleurir. Sol profond et riche. Support solide indispensable. Taillez deux fois par an (été et hiver) pour maîtriser sa vigueur et favoriser la floraison."
  },
  {
    nom: "Romarin", latin: "Salvia rosmarinus", famille: "Lamiacées", emoji: "🌿",
    photo: "romarin.jpg", photoGrande: "romarin.jpg",
    presentation: "Aromatique méditerranéenne par excellence, le romarin parfume la cuisine et le jardin toute l'année. Mellifère et résistant à la sécheresse, il se couvre de petites fleurs bleues dès la fin de l'hiver.",
    lieu: "Extérieur", soleil: "Plein soleil", eau: "Peu", saison: "Floraison de février à mai",
    reconnaitre: "Arbuste aux feuilles fines en aiguilles, vert foncé dessus et argentées dessous, très aromatiques. Petites fleurs bleu pâle le long des tiges.",
    entretien: "Plein soleil, sol pauvre, sec et bien drainé. Arrose très peu. Taillez légèrement après la floraison pour garder une forme compacte. Rustique et facile."
  },
  {
    nom: "Thym", latin: "Thymus vulgaris", famille: "Lamiacées", emoji: "🌱",
    photo: "thym.jpg", photoGrande: "thym.jpg",
    presentation: "Petit sous-arbrisseau de garrigue, le thym est indispensable au potager et à la cuisine. Robuste, couvre-sol et mellifère, il adore les sols secs et les rocailles ensoleillées.",
    lieu: "Extérieur", soleil: "Plein soleil", eau: "Peu", saison: "Floraison de mai à juillet",
    reconnaitre: "Touffe basse et compacte de minuscules feuilles aromatiques gris-vert. Petites fleurs roses ou mauves très visitées par les abeilles.",
    entretien: "Plein soleil, sol pauvre et très drainé, même caillouteux. Craint l'humidité stagnante. Arrosage quasi nul une fois installé. Taillez après floraison."
  },
  {
    nom: "Gaura", latin: "Gaura lindheimeri", famille: "Onagracées", emoji: "🦋",
    photo: "gaura.jpg", photoGrande: "gaura.jpg",
    presentation: "Légère et aérienne, la gaura danse au moindre souffle de vent avec ses nuées de petites fleurs en papillons. Florifère tout l'été et résistante à la sécheresse, elle apporte naturel et mouvement aux massifs.",
    lieu: "Extérieur", soleil: "Plein soleil", eau: "Peu", saison: "Floraison de mai à octobre",
    reconnaitre: "Touffe souple et buissonnante aux fines tiges arquées. Multitude de petites fleurs blanches ou roses évoquant des papillons en vol.",
    entretien: "Plein soleil, sol drainé même pauvre. Très résistante à la sécheresse. Rabattez en fin d'hiver. Floraison ininterrompue sans entretien."
  },
  {
    nom: "Agapanthe", latin: "Agapanthus africanus", famille: "Amaryllidacées", emoji: "💠",
    photo: "agapanthe.jpg", photoGrande: "agapanthe.jpg",
    presentation: "L'agapanthe dresse en plein été ses superbes boules de fleurs bleues ou blanches au-dessus d'un feuillage en lanières. Idéale en massif ou en grand pot sur une terrasse ensoleillée.",
    lieu: "Extérieur", soleil: "Plein soleil", eau: "Modéré", saison: "Floraison de juin à août",
    reconnaitre: "Touffe de longues feuilles rubanées vert vif. Hautes tiges nues portant une ombelle sphérique de fleurs bleues ou blanches.",
    entretien: "Plein soleil, sol drainé et riche. Arrosez en période de croissance. Protégez la souche du gel en hiver (paillage) ou rentrez les potées. Belle en pot un peu serré."
  },
  {
    nom: "Hibiscus", latin: "Hibiscus syriacus", famille: "Malvacées", emoji: "🌺",
    photo: "hibiscus.jpg", photoGrande: "hibiscus.jpg",
    presentation: "L'althéa, ou hibiscus de jardin, offre en fin d'été une profusion de grandes fleurs colorées à cœur souvent contrasté. Rustique et facile, il fait de jolies haies fleuries et des sujets isolés.",
    lieu: "Extérieur", soleil: "Plein soleil", eau: "Modéré", saison: "Floraison de juillet à octobre",
    reconnaitre: "Arbuste au port dressé, à feuilles dentées. Grandes fleurs en trompette, blanches, roses, mauves ou bleutées, souvent à cœur rouge.",
    entretien: "Plein soleil, tout sol drainé. Rustique et résistant. Taillez en fin d'hiver pour une floraison généreuse. Arrosage modéré, un peu plus en pot."
  },
  {
    nom: "Clématite", latin: "Clematis", famille: "Renonculacées", emoji: "💜",
    photo: "clematite.jpg", photoGrande: "clematite.jpg",
    presentation: "Grimpante préférée des jardiniers, la clématite couvre treillages et arches de grandes fleurs étoilées. Règle d'or : la tête au soleil, le pied à l'ombre et au frais.",
    lieu: "Extérieur", soleil: "Mi-ombre", eau: "Modéré", saison: "Floraison du printemps à l'automne selon variété",
    reconnaitre: "Plante grimpante aux tiges fines s'accrochant par les pétioles. Grandes fleurs plates étoilées, dans toutes les teintes de blanc, rose, mauve, violet.",
    entretien: "Fleurs au soleil mais pied à l'ombre (paillez ou plantez une vivace devant). Sol frais et riche. Arrosez régulièrement. La taille dépend du groupe de la variété."
  },
  {
    nom: "Pivoine", latin: "Paeonia lactiflora", famille: "Péoniacées", emoji: "🌸",
    photo: "pivoine.jpg", photoGrande: "pivoine.jpg",
    presentation: "Symbole de romantisme, la pivoine déploie au printemps d'énormes fleurs opulentes et parfumées. Très longévive, elle peut fleurir au même endroit pendant des décennies.",
    lieu: "Extérieur", soleil: "Plein soleil", eau: "Modéré", saison: "Floraison en mai-juin",
    reconnaitre: "Touffe de feuilles découpées vert profond. Grosses fleurs simples ou doubles, blanches, roses ou rouges, souvent parfumées.",
    entretien: "Plein soleil, sol riche et profond. Ne plantez pas trop profond (sinon elle ne fleurit pas). Patiente : elle s'installe en 2-3 ans. Ne la déplacez pas."
  },
  {
    nom: "Magnolia", latin: "Magnolia × soulangeana", famille: "Magnoliacées", emoji: "🌷",
    photo: "magnolia.jpg", photoGrande: "magnolia.jpg",
    presentation: "Spectacle inoubliable du printemps, le magnolia se couvre de grandes fleurs en tulipe rose et blanc avant même les feuilles. Un arbre majestueux qui marque le réveil du jardin.",
    lieu: "Extérieur", soleil: "Plein soleil", eau: "Modéré", saison: "Floraison en mars-avril",
    reconnaitre: "Petit arbre au port arrondi. Grandes fleurs en coupe, rose tendre à pourpre et blanc, s'ouvrant sur les rameaux nus avant le feuillage.",
    entretien: "Soleil ou mi-ombre à l'abri des vents froids qui abîment les fleurs. Sol frais, riche, plutôt acide. Arrosez les premières années. Évitez de tailler."
  },
  {
    nom: "Palmier de Chine", latin: "Trachycarpus fortunei", famille: "Arécacées", emoji: "🌴",
    photo: "palmier.jpg", photoGrande: "palmier.jpg",
    presentation: "Le plus rustique des palmiers, le Trachycarpus apporte une touche exotique même sous les climats froids. Son stipe fibreux et ses larges palmes en éventail résistent jusqu'à -15 °C.",
    lieu: "Extérieur", soleil: "Plein soleil", eau: "Modéré", saison: "Feuillage persistant toute l'année",
    reconnaitre: "Tronc unique couvert de fibres brunes, couronné de grandes feuilles palmées en éventail, vert foncé et rigides.",
    entretien: "Soleil ou mi-ombre, sol drainé. Arrosez bien les premières années puis il devient résistant. Rustique. Coupez les palmes sèches à la base."
  },
  {
    nom: "Citronnier", latin: "Citrus limon", famille: "Rutacées", emoji: "🍋",
    photo: "citronnier.jpg", photoGrande: "citronnier.jpg",
    presentation: "Symbole du Sud, le citronnier offre fleurs parfumées et fruits dorés une bonne partie de l'année. En pot, il s'installe sur les terrasses et passe l'hiver à l'abri du gel.",
    lieu: "Les deux", soleil: "Plein soleil", eau: "Modéré", saison: "Fleurs et fruits une grande partie de l'année",
    reconnaitre: "Petit arbre au feuillage persistant vert brillant. Fleurs blanches très parfumées, suivies de citrons jaunes.",
    entretien: "Plein soleil et chaleur. Arrosez régulièrement sans détremper, engrais agrumes en saison. Rentrez-le en véranda ou serre hors gel l'hiver. Craint le froid."
  },
  {
    nom: "Figuier", latin: "Ficus carica", famille: "Moracées", emoji: "🌳",
    photo: "figuier.jpg", photoGrande: "figuier.jpg",
    presentation: "Arbre nourricier du Midi, le figuier régale de ses fruits sucrés en fin d'été. Son large feuillage découpé crée une ombre généreuse et une vraie ambiance méditerranéenne.",
    lieu: "Extérieur", soleil: "Plein soleil", eau: "Peu", saison: "Récolte des figues en été-automne",
    reconnaitre: "Arbre au port étalé, à grandes feuilles vertes profondément découpées en lobes. Figues vertes à violettes selon la variété.",
    entretien: "Plein soleil et chaleur, sol drainé. Très résistant à la sécheresse une fois installé. Taille légère en hiver. Rustique dans la plupart des régions."
  },
  {
    nom: "Aloe vera", latin: "Aloe vera", famille: "Asphodélacées", emoji: "🌵",
    photo: "aloe-vera.jpg", photoGrande: "aloe-vera.jpg",
    presentation: "Plante grasse aux multiples vertus, l'aloe vera est aussi décorative que facile. Ses feuilles charnues stockent l'eau : on l'oublie presque ! Parfaite en pot sur un rebord ensoleillé.",
    lieu: "Les deux", soleil: "Plein soleil", eau: "Peu", saison: "Feuillage persistant toute l'année",
    reconnaitre: "Rosette de feuilles épaisses, charnues et dentelées sur les bords, vert glauque, remplies d'un gel translucide.",
    entretien: "Beaucoup de lumière, soleil direct progressif. Substrat très drainant (terreau cactées). Arrosez peu, seulement quand la terre est bien sèche. Craint le gel."
  },
  {
    nom: "Orchidée Phalaenopsis", latin: "Phalaenopsis", famille: "Orchidacées", emoji: "🌸",
    photo: "orchidee.jpg", photoGrande: "orchidee.jpg",
    presentation: "L'orchidée papillon est la plus facile des orchidées d'intérieur. Sa longue tige arquée de fleurs élégantes dure des semaines et refleurit chaque année avec un minimum de soins.",
    lieu: "Intérieur", soleil: "Mi-ombre", eau: "Modéré", saison: "Floraison longue, plusieurs mois",
    reconnaitre: "Plante à grosses feuilles épaisses et brillantes, racines aériennes vertes. Hampe arquée portant des fleurs papillon blanches, roses ou mouchetées.",
    entretien: "Lumière vive sans soleil direct. Arrosez en trempant le pot 10 min par semaine puis laissez égoutter (jamais d'eau stagnante). Ambiance chaude et humide."
  },
  {
    nom: "Mimosa", latin: "Acacia dealbata", famille: "Fabacées", emoji: "💛",
    photo: "mimosa.jpg", photoGrande: "mimosa.jpg",
    presentation: "Soleil de l'hiver, le mimosa illumine janvier et février de ses pompons jaunes au parfum envoûtant. Vigoureux et au feuillage fin argenté, il évoque la Côte d'Azur.",
    lieu: "Extérieur", soleil: "Plein soleil", eau: "Peu", saison: "Floraison en janvier-février",
    reconnaitre: "Petit arbre au feuillage persistant finement découpé, vert argenté. Multitude de petits pompons jaune vif, très parfumés, en fin d'hiver.",
    entretien: "Plein soleil, sol drainé plutôt acide, à l'abri du vent froid. Craint le gel intense. Taillez après la floraison. Pousse vite."
  },
  {
    nom: "Lavande papillon", latin: "Lavandula stoechas", famille: "Lamiacées", emoji: "🦋",
    photo: "lavande-papillon.jpg", photoGrande: "lavande-papillon.jpg",
    presentation: "Cousine de la lavande vraie, la lavande papillon se reconnaît à ses épis surmontés de petites « ailes » colorées. Plus précoce, elle fleurit dès le printemps et adore la chaleur.",
    lieu: "Extérieur", soleil: "Plein soleil", eau: "Peu", saison: "Floraison d'avril à juin",
    reconnaitre: "Petit arbuste gris-vert aromatique. Épis floraux compacts violet foncé, coiffés de bractées en forme d'ailes de papillon mauves.",
    entretien: "Plein soleil, sol pauvre, sec et très drainé. Craint l'humidité et le calcaire. Taillez après floraison. Un peu moins rustique que la lavande vraie."
  },
  {
    nom: "Rosier grimpant", latin: "Rosa (grimpant)", famille: "Rosacées", emoji: "🌹",
    photo: "rosier-grimpant.jpg", photoGrande: "rosier-grimpant.jpg",
    presentation: "Pour habiller un mur, une pergola ou une arche, le rosier grimpant est idéal. Il déploie de longues tiges souples couvertes de fleurs parfumées, parfois remontantes jusqu'à l'automne.",
    lieu: "Extérieur", soleil: "Plein soleil", eau: "Modéré", saison: "Floraison de mai à l'automne selon variété",
    reconnaitre: "Longues tiges sarmenteuses et épineuses à palisser. Fleurs simples ou doubles, en bouquets, dans toutes les couleurs, souvent parfumées.",
    entretien: "Au moins 6 h de soleil. Sol riche et drainé. Palissez les tiges à l'horizontale pour multiplier les fleurs. Taillez et retirez les fleurs fanées. Arrosez au pied."
  }
];
