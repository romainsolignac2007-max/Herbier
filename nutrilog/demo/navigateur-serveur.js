/* ============================================================
   NutriLog — démo en ligne : le VRAI server.js exécuté dans le navigateur.
   Ce fichier fournit à server.js de quoi tourner sans Node.js :
   un faux système de fichiers (mémoire + localStorage), un faux crypto
   (hachage de démonstration, SANS valeur de sécurité), et une fausse
   couche HTTP branchée sur fetch("/api/..."). Rien ne sort du navigateur.
   ============================================================ */
"use strict";

const NutriDemo = (() => {
  const CLE = "nutrilog-demo-fs-v4"; // v4 : catalogue Solignac Nutrition, sans gestion du stock

  /* ---------- Buffer minimal ---------- */
  class Buf extends Uint8Array {
    toString(enc) {
      if (enc === "hex") return Array.from(this, (b) => b.toString(16).padStart(2, "0")).join("");
      if (enc === "base64url") return btoa(String.fromCharCode(...this)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      return new TextDecoder().decode(this);
    }
  }
  const Buffer = {
    from(s, enc) {
      if (enc === "hex") { const b = new Buf(s.length / 2); for (let i = 0; i < b.length; i++) b[i] = parseInt(s.substr(i * 2, 2), 16); return b; }
      const u = new TextEncoder().encode(String(s)); const b = new Buf(u.length); b.set(u); return b;
    },
    alloc: (n) => new Buf(n),
  };

  /* ---------- crypto de démonstration (NON sécurisé, suffisant pour une démo locale) ---------- */
  const crypto = {
    randomBytes(n) { const b = new Buf(n); globalThis.crypto.getRandomValues(b); return b; },
    scryptSync(mdp, sel, n) {
      let h = 2166136261 >>> 0;
      const src = String(mdp) + "|" + Buf.prototype.toString.call(sel, "hex");
      for (let i = 0; i < src.length; i++) { h ^= src.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
      const b = new Buf(n);
      for (let i = 0; i < n; i++) { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; b[i] = h & 255; }
      return b;
    },
    timingSafeEqual(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; },
  };

  /* ---------- système de fichiers en mémoire, sauvegardé dans le navigateur ---------- */
  let fichiers = new Map();
  try { const s = localStorage.getItem(CLE); if (s) fichiers = new Map(Object.entries(JSON.parse(s))); } catch (e) { /* stockage indisponible : démo en mémoire */ }
  const sauver = () => { try { localStorage.setItem(CLE, JSON.stringify(Object.fromEntries(fichiers))); } catch (e) { /* idem */ } };
  const absent = (p) => Object.assign(new Error("ENOENT: " + p), { code: "ENOENT" });
  const octets = (s) => new TextEncoder().encode(s);
  const fs = {
    readFileSync(p) { if (!fichiers.has(p)) throw absent(p); return fichiers.get(p); },
    writeFileSync(p, d) { fichiers.set(p, String(d)); sauver(); },
    renameSync(a, b) { fichiers.set(b, fichiers.get(a)); fichiers.delete(a); sauver(); },
    appendFileSync(p, d) { fichiers.set(p, (fichiers.get(p) || "") + d); sauver(); },
    copyFileSync(a, b) { fichiers.set(b, fichiers.get(a)); },
    mkdirSync() {},
    openSync(p) { if (!fichiers.has(p)) throw absent(p); return { p }; },
    fstatSync(fd) { return { size: octets(fichiers.get(fd.p)).length }; },
    readSync(fd, buf, off, n, pos) { const b = octets(fichiers.get(fd.p)).subarray(pos, pos + n); buf.set(b, off); return b.length; },
    closeSync() {},
    readFile(p, cb) { cb(absent(p)); },
  };
  const path = {
    sep: "/",
    join: (...a) => a.join("/").replace(/\/+/g, "/"),
    resolve: (p) => p,
    normalize: (p) => p,
    dirname: (p) => p.replace(/\/[^/]*$/, ""),
    extname: (p) => (p.match(/\.[^./]*$/) || [""])[0],
  };
  const process = { env: { ADMIN_PASSWORD: "Demo2026admin", DATA_DIR: "/donnees" }, exit(code) { throw new Error("process.exit(" + code + ")"); } };
  const modules = { fs, path, crypto, http: {}, https: {} };
  const require = (n) => modules[n];
  require.main = null;
  const setIntervalDemo = (f, ms) => { const t = setInterval(f, ms); return { unref() { return t; } }; };

  /* ---------- fausse couche HTTP : fetch("/api/...") → gerer(req, res) de server.js ---------- */
  let cookie = "";
  function appeler(gerer, url, opts = {}) {
    return new Promise((resolve) => {
      const ecouteurs = {};
      const entetes = {};
      Object.entries(opts.headers || {}).forEach(([k, v]) => (entetes[k.toLowerCase()] = v));
      entetes.host = "demo.nutrilog";
      if (cookie) entetes.cookie = cookie;
      const req = { method: (opts.method || "GET").toUpperCase(), url, headers: entetes, socket: { remoteAddress: "navigateur-demo" }, on(ev, f) { ecouteurs[ev] = f; return req; }, destroy() {} };
      const recus = {};
      const res = {
        headersSent: false,
        setHeader(k, v) { recus[k.toLowerCase()] = v; },
        writeHead(code, h) { res.statusCode = code; Object.entries(h || {}).forEach(([k, v]) => (recus[k.toLowerCase()] = v)); res.headersSent = true; },
        end(corps) {
          const sc = recus["set-cookie"];
          if (sc) { const val = sc.split(";")[0]; cookie = /Max-Age=0/.test(sc) ? "" : val; }
          resolve(new Response(corps || "", { status: res.statusCode || 200, headers: { "Content-Type": recus["content-type"] || "application/json" } }));
        },
      };
      gerer(req, res);
      setTimeout(() => { if (opts.body && ecouteurs.data) ecouteurs.data(opts.body); if (ecouteurs.end) ecouteurs.end(); }, 0);
    });
  }

  // Fichier fourni avec la page (ex. catalogue initial), lu par server.js au premier lancement de la démo
  const fichierFourni = (p, contenu) => { if (!fichiers.has(p)) fichiers.set(p, contenu); };

  return { Buffer, require, process, setIntervalDemo, appeler, fichierFourni, effacer() { fichiers = new Map(); try { localStorage.removeItem(CLE); } catch (e) { /* */ } } };
})();
