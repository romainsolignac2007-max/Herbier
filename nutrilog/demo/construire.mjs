/* Construit la démo en ligne (une seule page HTML autonome) à partir du vrai code de NutriLog.
   Usage : node demo/construire.mjs <fichier-de-sortie.html> */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const R = join(dirname(fileURLToPath(import.meta.url)), "..");
const lire = (p) => readFileSync(join(R, p), "utf8");
const sortie = process.argv[2] || join(R, "demo", "nutrilog-demo.html");

const index = lire("public/index.html");
const corpsApp = index.slice(index.indexOf("<body>") + 6, index.indexOf('<script src="app.js">')).trim();
const scripts = [lire("demo/navigateur-serveur.js"), lire("server.js"), lire("public/app.js"), lire("demo/pilote.js")];
if (scripts.some((s) => /<\/script/i.test(s))) throw new Error("« </script » dans un script : la page serait coupée");

const html = `<title>NutriLog</title>
<meta name="robots" content="noindex, nofollow" />
<style>
${lire("public/style.css")}
/* ----- Bandeau de démonstration ----- */
.demo-bandeau { position: relative; z-index: 60; background: var(--bleu-fonce); color: #eef3f9; padding: 12px 16px; display: grid; gap: 10px; }
.demo-titre { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: baseline; justify-content: space-between; }
.demo-titre strong { font-size: 0.95rem; letter-spacing: 0.02em; }
.demo-titre p { font-size: 0.82rem; color: #b9c9db; max-width: 70ch; }
.demo-roles { display: flex; flex-wrap: wrap; gap: 8px; }
.demo-role { display: grid; text-align: left; gap: 0; padding: 7px 12px; border-radius: 10px; border: 1px solid #3c5a7a; background: #21405f; color: #eef3f9; font: inherit; cursor: pointer; min-height: 44px; }
.demo-role b { font-size: 0.9rem; }
.demo-role span { font-size: 0.75rem; color: #b9c9db; text-transform: uppercase; letter-spacing: 0.05em; }
.demo-role[aria-pressed="true"] { background: #eef3f9; color: var(--bleu-fonce); border-color: #eef3f9; }
.demo-role[aria-pressed="true"] span { color: var(--bleu); }
.demo-role:focus-visible, .demo-reinit:focus-visible { outline: 2px solid #9cc3ec; outline-offset: 2px; }
.demo-reinit { background: transparent; border: 1px solid #3c5a7a; color: #b9c9db; border-radius: 10px; padding: 7px 12px; font: inherit; font-size: 0.82rem; cursor: pointer; min-height: 44px; }
#ecran-connexion { min-height: auto; padding-block: 40px; }
</style>

<header class="demo-bandeau" aria-label="Démonstration">
  <div class="demo-titre">
    <strong>Démonstration — données fictives, enregistrées uniquement dans votre navigateur</strong>
    <p>Choisissez qui vous êtes. Sur le terrain, chaque personne a son propre appareil et son propre identifiant (mot de passe de démo : ${"Demo2026demo"}).</p>
  </div>
  <div class="demo-roles" id="demo-roles"></div>
  <div><button type="button" class="demo-reinit" id="demo-reinit">Remettre la démo à zéro</button></div>
</header>

${corpsApp}

<script>
${scripts[0]}
</script>
<script>
const NutriServeur = (function (require, module, process, __dirname, Buffer, setInterval) {
${scripts[1]}
;lireDb(); demarre = true;
return { gerer };
})(NutriDemo.require, { exports: {} }, NutriDemo.process, "/app", NutriDemo.Buffer, NutriDemo.setIntervalDemo);
</script>
<script>
${scripts[2]}
</script>
<script>
${scripts[3]}
</script>
`;
writeFileSync(sortie, html);
console.log("Démo écrite :", sortie, Math.round(html.length / 1024) + " Ko");
