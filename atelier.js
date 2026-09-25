/* ===========================================================================
   atelier.js — L'ATELIER DU PERSONNAGE (refait le 25 sept. 2026)

   Le créateur de personnage du profil : un homme ou une femme, taillé
   entièrement par le script — aucun fichier 3D, aucune bibliothèque —, posé sur
   une plage au coucher du soleil, palmiers et Cadillac rose, dans l'esprit des
   jeux de Miami des années 80.

   POURQUOI UN FICHIER À PART. Tout le reste du site est dans index.html, et la
   page pèse déjà plus d'un mégaoctet : tout le monde la télécharge, y compris
   qui n'ouvrira jamais son profil. L'atelier n'est donc chargé qu'au premier
   passage sur le profil (voir `dressup` dans index.html), comme les modèles du
   dossier models/ l'étaient déjà.

   POURQUOI UN MOTEUR À PART. Celui de la boutique (`model3d`) dessine des
   vêtements tirés de photos, dans une boîte, sans perspective ni os. Ici il faut
   une caméra, un décor, une lumière de fin de journée, et un corps qui bouge :
   WebGL 2, un squelette de trente-neuf os, la peau pesée sur quatre os par
   sommet, et des facettes plates — le « low poly » — calculées par la carte
   graphique à partir des dérivées de la position (voir `eclairer`).

   LE PERSONNAGE EST UNE FONCTION DE SES RÉGLAGES. Rien n'est stocké en dur : le
   corps est une suite d'anneaux dont les rayons dépendent de la stature, de la
   corpulence, des muscles, des hanches… ; la tête, une suite de tranches dont
   le profil dépend de la mâchoire, du nez, des pommettes ; les vêtements, les
   MÊMES anneaux décalés vers l'extérieur — c'est ce qui fait qu'un t-shirt va
   à tous les corps sans avoir été retaillé pour chacun.

   Repères : mètres, y vers le haut, le personnage regarde vers +z, sa GAUCHE
   est en +x (à droite de l'écran quand il nous fait face).
   =========================================================================== */
(() => {
'use strict';
/* Le dossier du site, pris sur l'adresse de ce fichier : les modèles et les
   photos s'y cherchent, quelle que soit la page qui charge l'atelier. */
const BASE = document.currentScript && document.currentScript.src ? new URL('./', document.currentScript.src).href : '';
const adresse = (u) => /^(https?:|data:|blob:|\/)/.test(u) ? u : BASE + u;

/* ---------------------------------------------------------------------------
   1. LES OUTILS DE CALCUL
   --------------------------------------------------------------------------- */
const PI = Math.PI, TAU = PI * 2, DEG = PI / 180;
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const mix = (a, b, t) => a + (b - a) * t;
const lisse = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const cloche = (x, s) => Math.exp(-(x * x) / (2 * s * s));         // gaussienne, 1 en 0
const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  madd: (a, b, k) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: a => Math.hypot(a[0], a[1], a[2]),
  norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
};
/* Les quaternions [x, y, z, w] : une rotation d'os, qu'on sait interpoler sans
   à-coup (voir `q4.slerp`) — ce que des angles d'Euler ne savent pas faire. */
const q4 = {
  id: () => [0, 0, 0, 1],
  axe: (ax, ang) => { const n = v3.norm(ax), s = Math.sin(ang / 2); return [n[0] * s, n[1] * s, n[2] * s, Math.cos(ang / 2)]; },
  mul: (a, b) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]],
  /* En degrés : d'abord le tour sur l'axe vertical (y), qui est celui de l'os
     au repos — une tête qui tourne, un bras qui pivote sur lui-même —, puis
     la bascule avant (x), puis la bascule de côté (z). */
  euler: (x, y, z) => q4.mul(q4.axe([0, 0, 1], z * DEG), q4.mul(q4.axe([1, 0, 0], x * DEG), q4.axe([0, 1, 0], y * DEG))),
  slerp: (a, b, t) => {
    let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3], s = 1;
    if (d < 0){ d = -d; s = -1; }
    if (d > 0.9995){
      const r = [a[0] + (s * b[0] - a[0]) * t, a[1] + (s * b[1] - a[1]) * t, a[2] + (s * b[2] - a[2]) * t, a[3] + (s * b[3] - a[3]) * t];
      const l = Math.hypot(r[0], r[1], r[2], r[3]); return [r[0] / l, r[1] / l, r[2] / l, r[3] / l];
    }
    const th = Math.acos(d), k0 = Math.sin((1 - t) * th) / Math.sin(th), k1 = s * Math.sin(t * th) / Math.sin(th);
    return [a[0] * k0 + b[0] * k1, a[1] * k0 + b[1] * k1, a[2] * k0 + b[2] * k1, a[3] * k0 + b[3] * k1];
  },
  tourne: (q, v) => {                                  // v tourné par q
    const x = q[0], y = q[1], z = q[2], w = q[3];
    const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2];
    const iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
    return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
  },
  // la rotation qui amène la direction a sur la direction b (toutes deux normées)
  entre: (a, b) => {
    const d = v3.dot(a, b);
    if (d > 0.99999) return [0, 0, 0, 1];
    if (d < -0.99999){ const ax = Math.abs(a[0]) < 0.9 ? v3.cross(a, [1, 0, 0]) : v3.cross(a, [0, 1, 0]); return q4.axe(ax, PI); }
    const c = v3.cross(a, b), q = [c[0], c[1], c[2], 1 + d], l = Math.hypot(q[0], q[1], q[2], q[3]);
    return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
  },
};
/* Les matrices, en colonnes comme WebGL les lit : m[12..14] est la translation. */
const m4 = {
  id: () => { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },
  mul: (a, b, o) => {                                  // o = a × b (o ne doit être ni a ni b)
    o = o || new Float32Array(16);
    for (let c = 0; c < 4; c++){
      const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
      o[c * 4]     = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
      o[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
      o[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
      o[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
    }
    return o;
  },
  // rotation (quaternion) puis translation, et une échelle uniforme facultative
  qt: (q, t, e, o) => {
    o = o || new Float32Array(16); e = e == null ? 1 : e;
    const x = q[0], y = q[1], z = q[2], w = q[3];
    o[0] = (1 - 2 * (y * y + z * z)) * e; o[1] = 2 * (x * y + z * w) * e;       o[2] = 2 * (x * z - y * w) * e;       o[3] = 0;
    o[4] = 2 * (x * y - z * w) * e;       o[5] = (1 - 2 * (x * x + z * z)) * e; o[6] = 2 * (y * z + x * w) * e;       o[7] = 0;
    o[8] = 2 * (x * z + y * w) * e;       o[9] = 2 * (y * z - x * w) * e;       o[10] = (1 - 2 * (x * x + y * y)) * e; o[11] = 0;
    o[12] = t[0]; o[13] = t[1]; o[14] = t[2]; o[15] = 1;
    return o;
  },
  persp: (fov, asp, n, f) => {
    const t = 1 / Math.tan(fov / 2), m = new Float32Array(16);
    m[0] = t / asp; m[5] = t; m[10] = (f + n) / (n - f); m[11] = -1; m[14] = 2 * f * n / (n - f);
    return m;
  },
  regard: (oeil, cible, haut) => {                     // la matrice de vue d'un œil qui regarde une cible
    const z = v3.norm(v3.sub(oeil, cible)), x = v3.norm(v3.cross(haut, z)), y = v3.cross(z, x);
    const m = new Float32Array(16);
    m[0] = x[0]; m[4] = x[1]; m[8] = x[2];
    m[1] = y[0]; m[5] = y[1]; m[9] = y[2];
    m[2] = z[0]; m[6] = z[1]; m[10] = z[2];
    m[12] = -v3.dot(x, oeil); m[13] = -v3.dot(y, oeil); m[14] = -v3.dot(z, oeil); m[15] = 1;
    return m;
  },
  inv: (m) => {
    const o = new Float32Array(16);
    const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3], a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
    const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11], a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    const d = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
    o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * d; o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * d;
    o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * d; o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * d;
    o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * d; o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * d;
    o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * d; o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * d;
    o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * d; o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * d;
    o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * d; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * d;
    o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * d; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * d;
    o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * d; o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * d;
    return o;
  },
  point: (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]],
};
/* Un hasard qu'on peut rejouer : la même graine donne le même personnage, le
   même décor, les mêmes taches de rousseur à chaque visite. */
function graine(s){
  let a = (s >>> 0) || 1;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const hexRvb = (h) => { h = String(h || '#808080').replace('#', ''); if (h.length === 3) h = h.replace(/./g, c => c + c);
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255]; };
const rvbHex = (c) => '#' + c.map(v => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')).join('');
const melange = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const assombrir = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

/* ---------------------------------------------------------------------------
   2. LE MAILLAGE
   Une pièce en construction : des sommets (position, normale, coordonnées de
   texture, couleur, os et poids) et des triangles. Tout est écrit dans des
   tableaux simples, puis tassé une seule fois dans des tableaux typés au
   moment d'aller à la carte graphique.
   --------------------------------------------------------------------------- */
class Maille {
  constructor(){ this.p = []; this.n = []; this.uv = []; this.c = []; this.os = []; this.po = []; this.i = []; this.vent = null; }
  get nb(){ return this.p.length / 3; }
  /* `os` : jusqu'à quatre paires [os, poids] ; les poids sont renormalisés ici,
     une fois pour toutes, et les os en trop (les plus faibles) oubliés. */
  sommet(p, uv, c, os){
    this.p.push(p[0], p[1], p[2]);
    this.n.push(0, 0, 0);
    this.uv.push(uv ? uv[0] : 0.5, uv ? uv[1] : 0.5);
    const k = c || [1, 1, 1, 1];
    this.c.push(k[0], k[1], k[2], k[3] == null ? 1 : k[3]);
    let l = (os || [[0, 1]]).filter(o => o[1] > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
    if (!l.length) l = [[0, 1]];
    const s = l.reduce((t, o) => t + o[1], 0);
    for (let j = 0; j < 4; j++){ this.os.push(l[j] ? l[j][0] : 0); this.po.push(l[j] ? l[j][1] / s : 0); }
    return this.nb - 1;
  }
  tri(a, b, c){ this.i.push(a, b, c); }
  quad(a, b, c, d){ this.i.push(a, b, c, a, c, d); }   // a b c d dans le sens trigonométrique vu de dehors
  /* Les normales lissées : la normale de chaque face, pesée par son aire, est
     ajoutée à ses trois sommets. Un anneau fermé partage son premier sommet
     avec son dernier, la couture ne se voit donc pas. */
  normales(){
    const P = this.p, N = this.n, I = this.i;
    N.fill(0);
    for (let t = 0; t < I.length; t += 3){
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const wx = P[c] - P[a], wy = P[c + 1] - P[a + 1], wz = P[c + 2] - P[a + 2];
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      for (const k of [a, b, c]){ N[k] += nx; N[k + 1] += ny; N[k + 2] += nz; }
    }
    for (let k = 0; k < N.length; k += 3){
      const l = Math.hypot(N[k], N[k + 1], N[k + 2]) || 1;
      N[k] /= l; N[k + 1] /= l; N[k + 2] /= l;
    }
    return this;
  }
  // une autre pièce ajoutée à celle-ci (même matière, un seul appel de dessin)
  ajouter(m){
    const d = this.nb;
    this.p.push(...m.p); this.n.push(...m.n); this.uv.push(...m.uv); this.c.push(...m.c);
    this.os.push(...m.os); this.po.push(...m.po);
    for (const k of m.i) this.i.push(k + d);
    if (m.coutures) (this.coutures || (this.coutures = [])).push(...m.coutures.map(([a, b]) => [a + d, b + d]));
    if (m.vent){ this.vent = this.vent || new Array(d).fill(0); this.vent.push(...m.vent); }
    else if (this.vent) this.vent.push(...new Array(m.nb).fill(0));
    return this;
  }
}

/* Un anneau et le suivant, cousus en quadrilatères. `k` sommets par anneau ;
   `ferme` : le dernier rejoint le premier. */
function coudre(M, a0, a1, k, ferme, inverse){
  const n = ferme ? k : k - 1;
  for (let j = 0; j < n; j++){
    const j2 = (j + 1) % k;
    if (inverse) M.quad(a0 + j, a0 + j2, a1 + j2, a1 + j);
    else M.quad(a0 + j, a1 + j, a1 + j2, a0 + j2);
  }
}
/* Un couvercle en éventail sur un anneau fermé, vers un point `centre`. */
function couvercle(M, a0, k, centre, uv, coul, os, inverse){
  const c = M.sommet(centre, uv, coul, os);
  for (let j = 0; j < k; j++){
    const j2 = (j + 1) % k;
    if (inverse) M.tri(a0 + j2, a0 + j, c); else M.tri(a0 + j, a0 + j2, c);
  }
  return c;
}

/* ---------------------------------------------------------------------------
   3. WEBGL 2 : LE CONTEXTE ET LES PROGRAMMES
   Un seul contexte pour tout l'atelier — la scène de la plage, le personnage
   du profil, la carte qu'on partage, les vignettes — : un navigateur n'en
   accorde qu'une quinzaine à une page, et le site en tient déjà plusieurs.
   --------------------------------------------------------------------------- */
let gl = null, cvGL = null;
const MAX_OS = 40;

/* L'éclairage, commun à tous les programmes. DEUX lumières et un ciel :
   - le SOLEIL couchant, bas, derrière le personnage : il dore les bords (le
     liseré, `contre`) et étire les ombres du décor ;
   - la CLÉ, devant, un peu au-dessus : sans elle, un personnage à contre-jour
     n'est qu'une silhouette, et on vient ici pour le voir. Le décor ne la
     reçoit qu'à moitié ;
   - le CIEL et le SABLE : un dégradé d'ambiance selon que la face regarde en
     haut (le mauve du ciel) ou en bas (le sable chaud qui renvoie la lumière).
   LE LOW POLY EST ICI : `plat` remplace la normale du sommet par celle de la
   facette, tirée des dérivées de la position à l'écran. Chaque triangle prend
   une teinte unie, sans qu'il ait fallu dédoubler un seul sommet. */
const GLSL_LUMIERE = `
uniform vec3 uSoleil, uSoleilC, uCle, uCleC, uCielC, uSolC, uCam, uBrumeC;
uniform vec2 uBrume;
vec3 eclairer(vec3 base, vec3 n, vec3 p, float cle, float rim, float spec){
  vec3 v = normalize(uCam - p);
  vec3 amb = mix(uSolC, uCielC, n.y * 0.5 + 0.5);
  float ds = max(dot(n, uSoleil), 0.0);
  float dk = max(dot(n, uCle), 0.0);
  float contre = pow(1.0 - max(dot(n, v), 0.0), 2.2) * clamp(dot(-v, uSoleil) * 0.55 + 0.45, 0.0, 1.0);
  float s = pow(max(dot(n, normalize(uCle + v)), 0.0), 36.0) * spec;
  vec3 c = base * (amb + uSoleilC * ds + uCleC * dk * cle) + uSoleilC * contre * rim + uCleC * s;
  float f = clamp((length(uCam - p) - uBrume.x) / (uBrume.y - uBrume.x), 0.0, 1.0);
  return mix(c, uBrumeC, f * f * (3.0 - 2.0 * f));
}`;

const VS_PERSO = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec2 aUV;
layout(location=3) in vec4 aCol;
layout(location=4) in uvec4 aOs;
layout(location=5) in vec4 aPoids;
uniform mat4 uPV, uModele;
uniform mat4 uOs[${MAX_OS}];
out vec3 vPos; out vec3 vNrm; out vec2 vUV; out vec4 vCol;
void main(){
  mat4 S = uOs[aOs.x] * aPoids.x + uOs[aOs.y] * aPoids.y + uOs[aOs.z] * aPoids.z + uOs[aOs.w] * aPoids.w;
  vec4 p = uModele * (S * vec4(aPos, 1.0));
  vPos = p.xyz;
  vNrm = mat3(uModele) * (mat3(S) * aNrm);
  vUV = aUV; vCol = aCol;
  gl_Position = uPV * p;
}`;
/* `uMode` : 0 une matière ordinaire (texture × couleur du sommet × teinte) ;
   1 un ŒIL, peint ici même à chaque image — le blanc, l'iris et sa couleur,
   la pupille, le reflet, les paupières qui se ferment, le trait des cils —,
   ce qui permet au regard de suivre et aux paupières de cligner sans rien
   repeindre ni reconstruire. En dehors de l'amande de l'œil, rien : la peau du
   visage, dessous, reprend la main. */
const FS_PERSO = `#version 300 es
precision highp float;
in vec3 vPos; in vec3 vNrm; in vec2 vUV; in vec4 vCol;
uniform sampler2D uTex;
uniform vec3 uTeinte;
uniform float uPlat, uCleK, uRim, uSpec, uMode, uAlpha;
uniform vec3 uIris; uniform vec2 uRegard; uniform float uCligne, uOeilH, uOeilInc, uLiner, uCote;
uniform vec3 uLinerC;
${GLSL_LUMIERE}
out vec4 oC;
vec4 oeil(vec2 uv){
  // l'amande : paupière du haut en arc, celle du bas plus plate ; inclinaison vers l'extérieur
  float x = uv.x * 2.0 - 1.0;                       // -1 coin intérieur, 1 coin extérieur
  float y = (uv.y - 0.5) * 2.0 - x * uOeilInc;       // l'œil monte vers l'extérieur (ou descend)
  float ar = 1.0 - x * x;
  float haut = uOeilH * pow(max(ar, 0.0), 0.62) * (1.0 - uCligne) - uCligne * 0.02;
  float bas = -uOeilH * 0.62 * pow(max(ar, 0.0), 0.75);
  float bord = 0.035;
  if (y > haut + bord * 2.2 || y < bas - bord || abs(x) > 1.0) discard;
  vec3 peau = uTeinte;
  // le trait de la paupière du haut (cils, et le liner s'il y en a)
  float trait = smoothstep(bord * (1.9 + uLiner * 1.6), 0.0, abs(y - haut - bord * 0.5));
  // le liner qui s'étire en pointe au coin extérieur
  float pointe = uLiner * smoothstep(0.55, 1.0, x) * smoothstep(0.12, 0.0, abs(y - haut - (x - 0.55) * 0.35));
  if (y > haut) return vec4(mix(peau * 0.9, uLinerC, max(trait, pointe)), 1.0);
  if (y < bas) return vec4(mix(peau * 0.85, peau * 0.55, smoothstep(bord, 0.0, abs(y - bas))), 1.0);
  // le blanc, qui s'assombrit sous la paupière et vers les coins
  vec3 c = vec3(0.84, 0.81, 0.78) * (0.7 + 0.3 * smoothstep(-0.2, 0.9, 1.0 - abs(x))) * mix(0.62, 1.0, smoothstep(haut, haut - 0.24, y));
  vec2 q = vec2(x, y) - vec2(uRegard.x * uCote, uRegard.y) * vec2(0.42, 0.25);
  float r = length(q * vec2(1.0, 1.08));
  float ir = 0.43;
  if (r < ir){
    float k = r / ir;
    vec3 iris = uIris * (0.55 + 0.65 * (1.0 - k)) + uIris * 0.25 * sin(atan(q.y, q.x) * 11.0) * k;
    iris = mix(iris, uIris * 0.35, smoothstep(0.85, 1.0, k));           // le limbe, plus sombre
    c = mix(iris, vec3(0.02), smoothstep(0.42, 0.36, k));               // la pupille
    c *= mix(0.62, 1.0, smoothstep(haut, haut - 0.25, y));              // l'ombre de la paupière
  }
  float reflet = smoothstep(0.1, 0.05, length(q - vec2(-0.14, 0.14)));
  c = mix(c, vec3(1.0), reflet * 0.85);
  c = mix(c, uLinerC, max(trait, pointe));
  return vec4(c, 1.0);
}
void main(){
  vec4 t = uMode > 0.5 ? oeil(vUV) : texture(uTex, vUV);
  if (t.a < 0.5) discard;
  vec3 n = normalize(vNrm);
  if (uPlat > 0.5) n = normalize(cross(dFdx(vPos), dFdy(vPos)));
  else if (!gl_FrontFacing) n = -n;
  vec3 base = uMode > 0.5 ? t.rgb : t.rgb * vCol.rgb * uTeinte;
  float em = uMode > 0.5 ? 0.0 : clamp((1.0 - vCol.a) * 2.0, 0.0, 1.0);
  float spec = uSpec, rim = uRim;
  if (uMode > 0.5){ spec = 0.35; rim = 0.2; }
  vec3 c = eclairer(base, n, vPos, uCleK, rim, spec);
  oC = vec4(mix(c, base * 1.7, em) * uAlpha, uAlpha);
}`;

/* LE DÉCOR : des couleurs aux sommets et rien d'autre, des facettes plates
   partout, et le VENT. Le poids `aVent` dit combien un sommet se laisse
   emporter — nul au pied d'un palmier, entier au bout d'une palme ; la phase
   dépend de la place de l'objet, pour que deux palmiers ne dansent pas au
   même pas. L'alpha de la couleur dit ce qui BRILLE de soi-même : un néon,
   un phare, la vitre d'un hôtel au loin (1 − alpha). */
const VS_DECOR = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=3) in vec4 aCol;
layout(location=6) in float aVent;
uniform mat4 uPV, uModele; uniform float uT, uVentK;
out vec3 vPos; out vec4 vCol;
void main(){
  vec3 p = aPos;
  if (aVent > 0.0){
    float ph = uModele[3].x * 0.71 + uModele[3].z * 1.37;
    float h = aVent * uVentK;
    p.x += h * (sin(uT * 0.9 + ph) * 0.55 + sin(uT * 2.1 + ph * 1.7 + p.y) * 0.18);
    p.z += h * (cos(uT * 0.7 + ph * 0.6) * 0.35 + sin(uT * 2.6 + p.x * 3.0) * 0.08);
    p.y -= h * 0.12 * (0.5 + 0.5 * sin(uT * 0.9 + ph));
  }
  vec4 w = uModele * vec4(p, 1.0);
  vPos = w.xyz; vCol = aCol;
  gl_Position = uPV * w;
}`;
const FS_DECOR = `#version 300 es
precision highp float;
in vec3 vPos; in vec4 vCol;
uniform float uCleK;
${GLSL_LUMIERE}
out vec4 oC;
void main(){
  vec3 n = normalize(cross(dFdx(vPos), dFdy(vPos)));
  float em = 1.0 - vCol.a;
  vec3 c = eclairer(vCol.rgb, n, vPos, uCleK, 0.25, 0.0);
  c = mix(c, vCol.rgb * 1.25, em);
  oC = vec4(c, 1.0);
}`;

/* LE CIEL : un triangle qui couvre l'écran, au fond. Chaque pixel retrouve la
   direction où il regarde (l'inverse de la projection) et prend la couleur du
   ciel à cette hauteur : l'orange à l'horizon, le rose, puis le violet et la
   nuit tout en haut. Le soleil est un disque rayé de bandes horizontales dans
   sa moitié basse — le soleil des pochettes de synthwave —, et un halo. */
const VS_CIEL = `#version 300 es
uniform mat4 uInvPV; uniform vec3 uCam;
out vec3 vDir;
void main(){
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  gl_Position = vec4(p, 0.99999, 1.0);
  vec4 a = uInvPV * vec4(p, 1.0, 1.0);
  vDir = a.xyz / a.w - uCam;
}`;
const FS_CIEL = `#version 300 es
precision highp float;
in vec3 vDir;
uniform vec3 uSoleilDir, uHorizon, uRose, uMauve, uNuit;
uniform float uT;
out vec4 oC;
float bruit(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec3 d = normalize(vDir);
  float e = d.y;
  vec3 c = mix(uHorizon, uRose, smoothstep(-0.02, 0.10, e));
  c = mix(c, uMauve, smoothstep(0.08, 0.30, e));
  c = mix(c, uNuit, smoothstep(0.28, 0.75, e));
  // le soleil
  vec3 s = normalize(uSoleilDir);
  float a = acos(clamp(dot(d, s), -1.0, 1.0));
  float R = 0.085;
  float halo = exp(-a * 5.5) * 0.55 + exp(-a * 18.0) * 0.35;
  c += vec3(1.0, 0.55, 0.35) * halo * smoothstep(-0.05, 0.02, e);
  if (a < R){
    float yy = (e - s.y) / R;                         // -1 en bas du disque, 1 en haut
    vec3 sc = mix(vec3(1.0, 0.36, 0.42), vec3(1.0, 0.86, 0.38), smoothstep(-0.9, 0.8, yy));
    // les bandes : de plus en plus larges vers le bas, et qui défilent doucement vers le bas
    float bande = 1.0;
    if (yy < 0.1){ float f = fract((yy - uT * 0.02) * 5.0 * (1.2 - yy * 0.4)); bande = step(mix(0.18, 0.62, clamp(-yy, 0.0, 1.0)), f); }
    c = mix(c, sc, bande * smoothstep(R, R * 0.96, a));
  }
  // les étoiles, là-haut, qui percent à peine
  vec2 g = floor(d.xz / max(d.y, 0.05) * 90.0);
  float st = step(0.9965, bruit(g)) * smoothstep(0.35, 0.8, e) * (0.6 + 0.4 * sin(uT * 2.0 + bruit(g + 1.0) * 30.0));
  c += vec3(st);
  oC = vec4(c, 1.0);
}`;

/* LA MER : une grille dont la carte graphique soulève chaque sommet à chaque
   image (trois houles qui ne se répètent jamais ensemble), en facettes plates
   comme le reste. Sa couleur va du bleu-vert au pied de la plage au violet du
   large, et le soleil y trace son chemin de paillettes. L'écume est un liseré
   au bord, qui avance et recule. */
const VS_MER = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uPV; uniform float uT;
out vec3 vPos; out float vRive;
float houle(vec2 p, float t){
  return sin(p.x * 0.35 + t * 0.9) * 0.10 + sin(p.y * 0.52 - t * 1.3 + p.x * 0.2) * 0.07
       + sin((p.x + p.y) * 1.1 + t * 2.1) * 0.025;
}
void main(){
  vec3 p = aPos;
  float amort = smoothstep(-2.0, 12.0, -p.z + 0.0);
  p.y += houle(p.xz, uT) * mix(0.35, 1.0, amort);
  vPos = p; vRive = aPos.z;
  gl_Position = uPV * vec4(p, 1.0);
}`;
const FS_MER = `#version 300 es
precision highp float;
in vec3 vPos; in float vRive;
uniform float uT, uRiveZ;
uniform vec3 uEauPres, uEauLoin, uHorizon, uRose, uMauve;
${GLSL_LUMIERE}
out vec4 oC;
float bruit(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec3 n = normalize(cross(dFdx(vPos), dFdy(vPos)));
  vec3 v = normalize(uCam - vPos);
  float loin = smoothstep(4.0, 90.0, length(uCam.xz - vPos.xz));
  vec3 base = mix(uEauPres, uEauLoin, loin);
  vec3 c = eclairer(base, n, vPos, 0.0, 0.0, 0.0);
  // le reflet du CIEL (et non d'une couleur unie) : des facettes roses, orange et violettes, plus fort à l'horizon (Fresnel)
  vec3 r0 = reflect(-v, n); float er = max(r0.y, 0.0);
  vec3 ciel = mix(uHorizon, uRose, smoothstep(0.0, 0.12, er));
  ciel = mix(ciel, uMauve, smoothstep(0.10, 0.35, er));
  float fr = 0.1 + 0.9 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  c = mix(c, ciel, fr * 0.8);
  // le chemin du soleil : une traînée de paillettes qui clignent
  vec3 r = reflect(-v, n);
  float sp = pow(max(dot(r, uSoleil), 0.0), 60.0);
  float paillette = step(0.72, bruit(floor(vPos.xz * vec2(3.0, 1.2)) + floor(uT * 4.0)));
  c += uSoleilC * sp * (0.6 + 1.8 * paillette);
  // l'écume, au bord : une bande claire qui va et vient
  float bord = uRiveZ + sin(uT * 0.8) * 0.35 + sin(vPos.x * 0.7 + uT * 1.1) * 0.15;
  float ecume = smoothstep(-1.4, -0.1, vPos.z - bord) * (0.55 + 0.45 * step(0.45, bruit(floor(vPos.xz * 6.0))));
  c = mix(c, vec3(1.0, 0.93, 0.9) * (uCielC + uSoleilC * 0.5), clamp(ecume, 0.0, 1.0) * 0.85);
  oC = vec4(c, 1.0);
}`;

/* L'OMBRE DE CONTACT : un disque qui s'efface au bord, posé sur le sable sous
   les pieds. Sans elle, le personnage flotte. */
const VS_OMBRE = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uPV, uModele;
out vec2 vQ;
void main(){ vQ = aPos.xz; gl_Position = uPV * (uModele * vec4(aPos, 1.0)); }`;
const FS_OMBRE = `#version 300 es
precision highp float;
in vec2 vQ; uniform float uForce;
out vec4 oC;
void main(){ float r = length(vQ); float a = smoothstep(1.0, 0.15, r) * uForce; oC = vec4(0.0, 0.0, 0.0, a); }`;

function programme(vs, fs){
  const sh = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader : ' + gl.getShaderInfoLog(s) + '\n' + src.split('\n').map((l, i) => (i + 1) + ' ' + l).join('\n'));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('programme : ' + gl.getProgramInfoLog(p));
  const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++){ const a = gl.getActiveUniform(p, i); u[a.name.replace('[0]', '')] = gl.getUniformLocation(p, a.name); }
  return { p, u };
}
let PR = null;
let texBlanche = null;
function initGL(){
  if (gl) return true;
  cvGL = document.createElement('canvas');
  cvGL.width = 8; cvGL.height = 8;
  gl = cvGL.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false });
  if (!gl) return false;
  PR = {
    perso: programme(VS_PERSO, FS_PERSO),
    decor: programme(VS_DECOR, FS_DECOR),
    ciel: programme(VS_CIEL, FS_CIEL),
    mer: programme(VS_MER, FS_MER),
    ombre: programme(VS_OMBRE, FS_OMBRE),
  };
  texBlanche = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texBlanche);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
  cvGL.addEventListener('webglcontextlost', (e) => { e.preventDefault(); perdu = true; });
  cvGL.addEventListener('webglcontextrestored', () => { perdu = false; gl = null; PR = null; initGL(); vider(); });
  return true;
}
let perdu = false;
/* Un contexte rendu après une perte (la carte graphique réinitialisée, un
   onglet endormi longtemps) n'a plus rien : on oublie tout ce qui y vivait, et
   tout se reconstruit à la prochaine image. */
function vider(){
  perso = null; persoV = null; decor = null; disque = null; fbo = null; fboW = 0;
  Object.keys(grainsGL).forEach(k => { delete grainsGL[k]; });
  redessiner = true;
}

/* Une pièce à la carte graphique : un VAO, ses tampons, le nombre d'indices.
   Rien n'est gardé en double : le Maille d'origine peut être oublié. */
function versGPU(M, statique){
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = [];
  const tampon = (loc, data, taille, type, norm, entier) => {
    const b = gl.createBuffer(); buf.push(b);
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    if (entier) gl.vertexAttribIPointer(loc, taille, type, 0, 0);
    else gl.vertexAttribPointer(loc, taille, type, !!norm, 0, 0);
  };
  tampon(0, new Float32Array(M.p), 3, gl.FLOAT);
  if (!statique){
    tampon(1, new Float32Array(M.n), 3, gl.FLOAT);
    tampon(2, new Float32Array(M.uv), 2, gl.FLOAT);
  }
  tampon(3, new Uint8Array(M.c.map(v => clamp(Math.round(v * 255), 0, 255))), 4, gl.UNSIGNED_BYTE, true);
  if (!statique){
    tampon(4, new Uint8Array(M.os), 4, gl.UNSIGNED_BYTE, false, true);
    tampon(5, new Uint8Array(M.po.map(v => Math.round(v * 255))), 4, gl.UNSIGNED_BYTE, true);
  } else {
    tampon(6, new Float32Array(M.vent || new Array(M.nb).fill(0)), 1, gl.FLOAT);
  }
  const ib = gl.createBuffer(); buf.push(ib);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(M.i), gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, buf, n: M.i.length };
}
function liberer(g){
  if (!g || !gl) return;
  gl.deleteVertexArray(g.vao);
  g.buf.forEach(b => gl.deleteBuffer(b));
}
/* Une texture depuis un canvas. `brut` : au plus proche, sans lissage (les
   aplats d'une palette) ; sinon lissée, avec ses mipmaps. */
function texture(c, brut, ancienne, repete){
  const t = ancienne || gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  if (brut){
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  } else {
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repete ? gl.REPEAT : gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, repete ? gl.REPEAT : gl.CLAMP_TO_EDGE);
  return t;
}
function toile(w, h){ const c = document.createElement('canvas'); c.width = w; c.height = h || w; return c; }
function toileUnie(col){ const c = toile(4); const g = c.getContext('2d'); g.fillStyle = col; g.fillRect(0, 0, 4, 4); return c; }

/* ---------------------------------------------------------------------------
   4. LE SQUELETTE
   Trente-neuf os. Les doigts en ont deux chacun — l'annulaire et
   l'auriculaire en partagent deux, ils plient toujours ensemble — : sans cela
   un poing se ferme en pince, deux baguettes raides qui pivotent à la
   jointure. Au repos, tous les os ont l'orientation du monde : la matrice de
   peau d'un os n'est alors que sa pose moins sa position de repos, et une
   rotation d'animation se lit dans les axes de la scène.
   --------------------------------------------------------------------------- */
const OS_NOMS = ['racine', 'bassin', 'lombaires', 'dos', 'poitrine', 'cou', 'tete',
  'claviculeG', 'brasG', 'avantbrasG', 'mainG', 'pouceG1', 'pouceG2', 'indexG1', 'indexG2', 'majeurG1', 'majeurG2', 'annulaireG1', 'annulaireG2',
  'claviculeD', 'brasD', 'avantbrasD', 'mainD', 'pouceD1', 'pouceD2', 'indexD1', 'indexD2', 'majeurD1', 'majeurD2', 'annulaireD1', 'annulaireD2',
  'cuisseG', 'tibiaG', 'piedG', 'orteilsG', 'cuisseD', 'tibiaD', 'piedD', 'orteilsD'];
const O = {}; OS_NOMS.forEach((n, i) => { O[n] = i; });
const OS_PARENT = OS_NOMS.map(n => {
  const cote = /G\d?$/.test(n) ? 'G' : /D\d?$/.test(n) ? 'D' : '';
  const b = n.replace(/[GD](\d?)$/, '$1');
  switch (b){
    case 'racine': return -1;
    case 'bassin': return O.racine;
    case 'lombaires': return O.bassin;
    case 'dos': return O.lombaires;
    case 'poitrine': return O.dos;
    case 'cou': return O.poitrine;
    case 'tete': return O.cou;
    case 'clavicule': return O.poitrine;
    case 'bras': return O['clavicule' + cote];
    case 'avantbras': return O['bras' + cote];
    case 'main': return O['avantbras' + cote];
    case 'pouce1': case 'index1': case 'majeur1': case 'annulaire1': return O['main' + cote];
    case 'pouce2': return O['pouce' + cote + '1'];
    case 'index2': return O['index' + cote + '1'];
    case 'majeur2': return O['majeur' + cote + '1'];
    case 'annulaire2': return O['annulaire' + cote + '1'];
    case 'cuisse': return O.bassin;
    case 'tibia': return O['cuisse' + cote];
    case 'pied': return O['tibia' + cote];
    case 'orteils': return O['pied' + cote];
  }
  return 0;
});

/* ---------------------------------------------------------------------------
   5. LES MESURES
   Un seul endroit pour dire comment les réglages deviennent des centimètres.
   Tout est écrit pour un homme de 1,78 m (le repère), puis corrigé pour une
   femme, puis par chaque curseur, puis mis à l'échelle de la stature. Les
   curseurs vont de 0 à 1, 0,5 étant « comme tout le monde ».
   --------------------------------------------------------------------------- */
const k5 = (v) => (v == null ? 0.5 : v) - 0.5;
function mesures(cfg){
  const f = cfg.sexe === 'f' ? 1 : 0, B = cfg.corps || {};
  const kc = k5(B.corpulence), km = k5(B.muscle);
  const H = mix(1.78, 1.665, f) * (1 + k5(B.stature) * 0.16);
  const s = H / 1.78;
  // les jambes : plus longues ou plus courtes À TAILLE ÉGALE — le buste rend ce qu'elles prennent
  const lj = 1 + k5(B.jambes) * 0.12;
  const hanche = 0.925 * lj, tronc = (1.78 - hanche) / (1.78 - 0.925);
  const Y = (y) => (y <= 0.925 ? y * lj : hanche + (y - 0.925) * tronc);
  const hh = 0.232 * (f ? 0.955 : 1);                     // la hauteur de la tête, du menton au sommet
  const epX = mix(0.185, 0.163, f) + k5(B.carrure) * 0.034 + km * 0.012 + kc * 0.01;
  return {
    f, kc, km, H, s, lj, tronc, Y, hh,
    kCarrure: k5(B.carrure), kPoitrine: k5(B.poitrine), kTaille: k5(B.taille), kHanches: k5(B.hanches), kCou: k5(B.cou),
    // les articulations, dans le repère (homme de 1,78 m), avant l'échelle
    tete: [0, 1.78 - 0.75 * hh, -0.004],
    cou: [0, Y(1.500), -0.022],
    poitrine: [0, Y(1.330), -0.02],
    dos: [0, Y(1.200), -0.014],
    lombaires: [0, Y(1.070), -0.008],
    bassin: [0, Y(0.970), -0.006],
    clavicule: [0.024, Y(1.452), -0.004],
    epaule: [epX, Y(1.445) - kc * 0.004, -0.024],
    hancheX: mix(0.090, 0.094, f) + k5(B.hanches) * 0.012 + kc * 0.012,
    genou: Y(0.505), cheville: Y(0.085),
    genouX: mix(0.094, 0.086, f) + kc * 0.014,
    chevilleX: mix(0.100, 0.092, f),
    brasL: 0.300, avantL: 0.262,
  };
}
/* Le squelette au repos, dans le monde : la position de la tête de chaque os. */
function squelette(m){
  const s = m.s, R = new Array(OS_NOMS.length);
  const E = (p) => [p[0] * s, p[1] * s, p[2] * s];
  R[O.racine] = [0, 0, 0];
  R[O.bassin] = E(m.bassin); R[O.lombaires] = E(m.lombaires); R[O.dos] = E(m.dos);
  R[O.poitrine] = E(m.poitrine); R[O.cou] = E(m.cou); R[O.tete] = E(m.tete);
  [['G', 1], ['D', -1]].forEach(([c, sg]) => {
    const X = (p) => [p[0] * sg, p[1], p[2]];
    R[O['clavicule' + c]] = E(X(m.clavicule));
    const ep = X(m.epaule);
    // le bras pend, un peu écarté du corps ; le coude est légèrement plié vers l'avant
    const d1 = v3.norm([Math.sin(5.5 * DEG) * sg, -1, 0.005]);
    const coude = v3.madd(ep, d1, m.brasL);
    const d2 = v3.norm([Math.sin(7.5 * DEG) * sg, -1, 0.07]);
    const poignet = v3.madd(coude, d2, m.avantL);
    R[O['bras' + c]] = E(ep); R[O['avantbras' + c]] = E(coude); R[O['main' + c]] = E(poignet);
    // la main : pendante, la paume vers la cuisse, le pouce devant
    const H = mains(m, sg, poignet, d2);
    ['pouce', 'index', 'majeur', 'annulaire'].forEach(d => {
      R[O[d + c + '1']] = E(H[d][0]); R[O[d + c + '2']] = E(H[d][1]);
    });
    const hx = m.hancheX * sg;
    R[O['cuisse' + c]] = E([hx, m.Y(0.925), -0.004]);
    R[O['tibia' + c]] = E([m.genouX * sg, m.genou, 0.012]);
    R[O['pied' + c]] = E([m.chevilleX * sg, m.cheville, -0.012]);
    R[O['orteils' + c]] = E([(m.chevilleX + 0.012) * sg, 0.022, 0.118]);
  });
  return R;
}
/* Les jointures de la main, au repos : pour chaque doigt, la base et la
   phalange du milieu (repère, avant l'échelle). La main pend dans l'axe de
   l'avant-bras ; `lar` est l'axe de la largeur (vers le pouce), `pau` la
   normale de la paume (vers la cuisse). */
function reperesMain(sg, dir){
  const lar = v3.norm(v3.sub([0, 0, 1], v3.mul(dir, dir[2])));
  const pau = v3.norm(v3.cross(dir, lar)); // vers l'intérieur du corps pour la main gauche (+x) : on vérifie ci-dessous
  const dedans = v3.dot(pau, [-sg, 0, 0]) >= 0 ? pau : v3.mul(pau, -1);
  return { lar, pau: dedans };
}
const DOIGTS = {
  // décalage le long de la largeur, longueur, rayon, et angle d'écart
  index:     { w: 0.030, L: 0.074, r: 0.0092, ecart: 3 },
  majeur:    { w: 0.010, L: 0.082, r: 0.0095, ecart: 0 },
  annulaire: { w: -0.013, L: 0.076, r: 0.0090, ecart: -3, double: true },   // et l'auriculaire, collé contre
};
const PAUME_L = 0.094;
function mains(m, sg, poignet, dir){
  const { lar, pau } = reperesMain(sg, dir);
  const f = m.f ? 0.93 : 1, out = {};
  const base = v3.madd(poignet, dir, PAUME_L * f);
  Object.entries(DOIGTS).forEach(([d, D]) => {
    const b = v3.madd(v3.madd(base, lar, D.w * f), pau, 0.002);
    out[d] = [b, v3.madd(b, dir, D.L * f * 0.52)];
  });
  // le pouce part du bas de la paume, côté largeur, et s'écarte vers l'avant et la paume
  const pb = v3.madd(v3.madd(v3.madd(poignet, dir, 0.026 * f), lar, 0.028 * f), pau, 0.006);
  const pd = v3.norm(v3.add(v3.add(v3.mul(dir, 0.72), v3.mul(lar, 0.62)), v3.mul(pau, 0.28)));
  out.pouce = [pb, v3.madd(pb, pd, 0.036 * f)];
  out.pouceDir = pd;
  return out;
}

/* ---------------------------------------------------------------------------
   6. LES TUBES
   Tout le corps, et tout ce qu'on lui met, est fait d'ANNEAUX cousus bout à
   bout. Un anneau a un centre, une direction (la tangente : l'os qu'il
   entoure), un devant, une demi-largeur `rs`, une profondeur devant `rf` et
   derrière `rb`, et un exposant `n` — la superellipse : 2 fait un ovale, 3 un
   coussin presque carré (un torse), 1,6 une amande (un menton).
   Chaque anneau a K + 1 sommets : le premier et le dernier sont au même
   endroit, dans le dos, là où la texture fait sa couture ; leurs normales
   sont ensuite soudées pour que la couture ne se voie pas.
   --------------------------------------------------------------------------- */
function repere(t, avant){
  const f = v3.norm(v3.sub(avant, v3.mul(t, v3.dot(avant, t))));
  return { f, s: v3.norm(v3.cross(f, t)) };
}
/* Le point d'un anneau à l'angle th (0 devant, ±π derrière), dans son plan.
   Rend [x, z] : x le long de s, z le long de f. */
function superE(r, th){
  const sn = Math.sin(th), cs = Math.cos(th), e = 2 / (r.n || 2);
  const x = r.rs * Math.sign(sn) * Math.pow(Math.abs(sn), e);
  const z = (cs >= 0 ? r.rf : r.rb) * Math.sign(cs) * Math.pow(Math.abs(cs), e);
  return [x, z];
}
/* `anneaux` : [{ c, t, avant, rs, rf, rb, n, ... }] ; `o` :
     K        — sommets par anneau (sans le doublon de la couture)
     angles   — facultatif : les K + 1 angles (sinon réguliers, de −π à π)
     point(r, th, x, z, P) — facultatif : corrige le point P (bosses, creux)
     os(r, th, P), coul(r, th, P), uv(r, j, th, i)
     debut / fin : 'ferme' pour un couvercle, sinon ouvert
   Rend les indices des anneaux, pour qui voudrait y accrocher autre chose. */
function tuyau(M, anneaux, o){
  const K = o.K, idx = [];
  const angles = o.angles || Array.from({ length: K + 1 }, (_, j) => -PI + TAU * j / K);
  const pts = anneaux.map((r, i) => {
    const R = repere(r.t, r.avant || [0, 0, 1]);
    r._f = R.f; r._s = R.s;
    return angles.map((th, j) => {
      const [x, z] = superE(r, th);
      let P = v3.add(v3.add(r.c, v3.mul(R.s, x)), v3.mul(R.f, z));
      if (o.point) P = o.point(r, th, x, z, P, j) || P;
      return P;
    });
  });
  // le sens des triangles : vers le dehors, quel que soit le sens de l'anneau
  let inverse = false;
  if (anneaux.length > 1){
    const a = pts[0][1], b = pts[1][1], c = pts[1][2];
    const n = v3.cross(v3.sub(b, a), v3.sub(c, a));
    inverse = v3.dot(n, v3.sub(a, anneaux[0].c)) < 0;
  }
  anneaux.forEach((r, i) => {
    const a0 = M.nb;
    idx.push(a0);
    pts[i].forEach((P, j) => {
      const th = angles[j];
      M.sommet(P, o.uv ? o.uv(r, j, th, i) : [j / K, i / Math.max(1, anneaux.length - 1)],
        o.coul ? o.coul(r, th, P) : r.coul, o.os ? o.os(r, th, P) : r.os);
    });
    if (i > 0) coudre(M, idx[i - 1], a0, K + 1, false, inverse);
  });
  const bout = (i, dir, quoi) => {
    if (quoi !== 'ferme') return;
    const r = anneaux[i];
    const cen = o.pointe && o.pointe[i === 0 ? 0 : 1] ? o.pointe[i === 0 ? 0 : 1] : r.c;
    // le sens du couvercle : sa normale doit suivre `dir`
    const a = pts[i][0], b = pts[i][1];
    const n = v3.cross(v3.sub(b, a), v3.sub(cen, a));
    couvercle(M, idx[i], K, cen, o.uv ? o.uv(r, 0, 0, i) : [0.5, i ? 1 : 0], o.coul ? o.coul(r, 0, cen) : r.coul,
      o.os ? o.os(r, 0, cen) : r.os, v3.dot(n, dir) < 0);
  };
  if (anneaux.length){
    bout(0, v3.mul(anneaux[0].t, -1), o.debut);
    bout(anneaux.length - 1, anneaux[anneaux.length - 1].t, o.fin);
  }
  (M.coutures || (M.coutures = [])).push(...idx.map(a => [a, a + K]));
  return { idx, K };
}
/* Soude les normales des coutures : le premier et le dernier sommet de chaque
   anneau reçoivent la moyenne des deux. À appeler après `normales()`. */
function souder(M){
  const N = M.n;
  (M.coutures || []).forEach(([a, b]) => {
    const i = a * 3, j = b * 3;
    const x = N[i] + N[j], y = N[i + 1] + N[j + 1], z = N[i + 2] + N[j + 2], l = Math.hypot(x, y, z) || 1;
    N[i] = N[j] = x / l; N[i + 1] = N[j + 1] = y / l; N[i + 2] = N[j + 2] = z / l;
  });
  return M;
}
/* Une table de profils, interpolée en douceur (Catmull-Rom) sur sa première
   colonne. Les tables du corps sont écrites en quelques anneaux-clés ; le
   maillage, lui, en prend autant qu'il en faut. */
function lireTable(T, x, col){
  if (x <= T[0][0]) return T[0][col];
  const n = T.length;
  if (x >= T[n - 1][0]) return T[n - 1][col];
  let i = 0; while (i < n - 2 && T[i + 1][0] < x) i++;
  const p0 = T[Math.max(0, i - 1)], p1 = T[i], p2 = T[i + 1], p3 = T[Math.min(n - 1, i + 2)];
  const t = (x - p1[0]) / (p2[0] - p1[0]);
  // Catmull-Rom non uniforme, ramené à des pentes simples : suffisant et sans dépassement notable
  const m1 = (p2[col] - p0[col]) / ((p2[0] - p0[0]) || 1) * (p2[0] - p1[0]);
  const m2 = (p3[col] - p1[col]) / ((p3[0] - p1[0]) || 1) * (p2[0] - p1[0]);
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * p1[col] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[col] + (t3 - t2) * m2;
}
/* Un mélange de deux os le long d'une chaîne : `d` est la distance signée
   passé la jointure (négative avant) ; la peau passe d'un os à l'autre sur
   ±`l` mètres. C'est ce qui fait qu'un coude plié s'arrondit au lieu de se
   casser en deux cylindres. */
const jointure = (a, b, d, l) => { const w = lisse(-l, l, d); return [[a, 1 - w], [b, w]]; };

/* ---------------------------------------------------------------------------
   7. LE CORPS
   --------------------------------------------------------------------------- */
/* LE TRONC, du bas-ventre au haut du cou, en anneaux-clés relevés sur un homme
   de 1,78 m : [hauteur, demi-largeur, devant, derrière, décalage avant du
   centre, exposant]. L'épaule est plus large que tout le reste — c'est le
   haut du deltoïde, que le bras vient compléter ; le trapèze redescend en
   pente douce jusqu'au cou. */
const TRONC = [
  [0.790, 0.052, 0.046, 0.050, -0.006, 2.2],
  [0.830, 0.122, 0.070, 0.080, -0.006, 2.4],
  [0.878, 0.164, 0.087, 0.099, -0.010, 2.6],
  [0.935, 0.170, 0.093, 0.097, -0.006, 2.8],
  [0.995, 0.160, 0.096, 0.088,  0.000, 2.8],
  [1.055, 0.147, 0.099, 0.084,  0.004, 2.6],
  [1.120, 0.148, 0.101, 0.085,  0.004, 2.6],
  [1.190, 0.155, 0.104, 0.089,  0.000, 2.6],
  [1.255, 0.163, 0.108, 0.094, -0.005, 2.7],
  [1.310, 0.169, 0.110, 0.097, -0.010, 2.8],
  [1.360, 0.176, 0.104, 0.099, -0.013, 2.9],
  [1.405, 0.186, 0.090, 0.095, -0.016, 3.1],
  [1.438, 0.178, 0.075, 0.082, -0.019, 3.3],
  [1.460, 0.142, 0.065, 0.071, -0.021, 2.8],
  [1.480, 0.074, 0.057, 0.061, -0.022, 2.2],
  [1.520, 0.062, 0.054, 0.058, -0.016, 2.0],
  [1.575, 0.059, 0.051, 0.056, -0.008, 2.0],
  [1.625, 0.050, 0.044, 0.050, -0.003, 2.0],
];
/* Les hauteurs où l'on pose un anneau : serrées là où la forme change vite
   (la poitrine, les épaules, le haut du cou), lâches ailleurs. */
const TRONC_Y = [0.790, 0.808, 0.830, 0.855, 0.878, 0.905, 0.935, 0.965, 0.995, 1.025, 1.055, 1.088, 1.120, 1.155, 1.190,
  1.215, 1.238, 1.258, 1.278, 1.298, 1.318, 1.340, 1.362, 1.385, 1.405, 1.422, 1.438, 1.450, 1.460, 1.470, 1.480, 1.500, 1.525, 1.550, 1.575, 1.600, 1.625];
/* Les réglages n'agissent pas partout : chacun a sa zone, une cloche sur la
   hauteur du tronc. */
const zone = {
  taille: y => cloche(y - 1.085, 0.075), hanches: y => cloche(y - 0.93, 0.06), fesses: y => cloche(y - 0.88, 0.05),
  poitrine: y => cloche(y - 1.29, 0.065), epaule: y => cloche(y - 1.415, 0.04), trapeze: y => cloche(y - 1.462, 0.02),
  cou: y => lisse(1.47, 1.50, y), ventre: y => cloche(y - 1.03, 0.085),
};
function anneauTronc(m, y){
  const Z = {}; Object.keys(zone).forEach(k => { Z[k] = zone[k](y); });
  const f = m.f, kc = m.kc, km = m.km;
  let rs = lireTable(TRONC, y, 1), rf = lireTable(TRONC, y, 2), rb = lireTable(TRONC, y, 3);
  const zc = lireTable(TRONC, y, 4), n = lireTable(TRONC, y, 5);
  // la femme : épaules et taille plus étroites, bassin plus large, cou plus fin
  rs += f * (-0.017 * Z.epaule - 0.012 * Z.poitrine - 0.024 * Z.taille + 0.011 * Z.hanches + 0.013 * Z.fesses - 0.010 * Z.cou - 0.016 * Z.trapeze);
  rf += f * (-0.010 * Z.taille - 0.009 * Z.cou - 0.004 * Z.poitrine);
  rb += f * (0.012 * Z.fesses - 0.009 * Z.cou - 0.004 * Z.epaule);
  rs *= 1 + kc * (0.34 * Z.taille + 0.24 * Z.hanches + 0.16 * Z.poitrine + 0.08 + 0.1 * Z.cou)
         + km * (0.09 * Z.poitrine + 0.12 * Z.epaule + 0.30 * Z.trapeze - 0.04 * Z.taille)
         + m.kCarrure * (0.17 * Z.epaule + 0.14 * Z.trapeze + 0.07 * Z.poitrine)
         + m.kTaille * 0.24 * Z.taille + m.kHanches * 0.2 * Math.max(Z.hanches, Z.fesses) + m.kCou * 0.34 * Z.cou;
  rf *= 1 + kc * (0.34 * Z.ventre + 0.14) + km * (0.10 * Z.poitrine + 0.12 * Z.cou) + m.kCou * 0.3 * Z.cou;
  rb *= 1 + kc * 0.18 + km * (0.08 * (Z.epaule + Z.poitrine) + 0.14 * Z.cou) + m.kCou * 0.3 * Z.cou;
  return { y, rs, rf, rb, zc, n };
}
/* Les bosses du tronc, dans le repère (mètres de l'homme de 1,78 m, avant
   l'échelle) : la poitrine, les pectoraux, le ventre, les fessiers, les
   omoplates, le sillon du dos. Chacune est une cloche en largeur et en
   hauteur, parfois plus raide d'un côté — le dessous d'un sein, le bas d'un
   pectoral sont des bords, pas des pentes. */
function bossesTronc(m, cfg){
  const B = cfg.corps || {}, f = m.f, kc = m.kc, km = m.km;
  const p = B.poitrine == null ? 0.5 : B.poitrine;
  const sein = f ? mix(0.022, 0.082, p) + Math.max(0, kc) * 0.03 : 0;
  const pec = f ? 0 : 0.005 + 0.024 * (km + 0.5) + 0.01 * m.kPoitrine + Math.max(0, kc) * 0.022;
  const ventre = Math.max(0, kc) * 0.095 * (1 - 0.3 * f) - Math.max(0, km) * 0.006;
  const fesse = 0.016 + f * 0.017 + Math.max(0, kc) * 0.022 + km * 0.008 + m.kHanches * 0.012;
  const omo = 0.005 + Math.max(0, km) * 0.012;
  return (x, y, z) => {
    const ax = Math.abs(x);
    let dz = 0, dx = 0;
    if (z > 0){
      if (sein){
        const by = 1.268 - sein * 0.35, sy = y < by ? 0.030 + sein * 0.18 : 0.068;
        const g = sein * cloche(ax - (0.080 + sein * 0.08), 0.050 + sein * 0.22) * cloche(y - by, sy);
        dz += g; dx += Math.sign(x) * g * 0.22 * lisse(0.06, 0.13, ax);
      }
      if (pec) dz += pec * cloche(ax - 0.074, 0.058) * cloche(y - 1.318, y < 1.318 ? 0.020 : 0.05);
      if (ventre) dz += ventre * cloche(x, 0.10 + ventre * 0.5) * cloche(y - 1.02, 0.075 + ventre * 0.3);
      // le creux du nombril et de la ligne blanche, à peine
      dz -= 0.0025 * cloche(x, 0.008) * lisse(0.97, 1.02, y) * lisse(1.26, 1.18, y);
    } else {
      dz -= fesse * cloche(ax - 0.066, 0.055) * cloche(y - 0.888, y < 0.888 ? 0.034 : 0.055);
      dz -= omo * cloche(ax - 0.085, 0.042) * cloche(y - 1.345, 0.05);
      dz += 0.0065 * (1 - Math.max(0, kc) * 1.4) * cloche(x, 0.013) * lisse(0.97, 1.05, y) * lisse(1.45, 1.38, y);
    }
    return [dx, dz];
  };
}
/* La peau du tronc, sommet par sommet : le long de la colonne, d'une vertèbre
   à l'autre ; aux épaules, la clavicule prend le côté ; au bas-ventre, la
   cuisse emporte un peu le fessier, sans quoi il resterait en place quand la
   jambe part en avant. */
const CHAINE_TRONC = [['bassin', 0.93], ['lombaires', 1.07], ['dos', 1.20], ['poitrine', 1.33], ['cou', 1.50], ['tete', 1.62]];
function poidsTronc(y, x){
  let os = [[O.bassin, 1]];
  for (let i = 0; i < CHAINE_TRONC.length - 1; i++){
    const [a, ya] = CHAINE_TRONC[i], [b, yb] = CHAINE_TRONC[i + 1];
    if (y >= ya && y < yb){ const w = lisse(ya, yb, y); os = [[O[a], 1 - w], [O[b], w]]; break; }
    if (y >= yb && i === CHAINE_TRONC.length - 2) os = [[O[b], 1]];
  }
  const ax = Math.abs(x), c = x >= 0 ? 'G' : 'D';
  const wc = lisse(0.085, 0.165, ax) * lisse(1.35, 1.42, y) * lisse(1.50, 1.47, y) * 0.65;
  if (wc > 0) os = os.map(o => [o[0], o[1] * (1 - wc)]).concat([[O['clavicule' + c], wc]]);
  const wj = lisse(0.95, 0.83, y) * lisse(0.035, 0.11, ax) * 0.55;
  if (wj > 0) os = os.map(o => [o[0], o[1] * (1 - wj)]).concat([[O['cuisse' + c], wj]]);
  return os;
}

/* LES JAMBES : la cuisse de la hanche au genou, le tibia du genou à la
   cheville, en fractions de la longueur de l'os. [t, demi-largeur, devant,
   derrière]. La rotule avance au genou, le mollet gonfle derrière. */
const CUISSE = [
  [-0.16, 0.058, 0.058, 0.064], [0.00, 0.086, 0.084, 0.092], [0.16, 0.084, 0.080, 0.087], [0.34, 0.077, 0.074, 0.077],
  [0.52, 0.069, 0.067, 0.066], [0.70, 0.060, 0.060, 0.056], [0.84, 0.053, 0.056, 0.051], [0.93, 0.050, 0.056, 0.049], [1.00, 0.049, 0.052, 0.049],
];
const TIBIA = [
  [0.00, 0.049, 0.049, 0.049], [0.07, 0.048, 0.045, 0.053], [0.20, 0.049, 0.043, 0.061], [0.32, 0.048, 0.041, 0.060],
  [0.48, 0.042, 0.037, 0.050], [0.66, 0.035, 0.033, 0.038], [0.84, 0.030, 0.030, 0.031], [0.96, 0.030, 0.032, 0.033], [1.06, 0.029, 0.031, 0.031],
];
/* LES BRAS : le deltoïde commence AU-DESSUS de l'épaule (t négatif), dans le
   tronc, pour que l'épaule reste ronde quand le bras se lève. */
const BRAS = [
  [-0.062, 0.020, 0.020, 0.022], [-0.036, 0.042, 0.042, 0.044], [-0.005, 0.055, 0.054, 0.058], [0.08, 0.057, 0.055, 0.058],
  [0.30, 0.049, 0.050, 0.051], [0.52, 0.044, 0.049, 0.046], [0.74, 0.041, 0.043, 0.043], [0.92, 0.038, 0.038, 0.040], [1.00, 0.037, 0.037, 0.040],
];
const AVANT = [
  [0.00, 0.038, 0.038, 0.040], [0.08, 0.041, 0.041, 0.041], [0.24, 0.042, 0.041, 0.039], [0.46, 0.036, 0.033, 0.033],
  [0.70, 0.030, 0.026, 0.026], [0.90, 0.027, 0.021, 0.021], [1.00, 0.026, 0.020, 0.020], [1.07, 0.025, 0.019, 0.019],
];
/* UN MEMBRE D'UN SEUL TENANT : la cuisse et le tibia (ou le bras et
   l'avant-bras) sont UN tube qui suit les deux os, et non deux tubes
   bout à bout — deux tubes laissaient au genou un anneau visible, et se
   séparaient dès qu'il pliait. Ici l'anneau du genou appartient aux deux os
   à la fois, et la tangente tourne en douceur de l'un à l'autre.
   `seg` : [{ a, b, table, os, k(t), kf(t), kb(t), ts }] — deux segments ;
   `o.haut` : l'os au-dessus du premier (le bassin, la clavicule) ;
   `o.bas` : l'os au-delà du dernier (le pied, la main). */
function chaine(M, m, seg, o){
  const { anneaux, L } = anneauxChaine(m, seg, o);
  const tot = L[0] + L[1];
  return tuyau(M, anneaux, { K: o.K || 14, debut: o.debut, fin: o.fin,
    os: (r) => poidsChaine(seg, o, L, r.d),
    coul: o.coul });
}
// la peau d'un membre, à la distance d le long de la chaîne (voir chaine)
function poidsChaine(seg, o, L, d){
  const tot = L[0] + L[1];
  let l = jointure(seg[0].os, seg[1].os, d - L[0], o.souple || 0.05);
  if (o.haut != null && d < 0.05) l = jointure(o.haut, seg[0].os, d, 0.045);
  if (o.bas != null && d > tot - 0.05) l = jointure(seg[1].os, o.bas, d - tot, 0.035);
  return l;
}
/* Les anneaux d'une chaîne, sans les coudre : le corps les coud tels quels,
   les vêtements les regonflent d'abord (voir habitMembre). */
function anneauxChaine(m, seg, o){
  const s = m.s, L = seg.map(g => v3.len(v3.sub(g.b, g.a))), dir = seg.map(g => v3.norm(v3.sub(g.b, g.a)));
  const anneaux = [];
  seg.forEach((g, i) => {
    const ts = (g.ts || g.table.map(r => r[0])).filter(t => i === 0 ? t < 0.985 : t > 0.015 || (i === 1 && t === 0));
    ts.forEach(t => {
      if (i === 1 && t === 0) return;
      const d = (i ? L[0] : 0) + t * L[i];
      anneaux.push({ i, t, d, rs: lireTable(g.table, t, 1) * s * (g.k ? g.k(t) : 1),
        rf: lireTable(g.table, t, 2) * s * (g.k ? g.k(t) : 1) * (g.kf ? g.kf(t) : 1),
        rb: lireTable(g.table, t, 3) * s * (g.k ? g.k(t) : 1) * (g.kb ? g.kb(t) : 1) });
    });
    if (i === 0){
      // l'anneau de la jointure, moyenne des deux profils
      const g2 = seg[1], k0 = g.k ? g.k(1) : 1, k1 = g2.k ? g2.k(0) : 1;
      anneaux.push({ i: 0, t: 1, d: L[0], jointure: true,
        rs: (lireTable(g.table, 1, 1) * k0 + lireTable(g2.table, 0, 1) * k1) / 2 * s,
        rf: (lireTable(g.table, 1, 2) * k0 + lireTable(g2.table, 0, 2) * k1) / 2 * s,
        rb: (lireTable(g.table, 1, 3) * k0 + lireTable(g2.table, 0, 3) * k1) / 2 * s });
    }
  });
  anneaux.forEach(r => {
    const w = lisse(-0.07, 0.07, r.d - L[0]);
    r.t3 = v3.norm(v3.lerp(dir[0], dir[1], w));
    r.c = r.i === 0 ? v3.madd(seg[0].a, dir[0], r.t * L[0]) : v3.madd(seg[1].a, dir[1], r.t * L[1]);
    r.n = o.n || 2.2; r.avant = o.avant || [0, 0, 1];
    r.tt = r.d / (L[0] + L[1]);
  });
  anneaux.forEach(r => { r.t = r.t3; });
  return { anneaux, L, dir };
}
/* Les deux chaînes du corps, décrites une seule fois : le corps les coud, les
   vêtements les suivent (les mêmes anneaux, regonflés). */
function segJambe(m, R, c){
  const kc = m.kc, km = m.km, f = m.f;
  return [
    { a: R[O['cuisse' + c]], b: R[O['tibia' + c]], table: CUISSE, os: O['cuisse' + c],
      k: (t) => 1 + kc * 0.32 * lisse(1.0, 0.2, t) + km * 0.13 + f * 0.07 * lisse(0.9, 0.1, t) + m.kHanches * 0.05,
      kb: (t) => 1 + f * 0.04 },
    { a: R[O['tibia' + c]], b: R[O['pied' + c]], table: TIBIA, os: O['tibia' + c],
      k: (t) => 1 + kc * 0.2 + km * 0.12 * cloche(t - 0.25, 0.2) - f * 0.03 },
  ];
}
function segBras(m, R, c){
  const kc = m.kc, km = m.km, f = m.f;
  return [
    { a: R[O['bras' + c]], b: R[O['avantbras' + c]], table: BRAS, os: O['bras' + c],
      k: (t) => 1 + kc * 0.3 + km * (0.2 * cloche(t - 0.45, 0.3) + 0.12 * cloche(t + 0.05, 0.12)) - f * 0.1 + m.kCarrure * 0.04 * lisse(0.2, -0.1, t) },
    { a: R[O['avantbras' + c]], b: R[O['main' + c]], table: AVANT, os: O['avantbras' + c],
      k: (t) => 1 + kc * 0.22 + km * 0.14 * cloche(t - 0.2, 0.25) - f * 0.1 },
  ];
}
const OPT_JAMBE = (c) => ({ K: 16, haut: O.bassin, bas: O['pied' + c], debut: 'ferme', fin: 'ferme' });
const OPT_BRAS = (c) => ({ K: 14, haut: O['clavicule' + c], bas: O['main' + c], debut: 'ferme', fin: 'ferme', n: 2.1, souple: 0.045 });
function membre(M, cfg, m, R, table, a, b, osA, osB, o){
  const s = m.s, L = v3.len(v3.sub(b, a)), t = v3.norm(v3.sub(b, a));
  const ts = o.ts || table.map(r => r[0]);
  const anneaux = ts.map(tt => {
    const k = o.k ? o.k(tt) : 1;
    return { t, avant: o.avant || [0, 0, 1], c: v3.madd(a, t, tt * L), n: o.n || 2.2, tt,
      rs: lireTable(table, tt, 1) * s * k, rf: lireTable(table, tt, 2) * s * k * (o.kf ? o.kf(tt) : 1), rb: lireTable(table, tt, 3) * s * k * (o.kb ? o.kb(tt) : 1) };
  });
  return tuyau(M, anneaux, { K: o.K || 14, debut: o.debut, fin: o.fin,
    os: o.os || ((r) => {
      // avant la jointure du haut : l'os du dessus ; passé la jointure du bas : l'os du dessous
      const d0 = r.tt * L;
      let l = [[osA, 1]];
      if (o.haut != null && d0 < 0.05) l = jointure(o.haut, osA, d0, 0.045);
      if (osB != null){ const d1 = (r.tt - 1) * L; if (d1 > -0.06) l = jointure(osA, osB, d1, 0.05); }
      return l;
    }),
    coul: o.coul });
}

/* LA MAIN : une paume en coussin, quatre doigts de deux phalanges (l'annulaire
   et l'auriculaire côte à côte), le pouce. Dix sommets autour d'un doigt,
   c'est trois fois moins qu'une vraie main de jeu et pourtant elle se lit —
   à la taille où on la voit, c'est la SILHOUETTE des doigts qui compte. */
function main(M, cfg, m, R, sg){
  const c = sg > 0 ? 'G' : 'D', s = m.s, f = m.f ? 0.93 : 1;
  const w0 = R[O['main' + c]], coude = R[O['avantbras' + c]];
  const dir = v3.norm(v3.sub(w0, coude));
  const { lar, pau } = reperesMain(sg, dir);
  const hs = s * f;
  // la paume : un coussin plat, plus large aux jointures qu'au poignet
  const PAUME = [[0.00, 0.026, 0.013, 0.013], [0.03, 0.036, 0.015, 0.014], [0.065, 0.042, 0.014, 0.013], [0.090, 0.043, 0.012, 0.011], [0.100, 0.040, 0.010, 0.010]];
  const ann = PAUME.map(([d, w, e1, e2]) => ({ t: dir, avant: pau, c: v3.madd(v3.madd(w0, dir, d * hs), lar, 0.004 * hs), rs: w * hs, rf: e1 * hs * (1 + m.kc * 0.3), rb: e2 * hs * (1 + m.kc * 0.3), n: 2.8, d }));
  tuyau(M, ann, { K: 10, debut: 'ferme', fin: 'ferme', os: (r) => [[O['main' + c], 1]] });
  const doigt = (nom, base, mil, dirD, L, r0) => {
    const o1 = O[nom + c + '1'], o2 = O[nom + c + '2'];
    const pts = [0, 0.18, 0.5, 0.58, 0.82, 1.0];
    const an = pts.map(u => ({ t: dirD, avant: v3.mul(pau, -1), c: v3.madd(base, dirD, u * L), rs: r0 * (1 - u * 0.22), rf: r0 * (1 - u * 0.25), rb: r0 * (1 - u * 0.18), n: 2.2, u }));
    tuyau(M, an, { K: 6, debut: 'ferme', fin: 'ferme', pointe: [null, v3.madd(base, dirD, L + r0 * 0.7)],
      os: (r) => { const d = (r.u - 0.54) * L; return jointure(o1, o2, d, 0.008); } });
  };
  Object.entries(DOIGTS).forEach(([nom, D]) => {
    const b = R[O[nom + c + '1']], mi = R[O[nom + c + '2']];
    const L = D.L * hs, r0 = D.r * hs * (1 + m.kc * 0.25);
    const dd = v3.norm(v3.add(dir, v3.mul(lar, D.ecart * DEG)));
    doigt(nom, b, mi, dd, L, r0);
    if (D.double){   // l'auriculaire, collé contre l'annulaire, plus court
      const b2 = v3.madd(b, lar, -0.019 * hs), dd2 = v3.norm(v3.add(dir, v3.mul(lar, -8 * DEG)));
      doigt(nom, v3.madd(b2, dir, -0.006 * hs), null, dd2, L * 0.8, r0 * 0.88);
    }
  });
  const H = mains(m, sg, [0, 0, 0], dir);
  doigt('pouce', R[O['pouce' + c + '1']], R[O['pouce' + c + '2']], H.pouceDir, 0.064 * hs, 0.0115 * hs * (1 + m.kc * 0.25));
}

/* LE PIED, nu : un coussin allongé du talon aux orteils, à plat dessous. On le
   voit rarement — des chaussures le remplacent presque toujours — mais une
   paire de tongs le montre en entier. */
function pied(M, cfg, m, R, sg){
  const c = sg > 0 ? 'G' : 'D', s = m.s;
  const ch = R[O['pied' + c]];
  const PIED = [
    // z (depuis la cheville), demi-largeur, dessus, dessous
    [-0.058, 0.020, 0.030, 0.000], [-0.050, 0.030, 0.052, 0.000], [-0.030, 0.036, 0.070, 0.000], [0.000, 0.039, 0.075, 0.000],
    [0.040, 0.043, 0.058, 0.000], [0.085, 0.047, 0.044, 0.000], [0.125, 0.049, 0.033, 0.000], [0.160, 0.046, 0.026, 0.000],
    [0.185, 0.037, 0.021, 0.000], [0.198, 0.022, 0.015, 0.000],
  ];
  const sol = 0.002;
  const ann = PIED.map(([z, w, h]) => {
    const y0 = sol + h * s / 2;
    return { t: [0, 0, 1], avant: [0, 1, 0], c: [ch[0] + sg * 0.004 * s * (z > 0.1 ? 1 : 0), y0, ch[2] + z * s], rs: w * s, rf: h * s / 2, rb: h * s / 2 * 0.98, n: 2.6, z };
  });
  tuyau(M, ann, { K: 10, debut: 'ferme', fin: 'ferme',
    point: (r, th, x, z, P) => [P[0], Math.max(sol, P[1]), P[2]],
    os: (r) => r.z < 0.1 ? [[O['pied' + c], 1]] : jointure(O['pied' + c], O['orteils' + c], (r.z - 0.125) * s, 0.02) });
}

/* L'OREILLE : un pavillon ovale incliné vers l'arrière, creusé au milieu. */
function oreille(M, os, centre, sx, h, l, ep, coul){
  const K = 9, bord = [], creux = [], dos = [];
  for (let j = 0; j < K; j++){
    const a = j / K * TAU;
    const y = Math.cos(a) * h, z = Math.sin(a) * l * (Math.cos(a) > 0 ? 1 : 0.85);
    const incl = -14 * DEG, yy = y * Math.cos(incl) - z * Math.sin(incl), zz = y * Math.sin(incl) + z * Math.cos(incl);
    bord.push([centre[0] + sx * ep, centre[1] + yy, centre[2] + zz]);
    creux.push([centre[0] + sx * ep * 0.45, centre[1] + yy * 0.58 - h * 0.05, centre[2] + zz * 0.55]);
    dos.push([centre[0] - sx * ep * 0.5, centre[1] + yy * 0.8, centre[2] + zz * 0.8]);
  }
  const ib = bord.map(p => M.sommet(p, null, coul, os));
  const ic = creux.map(p => M.sommet(p, null, assombrir4(coul, 0.72), os));
  const id = dos.map(p => M.sommet(p, null, coul, os));
  const fond = M.sommet([centre[0] + sx * ep * 0.2, centre[1] - h * 0.05, centre[2]], null, assombrir4(coul, 0.6), os);
  const inv = sx < 0;
  for (let j = 0; j < K; j++){
    const j2 = (j + 1) % K;
    if (!inv){ M.quad(ib[j], ib[j2], ic[j2], ic[j]); M.tri(ic[j], ic[j2], fond); M.quad(id[j], id[j2], ib[j2], ib[j]); }
    else { M.quad(ib[j], ic[j], ic[j2], ib[j2]); M.tri(ic[j], fond, ic[j2]); M.quad(id[j], ib[j], ib[j2], id[j2]); }
  }
}
const assombrir4 = (c, k) => [c[0] * k, c[1] * k, c[2] * k, c[3] == null ? 1 : c[3]];

/* Le corps entier, en un seul maillage — la peau est une seule matière, la
   teinte est un uniforme (voir uTeinte) : changer de couleur de peau ne
   reconstruit rien. Les couleurs aux sommets ne portent que les ombres :
   l'aisselle, l'entrejambe, le creux du genou. */
function construireCorps(cfg, m, R, cache){
  const M = new Maille(), s = m.s;
  const bosse = bossesTronc(m, cfg);
  // 1. le tronc et le cou
  const anneaux = TRONC_Y.map(yr => {
    const a = anneauTronc(m, yr);
    return { t: [0, 1, 0], avant: [0, 0, 1], c: [0, m.Y(yr) * s, a.zc * s], rs: a.rs * s, rf: a.rf * s, rb: a.rb * s, n: a.n, yr };
  });
  const tr = tuyau(M, anneaux, { K: 32, debut: 'ferme', fin: 'ferme',
    point: (r, th, x, z, P) => {
      // x, z sont dans le plan de l'anneau, s est tourné vers −x : on revient au repère
      const X = P[0] / s, Z = P[2] / s - r.c[2] / s;
      const [dx, dz] = bosse(X, r.yr, Z);
      return [P[0] + dx * s, P[1], P[2] + dz * s];
    },
    os: (r, th, P) => poidsTronc(r.yr, P[0] / s),
    coul: (r, th, P) => {
      const ax = Math.abs(P[0] / s);
      const aisselle = lisse(0.13, 0.17, ax) * cloche(r.yr - 1.37, 0.03) * 0.18;
      const entre = lisse(0.87, 0.80, r.yr) * 0.2;
      const k = 1 - aisselle - entre;
      return [k, k, k, 1];
    } });
  // 2. les jambes et les bras, de chaque côté
  [1, -1].forEach(sg => {
    const c = sg > 0 ? 'G' : 'D';
    const kc = m.kc, km = m.km, f = m.f;
    if (!(cache && cache.jambes)) chaine(M, m, segJambe(m, R, c), OPT_JAMBE(c));
    chaine(M, m, segBras(m, R, c), OPT_BRAS(c));
    main(M, cfg, m, R, sg);
    if (!(cache && cache.pieds)) pied(M, cfg, m, R, sg);
  });
  M.normales();
  souder(M);
  return M;
}

/* ---------------------------------------------------------------------------
   8. LA TÊTE
   Des tranches horizontales, du haut du cou au sommet du crâne, dans un
   repère où la tête mesure 1 du menton au sommet et où z = 0 passe par
   l'oreille. Chaque tranche est une superellipse — pointue devant au niveau
   du menton, presque carrée à hauteur des yeux (un visage est plat de face,
   un crâne rond de dos) — puis on y ajoute le relief : le nez, les lèvres,
   les orbites, l'arcade, les pommettes, le menton. Tout ce qui fait un
   VISAGE est donc un réglage : on élargit une cloche, on avance une autre.
   Les angles ne sont pas réguliers : serrés devant, où se joue le visage,
   lâches derrière, où il n'y a que du crâne (voir angleTete).
   --------------------------------------------------------------------------- */
const TETE = [
  // y      devant  derrière demi-larg. exposants devant, derrière
  [-0.14, 0.100, -0.262, 0.236, 2.0, 2.0],
  [-0.07, 0.130, -0.276, 0.240, 2.0, 2.0],
  [-0.03, 0.205, -0.290, 0.248, 1.9, 2.1],
  [ 0.00, 0.365, -0.300, 0.238, 1.62, 2.1],
  [ 0.03, 0.438, -0.305, 0.252, 1.58, 2.1],
  [ 0.07, 0.458, -0.311, 0.270, 1.64, 2.1],
  [ 0.11, 0.440, -0.318, 0.270, 1.78, 2.15],
  [ 0.16, 0.450, -0.330, 0.278, 1.9, 2.2],
  [ 0.21, 0.464, -0.345, 0.285, 2.0, 2.2],
  [ 0.26, 0.470, -0.360, 0.288, 2.08, 2.25],
  [ 0.33, 0.462, -0.380, 0.292, 2.16, 2.3],
  [ 0.40, 0.452, -0.398, 0.298, 2.26, 2.3],
  [ 0.46, 0.446, -0.410, 0.302, 2.36, 2.3],
  [ 0.53, 0.466, -0.420, 0.31, 2.45, 2.3],
  [ 0.62, 0.460, -0.425, 0.322, 2.45, 2.3],
  [ 0.72, 0.428, -0.412, 0.330, 2.4, 2.3],
  [ 0.82, 0.358, -0.365, 0.304, 2.3, 2.25],
  [ 0.90, 0.268, -0.285, 0.252, 2.2, 2.2],
  [ 0.955, 0.164, -0.180, 0.170, 2.1, 2.1],
  [ 0.99, 0.066, -0.075, 0.075, 2.0, 2.0],
];
const TETE_Y = [-0.14, -0.095, -0.055, -0.025, 0.0, 0.025, 0.05, 0.075, 0.1, 0.12, 0.137, 0.153, 0.168, 0.184, 0.2, 0.218,
  0.235, 0.25, 0.265, 0.28, 0.295, 0.315, 0.338, 0.362, 0.386, 0.41, 0.432, 0.45, 0.466, 0.482, 0.5, 0.52, 0.54, 0.565,
  0.6, 0.65, 0.71, 0.77, 0.83, 0.88, 0.925, 0.96, 0.985];
const TETE_Y0 = -0.14, TETE_Y1 = 1.0, TETE_K = 48;
const angleTete = (sp) => PI * (0.52 * sp + 0.48 * sp * sp * sp);
function spDe(th){ let a = -1, b = 1; for (let i = 0; i < 32; i++){ const c = (a + b) / 2; if (angleTete(c) < th) a = c; else b = c; } return (a + b) / 2; }
// le nez : [hauteur, avancée, demi-largeur, exposant du profil en travers]
const NEZ = [
  [0.228, 0.000, 0.058, 2.0], [0.242, 0.030, 0.062, 2.0], [0.258, 0.084, 0.068, 2.1], [0.275, 0.121, 0.074, 2.2],
  [0.293, 0.134, 0.070, 2.1], [0.315, 0.121, 0.059, 2.0], [0.345, 0.100, 0.052, 2.0], [0.390, 0.076, 0.048, 2.0],
  [0.440, 0.050, 0.047, 2.0], [0.485, 0.025, 0.052, 2.0], [0.525, 0.000, 0.064, 2.0],
];
function surfaceTete(cfg, m){
  const V = cfg.visage || {};
  const k = (n) => k5(V[n]);
  const f = m.f, kc = m.kc;
  const kJaw = k('machoire'), kForme = k('forme'), kMenton = k('menton'), kPom = k('pommettes');
  const kNL = k('nezLarg'), kNLo = k('nezLong'), kNA = k('nezArete');
  const kLev = k('levres'), kBou = k('bouche'), kYT = k('yeuxTaille'), kYE = k('yeuxEcart'), kSo = k('sourcils');
  const age = V.age == null ? 0.25 : V.age;
  const eyeX = 0.138 * (1 + kYE * 0.14);
  const mh = 0.106 * (1 + kBou * 0.2) * (1 + f * 0.03);
  const lipU = (0.017 + f * 0.008) * (1 + kLev * 0.7), lipL = (0.025 + f * 0.010) * (1 + kLev * 0.7);
  const brow = 0.024 * (1 - f * 0.55) * (1 + kSo * 0.5);
  const nez = (x, y) => {
    const yr = 0.525 - (0.525 - y) / (1 + kNLo * 0.16);
    if (yr < 0.222 || yr > 0.525) return 0;
    const av = lireTable(NEZ, yr, 1) * (1 + kNLo * 0.12) * (1 - f * 0.12);
    const w = lireTable(NEZ, yr, 2) * (1 + kNL * 0.28) * (1 - f * 0.1), ex = lireTable(NEZ, yr, 3);
    const u = Math.abs(x) / w;
    let d = u < 1 ? av * Math.pow(1 - Math.pow(u, ex), 0.85) : 0;
    d += kNA * 0.028 * cloche(yr - 0.375, 0.03) * Math.max(0, 1 - Math.pow(Math.abs(x) / 0.05, 2));
    return d;
  };
  // les ailes du nez, de part et d'autre de la pointe
  const ailes = (x, y) => (0.046 * (1 + kNL * 0.3) * (1 - f * 0.15)) * cloche(Math.abs(x) - 0.06 * (1 + kNL * 0.26), 0.026) * cloche(y - (0.262 - kNLo * 0.012), 0.016);
  const surf = (th, y) => {
    const zf0 = lireTable(TETE, y, 1), zb = lireTable(TETE, y, 2);
    let xs = lireTable(TETE, y, 3), nf = lireTable(TETE, y, 4);
    const nb = lireTable(TETE, y, 5);
    let zf = zf0;
    xs *= 1 - f * (0.075 * cloche(y - 0.11, 0.09) + 0.02);
    xs *= 1 + kJaw * 0.17 * cloche(y - 0.11, 0.085);
    nf += -kJaw * 0.22 * cloche(y - 0.07, 0.07) + f * 0.12 * lisse(0.5, 0.8, y);
    xs *= 1 - kForme * 0.11 * lisse(0.52, 0.06, y);
    nf += kForme * -0.35 * lisse(0.45, 0.02, y);
    xs *= 1 + kc * 0.13 * cloche(y - 0.18, 0.13);
    if (kc > 0) zf += kc * 0.09 * cloche(y + 0.02, 0.03);            // le double menton
    const sn = Math.sin(th), cs = Math.cos(th);
    const e = 2 / (cs >= 0 ? nf : nb);
    let x = xs * Math.sign(sn) * Math.pow(Math.abs(sn), e);
    let z = (cs >= 0 ? zf : -zb) * Math.sign(cs) * Math.pow(Math.abs(cs), e);   // zb est négatif dans la table
    if (cs > 0){
      const ax = Math.abs(x);
      let dz = Math.max(nez(x, y), ailes(x, y));
      // les lèvres, et le trait de la bouche entre elles
      const bx = ax < mh ? Math.pow(1 - (ax / mh) * (ax / mh), 0.6) : 0;
      dz += lipU * cloche(y - 0.19, 0.015) * bx + lipL * cloche(y - 0.135, 0.019) * Math.pow(bx, 0.8);
      dz -= 0.013 * cloche(y - 0.162, 0.0065) * Math.pow(bx, 0.3);
      dz -= 0.004 * cloche(x, 0.012) * cloche(y - 0.218, 0.012);                     // le philtrum
      dz -= 0.010 * cloche(ax - mh, 0.018) * cloche(y - 0.163, 0.02);                // les commissures
      // les orbites, le globe de l'œil, l'arcade
      dz -= 0.027 * cloche(ax - eyeX, 0.072) * cloche(y - 0.472, 0.042);
      dz += 0.012 * (1 + kYT * 0.4) * cloche(ax - eyeX, 0.05) * cloche(y - 0.456, 0.024);
      dz += brow * cloche(ax - 0.12, 0.095) * cloche(y - 0.538, 0.022);
      // les pommettes, et le creux dessous (maigreur, âge)
      dz += (0.014 + kPom * 0.03) * cloche(ax - 0.2, 0.06) * cloche(y - 0.395, 0.04);
      x += Math.sign(x) * (0.006 + kPom * 0.02) * cloche(ax - 0.27, 0.06) * cloche(y - 0.395, 0.05);
      dz -= (Math.max(0, -kc) * 0.022 + age * 0.01) * cloche(ax - 0.21, 0.06) * cloche(y - 0.27, 0.05);
      // le menton, les joues
      dz += (0.012 + kMenton * 0.036 - f * 0.006) * cloche(x, 0.072 * (1 - f * 0.15)) * cloche(y - 0.055, 0.034);
      dz += Math.max(0, kc) * 0.03 * cloche(ax - 0.19, 0.08) * cloche(y - 0.22, 0.07);
      z += dz * lisse(0.0, 0.25, cs);
    }
    return [x, y, z];
  };
  surf.eyeX = eyeX; surf.mh = mh; surf.kYT = kYT;
  return surf;
}
/* Le point de la surface à une largeur x donnée (côté +x si x > 0), à la
   hauteur y : on cherche l'angle par dichotomie. Sert à poser les yeux et à
   peindre le visage au bon endroit. */
function angleDeX(surf, x, y){
  let a = 0, b = PI / 2;
  const ax = Math.abs(x);
  for (let i = 0; i < 28; i++){ const c = (a + b) / 2; if (Math.abs(surf(c, y)[0]) < ax) a = c; else b = c; }
  return Math.sign(x || 1) * (a + b) / 2;
}
function repereTete(m, R){
  const HH = m.hh * m.s, t = R[O.tete];
  const org = [t[0], t[1] - 0.25 * HH, t[2] + 0.06 * HH];
  return { HH, org, monde: (p) => [org[0] + p[0] * HH, org[1] + p[1] * HH, org[2] + p[2] * HH] };
}
const uvTete = (th, y) => [(spDe(th) + 1) / 2, 1 - (y - TETE_Y0) / (TETE_Y1 - TETE_Y0)];
function construireTete(cfg, m, R, opts){
  const surf = surfaceTete(cfg, m), T = repereTete(m, R);
  const M = new Maille();
  const osTete = (y) => { const w = lisse(0.06, -0.12, y) * 0.75; return [[O.tete, 1 - w], [O.cou, w]]; };
  const idx = [];
  TETE_Y.forEach((y, i) => {
    const a0 = M.nb; idx.push(a0);
    for (let j = 0; j <= TETE_K; j++){
      const sp = -1 + 2 * j / TETE_K, th = angleTete(sp);
      M.sommet(T.monde(surf(th, y)), [(sp + 1) / 2, 1 - (y - TETE_Y0) / (TETE_Y1 - TETE_Y0)], null, osTete(y));
    }
    if (i > 0) coudre(M, idx[i - 1], a0, TETE_K + 1, false, true);
  });
  (M.coutures = []).push(...idx.map(a => [a, a + TETE_K]));
  // le sommet du crâne
  const last = idx[idx.length - 1];
  const pole = M.sommet(T.monde([0, 1.0, -0.01]), [0.5, 0], null, [[O.tete, 1]]);
  for (let j = 0; j < TETE_K; j++) M.tri(last + j, last + j + 1, pole);
  // vérifie le sens : la normale d'un triangle du visage doit regarder devant
  {
    const I = M.i, P = M.p, t = Math.floor(idx.length / 2) * 0;
    const a = I[0] * 3, b = I[1] * 3, c = I[2] * 3;
    const n = v3.cross([P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]);
    const cen = T.monde([0, TETE_Y[0], -0.05]);
    if (v3.dot(n, [P[a] - cen[0], P[a + 1] - cen[1], P[a + 2] - cen[2]]) < 0){
      for (let q = 0; q < I.length; q += 3){ const tmp = I[q + 1]; I[q + 1] = I[q + 2]; I[q + 2] = tmp; }
    }
  }
  // les oreilles : même matière, la couleur de la peau est prise au côté de la tête dans la texture
  const V = cfg.visage || {}, kO = k5(V.oreilles);
  if (!opts || opts.oreilles !== false) [1, -1].forEach(sg => {
    const th = sg * PI / 2 * 0.985, y = 0.40;
    const p = surf(th, y);
    const cen = T.monde([p[0] * 0.965, y, -0.025]);
    const d = M.nb;
    const uvO = uvTete(sg * PI / 2 * 0.9, 0.33);
    oreille(M, [[O.tete, 1]], cen, sg, 0.135 * T.HH * (1 + kO * 0.28), 0.074 * T.HH * (1 + kO * 0.22), 0.03 * T.HH, [1, 1, 1, 1]);
    for (let v = d; v < M.nb; v++){ M.uv[v * 2] = uvO[0]; M.uv[v * 2 + 1] = uvO[1]; }
  });
  M.normales(); souder(M);
  return { M, surf, T };
}
/* LES YEUX : deux petites grilles posées sur la surface, juste devant, sur
   lesquelles le programme peint l'œil à chaque image (voir `oeil` dans
   FS_PERSO). Leur u va toujours du coin INTÉRIEUR au coin extérieur — la
   gauche et la droite sont en miroir —, leur v de bas en haut. */
function construireYeux(cfg, surf, T){
  const V = cfg.visage || {};
  const kYT = k5(V.yeuxTaille), wE = 0.073 * (1 + kYT * 0.2), hE = 0.044 * (1 + kYT * 0.2), y0 = 0.458;
  const out = [];
  [1, -1].forEach(sg => {
    const M = new Maille(), cx = sg * surf.eyeX, NX = 8, NY = 5;
    for (let b = 0; b <= NY; b++){
      for (let a = 0; a <= NX; a++){
        const u = a / NX, v = b / NY;
        const x = cx + sg * (u * 2 - 1) * wE, y = y0 + (v * 2 - 1) * hE;
        const th = angleDeX(surf, x, y);
        const p = surf(th, y);
        M.sommet(T.monde([p[0], p[1], p[2] + 0.006]), [u, v], null, [[O.tete, 1]]);
      }
    }
    for (let b = 0; b < NY; b++) for (let a = 0; a < NX; a++){
      const i = b * (NX + 1) + a;
      if (sg > 0) M.quad(i, i + 1, i + NX + 2, i + NX + 1); else M.quad(i, i + NX + 1, i + NX + 2, i + 1);
    }
    M.normales();
    out.push({ M, cote: sg });
  });
  return out;
}

/* ---------------------------------------------------------------------------
   9. LE VISAGE PEINT
   La géométrie donne le relief ; le reste est PEINT, comme sur les visages
   des jeux de l'époque : l'ombre des orbites, les sourcils poil à poil, les
   narines, les lèvres et leur couleur, la barbe de trois jours, la lisière
   des cheveux sur le crâne. Une toile de 1024 px, dans les coordonnées de
   texture de la tête (voir uvTete) : le visage y prend plus de la moitié de
   la largeur, les angles étant serrés devant.
   --------------------------------------------------------------------------- */
const LISIERE = [[0, 0.795], [0.45, 0.772], [0.85, 0.705], [1.18, 0.625], [1.36, 0.50], [1.47, 0.47], [1.58, 0.56], [1.78, 0.56],
  [1.95, 0.47], [2.3, 0.30], [2.7, 0.19], [3.15, 0.15]];
function peindreVisage(cfg, surf, cheveuxInfo){
  const W = 1024, c = toile(W), g = c.getContext('2d');
  const V = cfg.visage || {}, f = cfg.sexe === 'f';
  const peau = hexRvb(cfg.peau || '#c89878');
  const coulPoil = hexRvb((cfg.cheveux && cfg.cheveux.couleur) || '#2a1d15');
  const rnd = graine(0x51ED + Math.round((V.age || 0) * 100));
  const col = (k, a) => 'rgba(' + Math.round(clamp(k[0], 0, 1) * 255) + ',' + Math.round(clamp(k[1], 0, 1) * 255) + ',' + Math.round(clamp(k[2], 0, 1) * 255) + ',' + (a == null ? 1 : a) + ')';
  const P = (x, y) => { const uv = uvTete(angleDeX(surf, x, y), y); return [uv[0] * W, uv[1] * W]; };
  const PY = (y) => (1 - (y - TETE_Y0) / (TETE_Y1 - TETE_Y0)) * W;
  const PX = (th) => (spDe(th) + 1) / 2 * W;
  // un pixel de hauteur de tête, en px de toile ; et en largeur au milieu du visage
  const uy = W / (TETE_Y1 - TETE_Y0);
  const halo = (x, y, r, k, a) => {
    const [X, Y] = P(x, y), gr = g.createRadialGradient(X, Y, 0, X, Y, r);
    gr.addColorStop(0, col(k, a)); gr.addColorStop(1, col(k, 0));
    g.fillStyle = gr; g.fillRect(X - r, Y - r, r * 2, r * 2);
  };
  // 1. la peau, et ses nuances : le rose des joues et du nez, l'ombre sous la mâchoire
  g.fillStyle = col(peau); g.fillRect(0, 0, W, W);
  const rouge = [peau[0] * 1.04, peau[1] * 0.86, peau[2] * 0.84];
  [1, -1].forEach(sg => { halo(sg * 0.21, 0.30, 70, rouge, 0.28 + (V.fard ? 0.3 : 0)); halo(sg * 0.33, 0.35, 60, rouge, 0.12); });
  halo(0, 0.29, 34, rouge, 0.25);
  // le fard à joues, s'il y en a (voir maquillage) : un rose plus franc, plus haut sur la pommette
  if (V.fard) [1, -1].forEach(sg => halo(sg * 0.23, 0.36, 62, [0.93, 0.45, 0.52], 0.28));
  const ombre = [peau[0] * 0.8, peau[1] * 0.76, peau[2] * 0.76];
  { const gr = g.createLinearGradient(0, PY(0.03), 0, PY(-0.05));
    gr.addColorStop(0, col(ombre, 0)); gr.addColorStop(0.6, col(ombre, 0.16)); gr.addColorStop(1, col(ombre, 0));
    g.fillStyle = gr; g.fillRect(PX(-1.3), PY(0.03), PX(1.3) - PX(-1.3), PY(-0.05) - PY(0.03)); }
  const clair = [Math.min(1, peau[0] * 1.08), Math.min(1, peau[1] * 1.07), Math.min(1, peau[2] * 1.06)];
  halo(0, 0.4, 26, clair, 0.3); [1, -1].forEach(sg => halo(sg * 0.2, 0.39, 40, clair, 0.18));
  for (let i = 0; i < 2600; i++){ const x = (rnd() * 2 - 1) * 0.36, y = rnd() * 0.72; const [X, Y] = P(x, y);
    g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.05)' : col([peau[0] * 0.7, peau[1] * 0.55, peau[2] * 0.5], 0.06); g.fillRect(X, Y, 2, 2); }
  /* LE MODELÉ PEINT : sans ombres portées, un visage n'a de relief que ce
     qu'on lui donne. On peint donc ce que ferait la lumière d'un plafond —
     les creux qui s'assombrissent, les bosses qui accrochent —, comme sur
     les visages peints à la main des jeux de l'époque. */
  const creux = (x, y, r, a) => halo(x, y, r, [peau[0] * 0.72, peau[1] * 0.62, peau[2] * 0.62], a);
  const bosse = (x, y, r, a) => halo(x, y, r, [Math.min(1, peau[0] * 1.12), Math.min(1, peau[1] * 1.1), Math.min(1, peau[2] * 1.08)], a);
  [1, -1].forEach(sg => {
    creux(sg * 0.2, 0.27, 58, 0.26);              // sous la pommette
    creux(sg * 0.3, 0.5, 60, 0.22);               // la tempe
    creux(sg * surf.eyeX, 0.505, 44, 0.3);        // sous l'arcade
    creux(sg * 0.1, 0.44, 18, 0.12);              // le coin de l'œil, contre le nez
    bosse(sg * 0.21, 0.405, 40, 0.32);            // la pommette
    creux(sg * 0.105, 0.2, 26, 0.18);             // le sillon du nez à la bouche
  });
  creux(0, 0.236, 26, 0.34);                      // sous le nez
  creux(0, 0.105, 34, 0.3);                       // sous la lèvre
  bosse(0, 0.63, 70, 0.26); bosse(0, 0.38, 16, 0.35); bosse(0, 0.055, 36, 0.24);   // le front, l'arête, le menton
  { // les bords du visage s'assombrissent en tournant vers les oreilles
    const g2 = g.createLinearGradient(PX(-1.35), 0, PX(1.35), 0);
    const o = col([peau[0] * 0.8, peau[1] * 0.72, peau[2] * 0.72], 0.3), t0 = col(peau, 0);
    g2.addColorStop(0, o); g2.addColorStop(0.24, t0); g2.addColorStop(0.76, t0); g2.addColorStop(1, o);
    g.fillStyle = g2; g.fillRect(PX(-1.35), PY(0.7), PX(1.35) - PX(-1.35), PY(-0.02) - PY(0.7));
  }
  // 2. les orbites, un peu plus sombres ; le pli de la paupière
  [1, -1].forEach(sg => {
    halo(sg * surf.eyeX, 0.47, 64, [peau[0] * 0.78, peau[1] * 0.72, peau[2] * 0.74], 0.38);
    const pts = [-1, -0.5, 0, 0.5, 1].map(u => P(sg * (surf.eyeX + u * 0.07), 0.492 + 0.012 * (1 - u * u)));
    g.strokeStyle = col([peau[0] * 0.6, peau[1] * 0.52, peau[2] * 0.52], 0.45); g.lineWidth = 3;
    g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke();
    // les cernes, avec l'âge
    const cerne = pts.map((p, i) => P(sg * (surf.eyeX + (i / 2 - 1) * 0.055), 0.418 - 0.008 * (1 - Math.pow(i / 2 - 1, 2))));
    g.strokeStyle = col([peau[0] * 0.62, peau[1] * 0.52, peau[2] * 0.56], 0.18 + (V.age || 0) * 0.3); g.lineWidth = 3;
    g.beginPath(); cerne.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke();
  });
  // 3. le nez : l'ombre de ses flancs, et les narines
  [1, -1].forEach(sg => {
    halo(sg * 0.055, 0.37, 22, [peau[0] * 0.86, peau[1] * 0.8, peau[2] * 0.8], 0.22);
    const [X, Y] = P(sg * 0.036, 0.247);
    g.fillStyle = col([peau[0] * 0.42, peau[1] * 0.3, peau[2] * 0.3], 0.55);
    g.beginPath(); g.ellipse(X, Y, 6, 3.2, sg * 0.4, 0, TAU); g.fill();
    // l'aile du nez : un creux plus sombre sur son pourtour
    halo(sg * 0.068, 0.262, 14, [peau[0] * 0.78, peau[1] * 0.68, peau[2] * 0.68], 0.35);
  });
  // 4. la bouche
  // la couleur des lèvres : le rouge à lèvres s'il y en a ; sinon la peau, rosie et assombrie — à peine chez un homme
  const levreC = V.levresC ? hexRvb(V.levresC) : f ? [peau[0] * 0.88 + 0.07, peau[1] * 0.62, peau[2] * 0.64] : [peau[0] * 0.86 + 0.03, peau[1] * 0.70, peau[2] * 0.70];
  const mh = surf.mh * 0.98;
  const bord = (y0, y1, bosse) => {
    const pts = [];
    for (let i = 0; i <= 16; i++){ const u = i / 16 * 2 - 1, x = u * mh; pts.push(P(x, y0 + (y1 - y0) * Math.pow(1 - u * u, 0.7) + bosse(u))); }
    return pts;
  };
  const arc = (u) => -0.012 * cloche(Math.abs(u) - 0.0, 0.1) + 0.006 * cloche(Math.abs(u) - 0.3, 0.14);   // l'arc de Cupidon
  const hautL = bord(0.163, 0.204 + (f ? 0.006 : 0), arc), milieu = bord(0.163, 0.161, () => 0), basL = bord(0.163, 0.111 - (f ? 0.006 : 0), () => 0);
  const remplir = (a, b, k, al) => { g.fillStyle = col(k, al); g.beginPath(); a.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); b.slice().reverse().forEach(p => g.lineTo(p[0], p[1])); g.closePath(); g.fill(); };
  remplir(hautL, milieu, [levreC[0] * 0.86, levreC[1] * 0.82, levreC[2] * 0.84], V.levresC ? 0.95 : 0.8);
  remplir(milieu, basL, levreC, V.levresC ? 0.95 : 0.8);
  // le reflet de la lèvre du bas, et le trait de la bouche
  { const [X, Y] = P(0, 0.135); const gr = g.createRadialGradient(X, Y, 0, X, Y, 26); gr.addColorStop(0, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(X - 30, Y - 30, 60, 60); }
  g.strokeStyle = col([levreC[0] * 0.35, levreC[1] * 0.22, levreC[2] * 0.24], 0.85); g.lineWidth = 2.6;
  g.beginPath(); milieu.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke();
  // 5. les rides, avec l'âge : le front, les sillons du nez à la bouche, la patte-d'oie
  const age = V.age == null ? 0.25 : V.age;
  if (age > 0.3){
    const a = (age - 0.3) / 0.7, ride = col([peau[0] * 0.6, peau[1] * 0.5, peau[2] * 0.5], 0.35 * a);
    g.strokeStyle = ride; g.lineWidth = 2;
    [0.64, 0.68, 0.72].forEach(y => { g.beginPath(); [-0.2, -0.1, 0, 0.1, 0.2].forEach((x, i) => { const p = P(x, y + 0.006 * Math.cos(x * 12)); i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); }); g.stroke(); });
    [1, -1].forEach(sg => {
      g.beginPath(); [[0.085, 0.27], [0.11, 0.22], [0.125, 0.17], [0.13, 0.13]].forEach(([x, y], i) => { const p = P(sg * x, y); i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); }); g.stroke();
      [-0.02, 0, 0.02].forEach(d => { g.beginPath(); const p0 = P(sg * 0.235, 0.46 + d), p1 = P(sg * 0.27, 0.46 + d * 1.8); g.moveTo(p0[0], p0[1]); g.lineTo(p1[0], p1[1]); g.stroke(); });
    });
  }
  // 6. les taches de rousseur
  if (V.taches){
    for (let i = 0; i < 90; i++){
      const x = (rnd() * 2 - 1) * 0.3, y = 0.26 + rnd() * 0.2;
      if (Math.abs(x) < 0.05 && y > 0.4) continue;
      const [X, Y] = P(x, y);
      g.fillStyle = col([peau[0] * 0.62, peau[1] * 0.42, peau[2] * 0.3], 0.35 + rnd() * 0.3);
      g.beginPath(); g.arc(X, Y, 1.4 + rnd() * 2, 0, TAU); g.fill();
    }
  }
  // 7. les sourcils : une forme effilée, puis des poils par-dessus
  const S = (cfg.sourcils && cfg.sourcils.style) || (f ? 'fins' : 'naturels');
  const epS = { fins: 0.02, naturels: 0.029, epais: 0.04, broussailleux: 0.05, arques: 0.024 }[S] || 0.029;
  const archeS = { fins: 0.02, naturels: 0.016, epais: 0.012, broussailleux: 0.008, arques: 0.026 }[S] || 0.016;
  const hS = 0.535 + k5(V.sourcils) * 0.018;
  const poilS = melange(coulPoil, [0.06, 0.04, 0.03], 0.25);
  [1, -1].forEach(sg => {
    const ligne = [];
    for (let i = 0; i <= 12; i++){
      const u = i / 12, x = sg * (0.045 + u * 0.19), y = hS + archeS * Math.sin(u * PI * 0.9) - 0.006 * u;
      const e = epS * (1 - Math.pow(u, 1.8) * 0.75) * (0.8 + 0.2 * Math.sin(u * PI));
      ligne.push([x, y, e]);
    }
    g.save(); g.filter = 'blur(2px)';
    g.fillStyle = col(poilS, 0.62);
    g.beginPath();
    ligne.forEach(([x, y, e], i) => { const p = P(x, y + e / 2); i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); });
    ligne.slice().reverse().forEach(([x, y, e]) => { const p = P(x, y - e / 2); g.lineTo(p[0], p[1]); });
    g.closePath(); g.fill(); g.restore();
    g.strokeStyle = col(poilS, 0.45); g.lineWidth = 1.2; g.lineCap = 'round';
    for (let i = 0; i < 110; i++){
      const u = rnd(), l = ligne[Math.min(12, Math.round(u * 12))];
      const x = l[0], y = l[1] + (rnd() - 0.5) * l[2];
      const [X, Y] = P(x, y);
      const ang = (u < 0.25 ? -1.2 : -0.35) * sg;
      g.beginPath(); g.moveTo(X, Y); g.lineTo(X + Math.cos(ang) * 7 * sg, Y + Math.sin(ang) * 5); g.stroke();
    }
  });
  // 8. la pilosité du visage : une ombre de poils sur la zone de la barbe
  const barbe = (cfg.barbe && cfg.barbe.style) || 'aucune';
  const zoneBarbe = (x, y) => {
    const ax = Math.abs(x);
    const levre = y > 0.18 && y < 0.245 && ax < 0.13;                       // la moustache
    const menton = y < 0.13 && y > -0.06 && ax < 0.13;
    const joue = y < 0.34 && y > -0.08 && ax < 0.34 && !(y > 0.1 && ax < mh * 1.05 && y < 0.2);
    return { levre, menton, joue };
  };
  const densite = { aucune: 0, troisJours: 0.35, bouc: 0.9, moustache: 0.95, collier: 0.8, barbe: 0.95, favoris: 0.8 }[barbe] || 0;
  if (densite > 0){
    const poil = melange(coulPoil, [0.05, 0.04, 0.03], 0.2);
    for (let i = 0; i < 6000; i++){
      const x = (rnd() * 2 - 1) * 0.36, y = -0.08 + rnd() * 0.42;
      const z = zoneBarbe(x, y);
      const garde = barbe === 'troisJours' ? (z.levre || z.menton || z.joue)
        : barbe === 'bouc' ? (z.levre || (z.menton && Math.abs(x) < 0.09))
        : barbe === 'moustache' ? (z.levre && y > 0.185)
        : barbe === 'favoris' ? (z.joue && Math.abs(x) > 0.24 && y > 0.12)
        : barbe === 'collier' ? (z.menton || (z.joue && y < 0.12 + Math.abs(x) * 0.5 && y < 0.2) || z.levre)
        : (z.levre || z.menton || z.joue);
      if (!garde) continue;
      const bordD = barbe === 'troisJours' ? 1 : lisse(0.36, 0.3, Math.abs(x)) * lisse(0.34, 0.28, y);
      const [X, Y] = P(x, y);
      g.fillStyle = col(poil, densite * (0.35 + rnd() * 0.45) * (barbe === 'troisJours' ? 0.55 : 1) * (0.4 + 0.6 * bordD));
      g.fillRect(X, Y, 1.6 + rnd() * 1.6, 1.6 + rnd() * 2.4);
    }
  }
  // 9. le cuir chevelu, sous la coupe : la lisière des cheveux, et la couleur du poil
  const coupe = cheveuxInfo || { crane: 1, lisiere: 1 };
  if (coupe.crane > 0){
    const pts = [];
    for (let i = 0; i <= 64; i++){
      const sp = -1 + 2 * i / 64, th = angleTete(sp), y = lireTable(LISIERE, Math.abs(th), 1) + (coupe.recul || 0) * lisse(1.2, 0, Math.abs(th));
      pts.push([(sp + 1) / 2 * W, PY(y)]);
    }
    g.save();
    g.beginPath(); g.moveTo(0, 0); pts.forEach(p => g.lineTo(p[0], p[1])); g.lineTo(W, 0); g.closePath(); g.clip();
    const base = melange(peau, coulPoil, clamp(coupe.crane, 0, 1) * 0.92);
    g.fillStyle = col(base); g.fillRect(0, 0, W, W);
    for (let i = 0; i < 6000; i++){
      const X = rnd() * W, Y = rnd() * PY(0.12);
      g.fillStyle = col(melange(coulPoil, [0, 0, 0], rnd() * 0.4), 0.35 * coupe.crane);
      g.fillRect(X, Y, 2, 4 + rnd() * 4);
    }
    g.restore();
    // un fondu doux sur la lisière : les cheveux ne s'arrêtent pas au couteau
    g.strokeStyle = col(melange(peau, coulPoil, 0.45 * coupe.crane), 0.55); g.lineWidth = 7;
    g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1] + 3) : g.moveTo(p[0], p[1] + 3)); g.stroke();
  }
  return c;
}

/* ---------------------------------------------------------------------------
   9 bis. LES CHEVEUX
   Une coupe est faite de trois sortes de pièces :
   - une COQUE posée sur le crâne : la surface de la tête, décalée vers
     l'extérieur d'une épaisseur qui varie (du volume sur le dessus, rien sur
     les côtés d'un dégradé) et qui retombe à zéro en douceur sur la lisière —
     la coque ne s'arrête jamais au couteau, elle rentre dans la peau ;
   - des RIDEAUX pour ce qui tombe : partis du tour de la tête, ils descendent
     et s'écartent pour passer DERRIÈRE les épaules, en suivant la carrure du
     personnage (voir `contourner`) — sans quoi des cheveux longs traversent
     les épaules du premier costaud venu ;
   - des volumes : une queue de cheval, un chignon, des dreads, des couettes.
   Le bas des pièces qui tombent est pesé sur la poitrine plutôt que sur la
   tête : quand elle tourne, les pointes suivent le corps et ne balaient pas
   le dos. La couleur est un uniforme (voir uTeinte) : changer de couleur ne
   reconstruit rien ; la texture n'est que le grain des mèches, en gris.
   --------------------------------------------------------------------------- */
const HAIR_Y = [0.06, 0.1, 0.14, 0.18, 0.22, 0.26, 0.30, 0.34, 0.38, 0.42, 0.46, 0.50, 0.54, 0.58, 0.62, 0.66, 0.70,
  0.74, 0.78, 0.82, 0.86, 0.90, 0.935, 0.965, 0.985];
const lisiere = (th) => lireTable(LISIERE, Math.abs(th), 1);
function contexteCheveux(cfg, surf, T, m, R){
  const normale = (th, y) => {
    const a = surf(th - 0.012, y), b = surf(th + 0.012, y), c = surf(th, y - 0.012), d = surf(th, y + 0.012);
    let n = v3.norm(v3.cross(v3.sub(b, a), v3.sub(d, c)));
    const p = surf(th, y);
    if (v3.dot(n, [p[0], p[1] - 0.52, p[2] + 0.04]) < 0) n = v3.mul(n, -1);
    return n;
  };
  const local = (th, y, ep) => v3.madd(surf(th, y), normale(th, y), ep);
  // l'épaisseur de ce qu'on porte en haut : ce qui tombe doit passer par-dessus
  const h = HAUTS[coupeDe(cfg.tenue)];
  const habit = h && h.corps ? h.corps.plus + (h.manche ? h.manche.plus * 0.5 : 0) : 0.004;
  // la capuche rabattue : les longueurs passent par-dessus, dans le dos seulement
  const dos = h && h.capuche ? 0.034 : 0;
  return { cfg, surf, T, m, R, normale, local, monde: (p) => T.monde(p), rnd: graine(0xC0FFEE), habit, dos, chapeau: sousChapeau(cfg) };
}
/* LA COQUE. `presence(th, y)` de 0 à 1, `ep(th, y)` l'épaisseur (en hauteur
   de tête), `leve(th, y, pr)` un décalage libre (une banane qui avance, une
   frange qui descend).
   HORS DE LA COUPE, LA COQUE PLONGE SOUS LA PEAU au lieu de s'arrêter : son
   épaisseur devient négative. Le bord visible des cheveux est donc la ligne
   où deux surfaces lisses se croisent — une courbe nette —, et non le bord
   d'une grille de cases, qui faisait des marches d'escalier aux tempes.
   `chute` : ce qui tombe, pour les coupes longues. Les longueurs PARTENT DU
   MÊME ANNEAU que la coque (à la hauteur `chute.y0`) : même colonnes, même
   épaisseur, aucun raccord. Chaque colonne descend, s'écarte un peu
   (`evase`, `gonfle`), recule sur les côtés pour passer derrière les
   épaules (`recul`), contourne le corps (voir contourner), et s'arrête à une
   longueur un peu différente de ses voisines (`pointes`). */
function coque(M, H, o){
  const K = TETE_K, ch = o.chute;
  // sous un chapeau, les cheveux s'écrasent contre le crâne (voir sousChapeau)
  if (H.chapeau && !o.chapeau){
    const b = H.chapeau.bord, ep0 = o.ep, bande = H.chapeau.bande;
    o = Object.assign({}, o, { ep: (th, y) => ep0(th, y) * (bande ? 1 - 0.6 * cloche(y - b - 0.04, 0.05) : 1 - 0.78 * lisse(b - 0.05, b + 0.02, y)) });
  }
  const yb = ch ? ch.y0 : (o.bas == null ? 0.06 : o.bas);
  const ys = HAIR_Y.filter(y => y > yb + 1e-6);
  ys.unshift(yb);
  const cols = [];
  for (let j = 0; j <= K; j++){ const sp = -1 + 2 * j / K; cols.push({ j, th: angleTete(sp) }); }
  const HH = H.T.HH;
  const rangs = ys.map(y => cols.map(c => {
    const pr = clamp(o.presence(c.th, y), 0, 1);
    const e = o.ep(c.th, y) * Math.pow(pr, 0.7) - 0.016 * (1 - pr);
    let p = H.local(c.th, y, e);
    if (o.leve) p = v3.add(p, o.leve(c.th, y, pr));
    return { P: H.monde(p), pr, v: 1 - y, os: [[O.tete, 1]] };
  }));
  if (ch){
    const base = rangs[0], NR = ch.rangs || 8, rnd = graine(ch.graine || 3);
    const pointe = cols.map(() => 1 - (ch.pointes == null ? 0.12 : ch.pointes) * rnd());
    const chute = [];
    for (let r = NR; r >= 1; r--){
      const v = r / NR;
      chute.push(cols.map((c, j) => {
        const b = base[j], vv = v * pointe[j], d = vv * ch.longueur;
        const sn = Math.sin(c.th), cs = Math.cos(c.th);
        const ecart = (ch.evase || 0.04) * Math.pow(vv, 0.7) + (ch.gonfle || 0) * Math.sin(Math.min(1, vv * 1.3) * PI);
        let P = [b.P[0] + sn * ecart, b.P[1] - d, b.P[2] + cs * ecart - Math.abs(sn) * (ch.recul || 0) * lisse(0, 0.6, vv)];
        P = contourner(H, P, 0.016 + H.habit + ecart * 0.25);
        if (ch.forme) P = ch.forme(P, c, vv);
        const wT = lisse(0.1, 0.75, vv);
        return { P, pr: b.pr, v: b.v + d / HH, os: [[O.tete, 1 - wT], [O.cou, wT * 0.3], [O.poitrine, wT * 0.7]] };
      }));
    }
    rangs.unshift(...chute);
  }
  const idx = [];
  rangs.forEach((rang, i) => {
    const a0 = M.nb; idx.push(a0);
    rang.forEach((q, j) => { M.sommet(q.P, [j / K * 2, q.v * 1.4], null, q.os); });
    if (i > 0){
      const b0 = idx[i - 1], prec = rangs[i - 1];
      for (let j = 0; j < K; j++){
        if (prec[j].pr < 0.02 && prec[j + 1].pr < 0.02 && rang[j].pr < 0.02 && rang[j + 1].pr < 0.02) continue;
        M.quad(b0 + j, b0 + j + 1, a0 + j + 1, a0 + j);
      }
    }
  });
  // le sommet : un éventail sur le dernier anneau
  const last = idx[idx.length - 1];
  if (o.presence(0, 1) > 0.02){
    let p = [0, 1 + o.ep(0, 1) * 0.9, -0.01];
    if (o.leve) p = v3.add(p, o.leve(0, 1, 1));
    const pole = M.sommet(H.monde(p), [0.5, 0], null, [[O.tete, 1]]);
    for (let j = 0; j < K; j++) M.tri(last + j, last + j + 1, pole);
  }
  return idx;
}
/* Le personnage, à la hauteur y (monde) : le contour du tronc, pour que ce
   qui tombe passe autour des épaules et du dos au lieu de les traverser. */
function contourner(H, P, marge){
  const m = H.m, s = m.s;
  const yr = (P[1] / s - m.Y(0.925)) / m.tronc + 0.925;          // retour au repère du tronc
  if (yr > 1.5 || yr < 0.8) return P;
  const a = anneauTronc(m, yr);
  // l'épaule et le haut du bras : on élargit le contour au-dessus de l'aisselle
  const rs = a.rs * s + (yr > 1.34 ? 0.055 * s * lisse(1.34, 1.42, yr) : 0);
  const zc = a.zc * s;
  const x = P[0], z = P[2] - zc;
  const ang = Math.atan2(x, z);
  const mg = marge + (H.dos || 0) * Math.pow(Math.max(0, -Math.cos(ang)), 1.5) * lisse(1.26, 1.34, yr);
  const [ex, ez] = superE({ rs: rs + mg, rf: a.rf * s + mg, rb: a.rb * s + mg, n: a.n }, ang);
  return Math.hypot(x, z) < Math.hypot(ex, ez) ? [ex, P[1], ez + zc] : P;
}
/* Un volume : une sphère aplatie (chignon, macaron), un tube effilé (queue de
   cheval, dread). */
function boule(M, H, centre, r, ry, os){
  const K = 10, N = 7, idx = [];
  for (let i = 0; i <= N; i++){
    const b = -PI / 2 + PI * i / N, a0 = M.nb; idx.push(a0);
    for (let j = 0; j <= K; j++){
      const a = TAU * j / K;
      M.sommet([centre[0] + Math.cos(b) * Math.sin(a) * r, centre[1] + Math.sin(b) * ry, centre[2] + Math.cos(b) * Math.cos(a) * r], [j / K, i / N], null, os);
    }
    if (i > 0) coudre(M, idx[i - 1], a0, K + 1, false, false);
  }
}
function meche(M, pts, r0, r1, os, cotes){
  const K = cotes || 6;
  const an = pts.map((p, i) => {
    const t = v3.norm(i < pts.length - 1 ? v3.sub(pts[i + 1], p) : v3.sub(p, pts[i - 1]));
    const u = i / (pts.length - 1), r = mix(r0, r1, Math.pow(u, 0.8));
    return { c: p, t, avant: Math.abs(t[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0], rs: r, rf: r, rb: r, n: 2, u };
  });
  tuyau(M, an, { K, debut: 'ferme', fin: 'ferme', pointe: [null, v3.madd(pts[pts.length - 1], an[an.length - 1].t, r1 * 1.5)],
    uv: (r, j) => [j / K, r.u * 3], os: (r) => typeof os === 'function' ? os(r.u) : os });
}
/* Les coupes. `crane` : combien le cuir chevelu est peint aux couleurs du
   poil sous la coque (voir peindreVisage) — 1 partout où il y a des
   cheveux, 0,6 pour des côtés rasés, 0 pour un crâne nu. `grain` : la
   texture des mèches (lisse, frise, tresse). `oreilles: false` : la coupe les
   couvre, on ne les construit pas (elles perceraient les longueurs). */
const COIFFURES = {
  chauve:   { nom: { fr: 'Chauve', en: 'Bald' }, crane: 0 },
  rase:     { nom: { fr: 'Rasé', en: 'Buzz cut' }, crane: 0.62 },
  court:    { nom: { fr: 'Court', en: 'Short' }, crane: 1, grain: 'lisse' },
  degrade:  { nom: { fr: 'Dégradé', en: 'Fade' }, crane: 0.66, grain: 'lisse' },
  plaque:   { nom: { fr: 'Plaqué', en: 'Slicked back' }, crane: 1, grain: 'lisse' },
  banane:   { nom: { fr: 'Banane', en: 'Pompadour' }, crane: 1, grain: 'lisse' },
  crete:    { nom: { fr: 'Crête', en: 'Mohawk' }, crane: 0.45, grain: 'lisse' },
  afro:     { nom: { fr: 'Afro', en: 'Afro' }, crane: 1, grain: 'frise' },
  tresses:  { nom: { fr: 'Tresses collées', en: 'Cornrows' }, crane: 1, grain: 'tresse' },
  dreads:   { nom: { fr: 'Dreads', en: 'Locs' }, crane: 1, grain: 'tresse' },
  mulet:    { nom: { fr: 'Mulet', en: 'Mullet' }, crane: 1, grain: 'lisse' },
  milong:   { nom: { fr: 'Mi-long', en: 'Surfer' }, crane: 1, grain: 'lisse', oreilles: false },
  carre:    { nom: { fr: 'Carré', en: 'Bob' }, crane: 1, grain: 'lisse', oreilles: false },
  long:     { nom: { fr: 'Long', en: 'Long' }, crane: 1, grain: 'lisse', oreilles: false },
  boucles:  { nom: { fr: 'Boucles 80', en: '80s perm' }, crane: 1, grain: 'frise', oreilles: false },
  queue:    { nom: { fr: 'Queue de cheval', en: 'Ponytail' }, crane: 1, grain: 'lisse' },
  chignon:  { nom: { fr: 'Chignon', en: 'Bun' }, crane: 1, grain: 'lisse' },
  couettes: { nom: { fr: 'Macarons', en: 'Space buns' }, crane: 1, grain: 'lisse' },
};
/* La lisière, fondue : 0 sous la ligne, 1 un peu au-dessus. `dec` la
   descend (une coupe qui couvre un peu plus), négatif la remonte. La coque
   ne commence qu'un peu AU-DESSUS de la lisière peinte : son bord tombe sur
   des cheveux peints, jamais sur la peau. */
const surLisiere = (th, y, dec, fondu) => lisse(lisiere(th) - (dec || 0) - (fondu || 0.035), lisiere(th) - (dec || 0) + (fondu || 0.035), y);
// pour les coupes longues : les côtés et la nuque sont couverts jusqu'à la hauteur où tombent les longueurs
const surCotes = (th, y, y0, ouverture) => lisse(ouverture - 0.2, ouverture + 0.05, Math.abs(th)) * lisse(y0 - 0.03, y0 + 0.02, y);
function construireCheveux(cfg, H){
  const st = cfg.cheveux.style, M = new Maille(), rnd = graine(0xBEEF);
  const devant = (th) => cloche(th, 0.55);                       // 1 face au front, 0 sur les côtés
  const dessus = (y) => lisse(0.55, 0.95, y);
  const bruit = (th, y) => 0.5 + 0.5 * Math.sin(th * 7.3 + y * 11.1) * Math.sin(th * 3.1 - y * 17.3);
  // le volume ne naît pas d'un coup sur la lisière : il monte sur quelques centimètres
  const montee = (th, y, l) => lisse(lisiere(th) - 0.01, lisiere(th) + (l || 0.12), y);
  const frange = (th, y, bas) => devant(th) * lisse(bas - 0.04, bas + 0.02, y);
  switch (st){
    case 'chauve': case 'rase': return null;
    case 'court':
      coque(M, H, { presence: (th, y) => surLisiere(th, y, -0.01), ep: (th, y) => 0.016 + (0.03 * dessus(y) + 0.012 * devant(th) * dessus(y)) * montee(th, y) });
      break;
    case 'degrade':
      coque(M, H, { presence: (th, y) => surLisiere(th, y, -0.01) * lisse(0.63, 0.71, y + 0.06 * devant(th)), ep: (th, y) => (0.03 + 0.045 * dessus(y) + 0.02 * devant(th) * bruit(th, y)) * montee(th, y, 0.08) });
      break;
    case 'plaque':
      coque(M, H, { presence: (th, y) => surLisiere(th, y, -0.008), ep: (th, y) => 0.018 + (0.028 * dessus(y) * (1 - 0.4 * Math.abs(Math.sin(th))) + 0.01 * lisse(0.6, 0.2, y) * (1 - devant(th))) * montee(th, y),
        leve: (th, y) => [0, 0, -0.01 * dessus(y)] });
      break;
    case 'banane':
      coque(M, H, { presence: (th, y) => surLisiere(th, y, -0.008), ep: (th, y) => 0.018 + (0.03 * dessus(y) + 0.12 * devant(th) * cloche(y - 0.84, 0.08)) * montee(th, y, 0.08),
        leve: (th, y, pr) => [0, 0.03 * devant(th) * cloche(y - 0.84, 0.07) * pr, 0.045 * devant(th) * cloche(y - 0.83, 0.07) * pr] });
      break;
    case 'crete': {
      const bande = (th) => cloche(Math.abs(th) > PI / 2 ? (PI - Math.abs(th)) * 0.8 : th, 0.12);
      coque(M, H, { presence: (th, y) => surLisiere(th, y, -0.005) * lisse(0.3, 0.5, bande(th)) * lisse(0.3, 0.45, y), ep: (th, y) => (0.05 + 0.2 * dessus(y) * (0.8 + 0.4 * bruit(th * 3, y))) * bande(th) });
      break;
    }
    case 'afro':
      coque(M, H, { presence: (th, y) => surLisiere(th, y, 0.01, 0.05), ep: (th, y) => (0.10 + 0.13 * lisse(0.3, 0.8, y) - 0.05 * devant(th) * lisse(0.9, 0.6, y)) * (0.92 + 0.16 * bruit(th * 2, y * 2)) * montee(th, y, 0.16) });
      break;
    case 'tresses':
      coque(M, H, { presence: (th, y) => surLisiere(th, y, -0.005), ep: (th, y) => 0.012 + 0.007 * Math.abs(Math.sin(th * 9)) });
      break;
    case 'dreads': {
      coque(M, H, { presence: (th, y) => surLisiere(th, y, -0.005), ep: (th, y) => (0.024 + 0.012 * dessus(y)) * montee(th, y, 0.06) });
      const n = 24;
      for (let i = 0; i < n; i++){
        const th = PI + (-0.64 + 1.28 * (i / (n - 1))) * PI + (rnd() - 0.5) * 0.06;
        const y0 = mix(0.46, 0.66, rnd()), L = 0.28 + 0.16 * rnd();
        const pts = [];
        for (let k = 0; k <= 5; k++){
          const u = k / 5, base = H.monde(H.local(th, y0, 0.02));
          let P = [base[0] + Math.sin(th) * (0.02 + 0.03 * u), base[1] - u * L, base[2] + Math.cos(th) * 0.02 * u - Math.abs(Math.sin(th)) * 0.05 * u];
          P = contourner(H, P, 0.02);
          pts.push(P);
        }
        meche(M, pts, 0.0105 * H.m.s, 0.0075 * H.m.s, (u) => [[O.tete, 1 - lisse(0.2, 0.8, u)], [O.poitrine, lisse(0.2, 0.8, u)]], 5);
      }
      break;
    }
    case 'mulet':
      coque(M, H, { presence: (th, y) => Math.max(surLisiere(th, y, -0.008), surCotes(th, y, 0.32, PI * 0.72)),
        ep: (th, y) => 0.022 + (0.035 * dessus(y) + 0.015 * devant(th) * dessus(y)) * montee(th, y),
        chute: { y0: 0.32, longueur: 0.17, evase: 0.03, recul: 0.02, rangs: 6, pointes: 0.28 } });
      break;
    case 'milong':
      coque(M, H, { presence: (th, y) => Math.max(surLisiere(th, y, -0.005), surCotes(th, y, 0.4, PI * 0.36), frange(th, y, 0.62)),
        ep: (th, y) => 0.03 + 0.03 * dessus(y) + 0.02 * bruit(th, y),
        leve: (th, y, pr) => [0, -0.02 * devant(th) * lisse(0.72, 0.6, y) * pr, 0.015 * devant(th) * lisse(0.74, 0.6, y) * pr],
        chute: { y0: 0.4, longueur: 0.16, evase: 0.04, recul: 0.03, rangs: 6, pointes: 0.3 } });
      break;
    case 'carre':
      coque(M, H, { presence: (th, y) => Math.max(surLisiere(th, y, -0.005), surCotes(th, y, 0.44, PI * 0.3), frange(th, y, 0.6)),
        ep: (th, y) => 0.032 + 0.03 * dessus(y),
        leve: (th, y, pr) => [0, -0.028 * devant(th) * lisse(0.74, 0.6, y) * pr, 0.016 * devant(th) * lisse(0.74, 0.6, y) * pr],
        chute: { y0: 0.44, longueur: 0.12, evase: 0.025, recul: 0.0, rangs: 5, pointes: 0.04,
          forme: (P, c, v) => v > 0.8 ? [P[0] * (1 - 0.08 * (v - 0.8) * 5), P[1] + 0.012 * (v - 0.8) * 5, P[2]] : P } });
      break;
    case 'long':
      coque(M, H, { presence: (th, y) => Math.max(surLisiere(th, y, -0.005), surCotes(th, y, 0.44, PI * 0.3)),
        ep: (th, y) => 0.028 + 0.03 * dessus(y),
        chute: { y0: 0.44, longueur: 0.5, evase: 0.06, recul: 0.07, rangs: 11, pointes: 0.14 } });
      break;
    case 'boucles':
      coque(M, H, { presence: (th, y) => Math.max(surLisiere(th, y, 0.01, 0.05), surCotes(th, y, 0.42, PI * 0.38)),
        ep: (th, y) => (0.06 + 0.07 * lisse(0.3, 0.8, y)) * (0.88 + 0.24 * bruit(th * 2.4, y * 2.4)) * montee(th, y, 0.1) + 0.02,
        chute: { y0: 0.42, longueur: 0.3, evase: 0.06, gonfle: 0.025, recul: 0.07, rangs: 9, pointes: 0.2 } });
      break;
    case 'queue': {
      coque(M, H, { presence: (th, y) => surLisiere(th, y, -0.005), ep: (th, y) => (0.016 + 0.018 * dessus(y)) * montee(th, y, 0.06) });
      const b = H.monde(H.local(PI, 0.6, 0.03)), s = H.m.s;
      const pts = [b, [b[0], b[1] + 0.006, b[2] - 0.045], [b[0], b[1] - 0.05, b[2] - 0.085], [b[0], b[1] - 0.15, b[2] - 0.1], [b[0], b[1] - 0.27, b[2] - 0.09], [b[0], b[1] - 0.37, b[2] - 0.075]]
        .map(p => contourner(H, p, 0.03));
      meche(M, pts, 0.036 * s, 0.014 * s, (u) => [[O.tete, 1 - lisse(0.3, 0.9, u)], [O.poitrine, lisse(0.3, 0.9, u)]], 9);
      break;
    }
    case 'chignon': {
      coque(M, H, { presence: (th, y) => surLisiere(th, y, -0.005), ep: (th, y) => (0.016 + 0.02 * dessus(y)) * montee(th, y, 0.06) });
      boule(M, H, H.monde(H.local(PI, 0.8, 0.05)), 0.054 * H.m.s, 0.046 * H.m.s, [[O.tete, 1]]);
      break;
    }
    case 'couettes': {
      coque(M, H, { presence: (th, y) => surLisiere(th, y, -0.005), ep: (th, y) => (0.016 + 0.018 * dessus(y)) * montee(th, y, 0.06) });
      [0.75, -0.75].forEach(th => boule(M, H, H.monde(H.local(th, 0.86, 0.05)), 0.043 * H.m.s, 0.039 * H.m.s, [[O.tete, 1]]));
      break;
    }
    default: return null;
  }
  M.normales();
  return M;
}
/* Le grain des mèches, en gris : de longues stries dans le sens de la pousse,
   des frisures en petits anneaux, ou le chevron d'une tresse. */
const grains = {};
function texGrain(type){
  if (grains[type]) return grains[type];
  const W = 256, c = toile(W), g = c.getContext('2d'), rnd = graine(type.length * 977);
  g.fillStyle = '#bdbdbd'; g.fillRect(0, 0, W, W);
  if (type === 'frise'){
    for (let i = 0; i < 900; i++){
      const x = rnd() * W, y = rnd() * W, r = 2 + rnd() * 4, k = Math.round(150 + rnd() * 105);
      g.strokeStyle = `rgb(${k},${k},${k})`; g.lineWidth = 1.5;
      g.beginPath(); g.arc(x, y, r, 0, TAU * (0.6 + rnd() * 0.4)); g.stroke();
    }
  } else if (type === 'tresse'){
    for (let x = 0; x < W; x += 16){
      for (let y = 0; y < W; y += 10){
        const k = Math.round(130 + rnd() * 110);
        g.fillStyle = `rgb(${k},${k},${k})`;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + 8, y + 6); g.lineTo(x + 16, y); g.lineTo(x + 16, y + 4); g.lineTo(x + 8, y + 10); g.lineTo(x, y + 4); g.fill();
      }
      g.fillStyle = 'rgba(40,40,40,0.8)'; g.fillRect(x + 15, 0, 1.5, W);
    }
  } else {
    for (let i = 0; i < 520; i++){
      const x = rnd() * W, k = Math.round(70 + rnd() * 185), w = 0.8 + rnd() * 2.2;
      g.strokeStyle = `rgba(${k},${k},${k},0.9)`; g.lineWidth = w;
      g.beginPath(); g.moveTo(x, 0);
      for (let y = 0; y <= W; y += 32) g.lineTo(x + Math.sin(y * 0.05 + i) * 2.5, y);
      g.stroke();
    }
  }
  // le reflet : une bande plus claire, là où la lumière glisse sur les mèches
  const gr = g.createLinearGradient(0, 0, 0, W);
  gr.addColorStop(0.18, 'rgba(255,255,255,0)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.22)'); gr.addColorStop(0.42, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, W, W);
  return (grains[type] = c);
}
// les grains à la carte graphique : partagés par tous les personnages, jamais libérés
const grainsGL = {};
const texGrainGL = (type) => grainsGL[type] || (grainsGL[type] = texture(texGrain(type), false, null, true));

/* ---------------------------------------------------------------------------
   9 ter. LA GARDE-ROBE
   Un vêtement est une COQUE : les anneaux du corps, regonflés d'une aisance
   (`plus`) et DRAPÉS — le tissu tombe de la poitrine, des omoplates, du
   haut de la cuisse d'un jean large ; il ne rentre pas dans chaque creux.
   Deux règles suffisent :
   - un anneau n'est jamais plus étroit que celui du dessus, moins ce que le
     tissu peut reprendre en tombant (`drape`, surtout devant et derrière :
     sur les côtés, ce sont les manches qui tombent des épaules) ;
   - dans un anneau, on comble les creux entre deux bosses (voir
     remplirCreux) : un t-shirt passe d'un sein à l'autre, il ne suit pas le
     sillon entre les deux ; il passe par-dessus le creux du dos.
   Les coutures, le col, les boutons, les poches, les imprimés sont PEINTS
   dans la texture de la pièce ; les découpes (un col en V, les emmanchures
   d'un débardeur, le dos nu d'un maillot) aussi : la texture y est
   transparente, et le programme jette ces pixels.
   Les coordonnées de texture d'une coque de tronc : u fait le tour (0 dans
   le dos, 0,5 devant, 0,75 sur le flanc GAUCHE du personnage, donc à droite
   quand il nous fait face), v monte de l'ourlet au col.
   --------------------------------------------------------------------------- */
/* Une nappe d'anneaux déjà calculés : `rangs` [{ pts: [K+1 points], ... }],
   `o.uv(i, j)`, `o.os(i, j, P)`, `o.coul(i, j)`, `o.debut` / `o.fin`. */
function nappe(M, rangs, o){
  const n = rangs.length, K = rangs[0].pts.length - 1, idx = [];
  let inverse = false;
  if (n > 1){
    const a = rangs[0].pts[1], b = rangs[1].pts[1], c = rangs[1].pts[2];
    const nn = v3.cross(v3.sub(b, a), v3.sub(c, a));
    inverse = v3.dot(nn, v3.sub(a, rangs[0].c)) < 0;
  }
  rangs.forEach((r, i) => {
    const a0 = M.nb; idx.push(a0);
    r.pts.forEach((P, j) => M.sommet(P, o.uv(i, j), o.coul ? o.coul(i, j) : null, o.os(i, j, P)));
    if (i > 0) coudre(M, idx[i - 1], a0, K + 1, false, inverse);
  });
  const bout = (i, dir) => {
    const r = rangs[i], a = r.pts[0], b = r.pts[1];
    const nn = v3.cross(v3.sub(b, a), v3.sub(r.c, a));
    couvercle(M, idx[i], K, r.c, o.uv(i, 0), o.coul ? o.coul(i, 0) : null, o.os(i, 0, r.c), v3.dot(nn, dir) < 0);
  };
  if (o.debut) bout(0, v3.sub(rangs[0].c, rangs[1].c));
  if (o.fin) bout(n - 1, v3.sub(rangs[n - 1].c, rangs[n - 2].c));
  (M.coutures || (M.coutures = [])).push(...idx.map(a => [a, a + K]));
  return idx;
}
/* Combler les creux d'un anneau : devant, un point ne peut pas être plus en
   retrait que la plus basse des deux bosses qui l'encadrent (l'eau entre deux
   collines) ; derrière, pareil vers l'arrière. */
function remplirCreux(r){
  const moitie = (sel, sgn) => {
    const I = r.map((q, j) => j).filter(j => sel(r[j]));
    const z = I.map(j => sgn * r[j].dir[1] * r[j].rad), x = I.map(j => r[j].dir[0] * r[j].rad);
    const ordre = I.map((_, k) => k).sort((a, b) => x[a] - x[b]);
    const gauche = [], droite = [];
    let mx = -9; ordre.forEach(k => { mx = Math.max(mx, z[k]); gauche[k] = mx; });
    mx = -9; ordre.slice().reverse().forEach(k => { mx = Math.max(mx, z[k]); droite[k] = mx; });
    I.forEach((j, k) => {
      const zz = Math.max(z[k], Math.min(gauche[k], droite[k]));
      if (zz > z[k] + 1e-6){
        const X = x[k], Z = sgn * zz, l = Math.hypot(X, Z) || 1;
        r[j].rad = l; r[j].dir = [X / l, Z / l];
      }
    });
  };
  moitie(q => q.dir[1] > 0.2, 1);
  moitie(q => q.dir[1] < -0.2, -1);
}
/* LA COQUE DU TRONC, de `yb` à `yt` (hauteurs du repère). `plus` : l'aisance
   en mètres ; `drape` : combien le tissu peut rentrer en tombant, par mètre
   (petit : il tombe droit ; grand : il colle) ; `ampleBas` : un surplus de
   largeur qui s'ouvre vers l'ourlet (une chemise qui flotte). */
function tranchesHabit(m, cfg, spec){
  const s = m.s, K = 32, bosse = bossesTronc(m, cfg);
  const lst = [spec.yb, ...TRONC_Y.filter(y => y > spec.yb + 0.006 && y < spec.yt - 0.006), spec.yt].sort((a, b) => b - a);
  let prec = null, precY = 0;
  const rangs = lst.map(yr => {
    const a = anneauTronc(m, yr);
    const cy = m.Y(yr) * s, cz = a.zc * s;
    const e = 2 / a.n, r = [];
    for (let j = 0; j <= K; j++){
      const th = -PI + TAU * j / K, sn = Math.sin(th), cs = Math.cos(th);
      let x = a.rs * Math.sign(sn) * Math.pow(Math.abs(sn), e);
      let z = (cs >= 0 ? a.rf : a.rb) * Math.sign(cs) * Math.pow(Math.abs(cs), e);
      const [dx, dz] = bosse(x, yr, z);
      x += dx; z += dz;
      const l = Math.hypot(x, z) || 1;
      const u = (yr - spec.yb) / (spec.yt - spec.yb);
      const plus = (typeof spec.plus === 'function' ? spec.plus(th, yr, u) : spec.plus) + (spec.ampleBas || 0) * Math.pow(Math.max(0, 1 - u), 2);
      // l'épaule d'un haut passe PAR-DESSUS le deltoïde : sans cela l'arrondi du bras sortait du tissu
      const epaule = spec.epaule ? (0.044 + m.km * 0.014 + m.kCarrure * 0.012) * cloche(yr - 1.432, 0.038) * Math.pow(Math.abs(x / l), 3.5) : 0;
      r.push({ th, dir: [x / l, z / l], rad: l * s + plus + epaule * s });
    }
    if (prec && spec.drape != null){
      const dy = precY - cy;
      r.forEach((q, j) => {
        const d = mix(4, spec.drape, Math.pow(Math.abs(q.dir[1]), 1.5));
        q.rad = Math.max(q.rad, prec[j].rad - d * dy);
      });
    }
    remplirCreux(r);
    prec = r; precY = cy;
    return { yr, c: [0, cy, cz], pts: r.map(q => [q.dir[0] * q.rad, cy, cz + q.dir[1] * q.rad]) };
  });
  rangs.reverse();
  /* `pt(th, yr)` : le point de la coque à cet angle et cette hauteur (monde),
     interpolé entre les anneaux — de quoi découper un col ou une emmanchure
     d'après la VRAIE forme de la pièce, et non d'après la texture. */
  rangs.pt = (th, yr) => {
    let a0 = 0, b0 = rangs.length - 2;
    while (a0 < b0){ const c = (a0 + b0 + 1) >> 1; if (rangs[c].yr <= yr) a0 = c; else b0 = c - 1; }
    const i = a0;
    const a = rangs[i], b = rangs[i + 1], t = clamp((yr - a.yr) / ((b.yr - a.yr) || 1), 0, 1);
    const f = clamp((th + PI) / TAU * K, 0, K - 1e-6), j = Math.floor(f), w = f - j;
    const L = (r) => v3.lerp(r.pts[j], r.pts[j + 1], w);
    return v3.lerp(L(a), L(b), t);
  };
  return rangs;
}
/* LA DÉCOUPE ET LES BORDS, d'après la forme : `champ(x, y, z, th, yr)` rend une
   distance signée en mètres — positive, on garde ; négative, on découpe. La
   toile est parcourue sur une grille fine, le champ mis dans un calque
   qu'on agrandit en le lissant : l'alpha tombe à 0,5 sur une courbe douce,
   et le programme jette ce qui est en dessous. `bande` peint en plus une
   bordure (la bord-côte d'un col) sur les premiers millimètres. */
function masquer(g, W, H, rangs, yb, yt, champ, bande){
  const NX = 384, NY = 192;
  const mk = toile(NX, NY), gm = mk.getContext('2d'), im = gm.createImageData(NX, NY);
  const bd = bande ? toile(NX, NY) : null, ib = bd ? bd.getContext('2d').createImageData(NX, NY) : null;
  for (let j = 0; j < NY; j++){
    const yr = yt - (j + 0.5) / NY * (yt - yb);
    for (let i = 0; i < NX; i++){
      const th = -PI + TAU * (i + 0.5) / NX;
      const P = rangs.pt(th, yr);
      const d = champ(P[0], P[1], P[2], th, yr);
      const k = (j * NX + i) * 4;
      im.data[k] = im.data[k + 1] = im.data[k + 2] = 0;
      im.data[k + 3] = clamp(Math.round((0.5 + d / 0.014) * 255), 0, 255);
      if (ib){ const b = d > 0 && d < bande.l ? 1 : 0; ib.data[k] = ib.data[k + 1] = ib.data[k + 2] = 0; ib.data[k + 3] = b * 255; }
    }
  }
  if (ib){
    bd.getContext('2d').putImageData(ib, 0, 0);
    g.save(); g.globalAlpha = bande.a; g.imageSmoothingEnabled = true;
    const tmp = toile(W, H), gt = tmp.getContext('2d'); gt.imageSmoothingEnabled = true; gt.drawImage(bd, 0, 0, W, H);
    gt.globalCompositeOperation = 'source-in'; gt.fillStyle = bande.c; gt.fillRect(0, 0, W, H);
    g.drawImage(tmp, 0, 0); g.restore();
  }
  gm.putImageData(im, 0, 0);
  g.save(); g.globalCompositeOperation = 'destination-in'; g.imageSmoothingEnabled = true; g.drawImage(mk, 0, 0, W, H); g.restore();
}
/* LA COQUE D'UN MEMBRE : les anneaux de la chaîne (voir anneauxChaine) entre
   les distances d0 et d1, regonflés. `evase(u)` : un facteur de largeur le
   long de la pièce (0 en haut, 1 à l'ourlet) ; `droit` : la pièce ne rentre
   pas sous le point le plus large au-dessus d'elle (un jean droit, un baggy).
   `ourlet` : un dernier anneau rentré contre le membre — la manche se
   referme sur le bras au lieu de montrer son intérieur. */
function habitMembre(m, seg, opt, spec){
  const { anneaux, L } = anneauxChaine(m, seg, opt);
  const tot = L[0] + L[1];
  const echant = (d) => {
    let i = 0; while (i < anneaux.length - 2 && anneaux[i + 1].d < d) i++;
    const a = anneaux[i], b = anneaux[i + 1], t = clamp((d - a.d) / ((b.d - a.d) || 1), -0.5, 1.5);
    return { d, c: v3.lerp(a.c, b.c, t), t: v3.norm(v3.lerp(a.t, b.t, clamp(t, 0, 1))), rs: mix(a.rs, b.rs, t), rf: mix(a.rf, b.rf, t), rb: mix(a.rb, b.rb, t), n: a.n, avant: a.avant };
  };
  const d1 = Math.min(spec.d1, tot + 0.04);
  const ds = [spec.d0, ...anneaux.map(r => r.d).filter(d => d > spec.d0 + 0.012 && d < d1 - 0.012), d1];
  let an = ds.map(echant);
  let maxR = 0;
  an = an.map((r, i) => {
    const u = (r.d - spec.d0) / ((d1 - spec.d0) || 1);
    const k = 1 + (spec.evase ? spec.evase(u) : 0);
    let rs = r.rs * k, rf = r.rf * k, rb = r.rb * k;
    if (spec.droit){ maxR = Math.max(maxR, (rs + rf + rb) / 3 * (i === 0 ? 0.92 : 1)); const q = maxR * spec.droit; rs = Math.max(rs, q); rf = Math.max(rf, q); rb = Math.max(rb, q); }
    // l'aisance : pleine sur le membre, réduite au départ (une manche épouse l'épaule au lieu d'y faire une épaulette)
    const pl = spec.plusHaut == null ? spec.plus : mix(spec.plusHaut, spec.plus, lisse(0, 0.35, u));
    return Object.assign(r, { rs: rs + pl, rf: rf + pl, rb: rb + pl, u });
  });
  if (spec.ourlet){
    const b = echant(d1 + 0.004);
    an.push(Object.assign(b, { u: 1.02, ourlet: true, rs: b.rs * 0.98, rf: b.rf * 0.98, rb: b.rb * 0.98 }));
  }
  return { an, L, tot };
}

/* ---- les motifs ----
   Tous peints dans une toile, à la taille qu'on leur donne. `C` : la couleur
   de fond et ses compagnes. Aucun n'a de raccord visible dans le sens du
   tour (u) : ce qui sort d'un bord revient par l'autre. */
function peindreMotif(g, W, H, motif, C, rnd){
  const c0 = C[0], c1 = C[1] || C[0], c2 = C[2] || c1, c3 = C[3] || c2;
  const rep = (fn) => { fn(0); fn(-W); fn(W); };            // raccord en u
  g.fillStyle = c0; g.fillRect(0, 0, W, H);
  switch (motif){
    case 'raye': {
      const pas = H / 11;
      for (let y = pas * 0.5; y < H; y += pas){ g.fillStyle = c1; g.fillRect(0, y, W, pas * 0.42); }
      break;
    }
    case 'hawai': {
      // des feuilles d'abord, des hibiscus par-dessus
      for (let i = 0; i < 70 * W / 1024 * H / 512 + 20; i++){
        const x = rnd() * W, y = rnd() * H, a = rnd() * TAU, l = 26 + rnd() * 30;
        rep(dx => { g.save(); g.translate(x + dx, y); g.rotate(a); g.fillStyle = rnd() < 0.5 ? c2 : c3;
          g.beginPath(); g.ellipse(0, 0, l, l * 0.32, 0, 0, TAU); g.fill();
          g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 2; g.beginPath(); g.moveTo(-l, 0); g.lineTo(l, 0); g.stroke(); g.restore(); });
      }
      for (let i = 0; i < 38 * W / 1024 * H / 512 + 10; i++){
        const x = rnd() * W, y = rnd() * H, r = 14 + rnd() * 16, a = rnd() * TAU;
        rep(dx => { g.save(); g.translate(x + dx, y); g.rotate(a); g.fillStyle = c1;
          for (let p = 0; p < 5; p++){ g.rotate(TAU / 5); g.beginPath(); g.ellipse(r * 0.55, 0, r * 0.62, r * 0.42, 0, 0, TAU); g.fill(); }
          g.fillStyle = 'rgba(255,240,200,0.9)'; g.beginPath(); g.arc(0, 0, r * 0.2, 0, TAU); g.fill(); g.restore(); });
      }
      break;
    }
    case 'carreaux': {
      const pas = W / 12;
      g.globalAlpha = 0.55;
      for (let x = 0; x < W; x += pas){ g.fillStyle = c1; g.fillRect(x, 0, pas * 0.4, H); g.fillStyle = c2; g.fillRect(x + pas * 0.62, 0, pas * 0.08, H); }
      for (let y = 0; y < H; y += pas){ g.fillStyle = c1; g.fillRect(0, y, W, pas * 0.4); g.fillStyle = c2; g.fillRect(0, y + pas * 0.62, W, pas * 0.08); }
      g.globalAlpha = 1;
      break;
    }
    case 'leopard': {
      for (let i = 0; i < 260 * W / 1024 * H / 512 + 40; i++){
        const x = rnd() * W, y = rnd() * H, r = 7 + rnd() * 9;
        rep(dx => { g.fillStyle = c2; g.beginPath(); g.ellipse(x + dx, y, r * 0.8, r * 0.62, rnd() * PI, 0, TAU); g.fill();
          g.strokeStyle = c1; g.lineWidth = 3.5;
          for (let k = 0; k < 3; k++){ const a0 = rnd() * TAU; g.beginPath(); g.arc(x + dx, y, r, a0, a0 + 1.2 + rnd()); g.stroke(); } });
      }
      break;
    }
    case 'galaxie': {
      for (let i = 0; i < 26; i++){
        const x = rnd() * W, y = rnd() * H, r = 60 + rnd() * 160, k = [c1, c2, c3][i % 3];
        rep(dx => { const gr = g.createRadialGradient(x + dx, y, 0, x + dx, y, r); gr.addColorStop(0, k); gr.addColorStop(1, 'rgba(0,0,0,0)');
          g.globalAlpha = 0.5; g.fillStyle = gr; g.fillRect(x + dx - r, y - r, r * 2, r * 2); g.globalAlpha = 1; });
      }
      for (let i = 0; i < 700; i++){ g.fillStyle = `rgba(255,255,255,${0.4 + rnd() * 0.6})`; g.fillRect(rnd() * W, rnd() * H, 1.5, 1.5); }
      break;
    }
    case 'camo': {
      [c1, c2, c3].forEach(k => { for (let i = 0; i < 40 * W / 1024 * H / 512 + 10; i++){
        const x = rnd() * W, y = rnd() * H;
        rep(dx => { g.fillStyle = k; g.beginPath(); for (let a = 0; a < TAU; a += TAU / 9){ const r = 18 + rnd() * 26; g.lineTo(x + dx + Math.cos(a) * r * 1.5, y + Math.sin(a) * r); } g.fill(); });
      } });
      break;
    }
    case 'neon': {                                            // des formes de Memphis, 1986
      for (let i = 0; i < 60 * W / 1024 * H / 512 + 14; i++){
        const x = rnd() * W, y = rnd() * H, k = [c1, c2, c3][i % 3], t = rnd();
        rep(dx => { g.save(); g.translate(x + dx, y); g.rotate(rnd() * TAU); g.strokeStyle = k; g.fillStyle = k; g.lineWidth = 6;
          if (t < 0.33){ g.beginPath(); g.moveTo(-18, 12); g.lineTo(0, -16); g.lineTo(18, 12); g.closePath(); g.stroke(); }
          else if (t < 0.66){ g.beginPath(); for (let u = -24; u <= 24; u += 4) g.lineTo(u, Math.sin(u * 0.35) * 8); g.stroke(); }
          else { g.beginPath(); g.arc(0, 0, 9, 0, TAU); g.fill(); }
          g.restore(); });
      }
      break;
    }
    case 'denim': {
      for (let i = 0; i < W + H; i += 3){ g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = 1; g.beginPath(); g.moveTo(i, 0); g.lineTo(i - H, H); g.stroke(); }
      for (let i = 0; i < 3000; i++){ g.fillStyle = `rgba(255,255,255,${rnd() * 0.07})`; g.fillRect(rnd() * W, rnd() * H, 2, 1); }
      break;
    }
  }
  // le grain de l'étoffe, sur tout : quelques milliers de points presque invisibles
  for (let i = 0; i < W * H / 90; i++){ g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.05)'; g.fillRect(rnd() * W, rnd() * H, 1.5, 1.5); }
}
/* Les repères de peinture d'une coque de tronc : le point (θ, hauteur) dans
   la toile. θ : 0 devant, +π/2 le flanc gauche du personnage. */
const pinceauTronc = (W, H, yb, yt) => (th, yr) => [(th + PI) / TAU * W, (1 - (yr - yb) / (yt - yb)) * H];
const trait = (g, pts, col, l) => { g.strokeStyle = col; g.lineWidth = l; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke(); };
const poly = (g, pts, col) => { g.fillStyle = col; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.fill(); };
const decouper = (g, fn) => { g.save(); g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000'; fn(); g.restore(); };

/* ---- le catalogue ----
   Chaque pièce : son nom dans les deux langues, sa COUPE (les hauteurs du
   tronc qu'elle couvre, son aisance, ses manches), son col, et ses TEINTES —
   des jeux de couleurs [fond, motif, compagnes] que le visiteur choisit
   comme on choisit une variante dans un magasin de jeu. Les hauteurs sont
   celles du repère (voir TRONC). */
const T_UNIS = [['#f4f1ea'], ['#1c1c22'], ['#ff7eb6'], ['#8fe3cf'], ['#7ec8ff'], ['#ffd166'], ['#b8b3c4'], ['#e4572e']];
/* LES HAUTS SONT CEUX DE LA BOUTIQUE (demande du 25 sept. 2026) : les
   t-shirts, le polo, le débardeur et les sweats en vente, portés tels qu'on
   les achète (voir lirePhoto). Il ne reste à côté que trois basiques unis,
   et « aucun ». Les coupes marquées `cache` ne se choisissent pas : ce sont
   celles des articles, selon leur nature (voir coupeArticle). */
const HAUTS = {
  aucun:     { nom: { fr: 'Aucun', en: 'None' } },
  tshirt:    { nom: { fr: 'T-shirt', en: 'T-shirt' }, corps: { yb: 0.95, plus: 0.010, drape: 0.45 }, manche: { fin: 0.30, plus: 0.012, evase: 0.18 }, col: 'rond', teintes: T_UNIS },
  oversize:  { nom: { fr: 'T-shirt large', en: 'Oversized tee' }, corps: { yb: 0.88, plus: 0.022, drape: 0.25, ampleBas: 0.012 }, manche: { fin: 0.42, plus: 0.022, evase: 0.32 }, col: 'rond', teintes: T_UNIS },
  brassiere: { nom: { fr: 'Brassière', en: 'Sports bra' }, corps: { yb: 1.2, plus: 0.004, drape: 1.2 }, col: 'brassiere', teintes: [['#1c1c22'], ['#ff7eb6'], ['#8fe3cf'], ['#f4f1ea'], ['#b18cff']] },
  // le t-shirt de la boutique : carré, court, les manches larges au milieu du bras
  boxy:      { cache: true, corps: { yb: 0.955, plus: 0.018, drape: 0.32, ampleBas: 0.006 }, manche: { fin: 0.36, plus: 0.02, evase: 0.26 }, col: 'rond', serre: 1.06 },
  polo:      { cache: true, corps: { yb: 0.94, plus: 0.014, drape: 0.4 }, manche: { fin: 0.32, plus: 0.016, evase: 0.18 }, col: 'polo', serre: 1.04 },
  // le débardeur de la boutique : large d'épaules, le col rond
  tank:      { cache: true, corps: { yb: 0.95, plus: 0.014, drape: 0.4 }, col: 'tank' },
  // les sweats zippés : coupe ballon, la capuche rabattue dans le dos
  hoodie:    { cache: true, corps: { yb: 0.90, plus: 0.024, drape: 0.28 }, manche: { fin: 1.0, plus: 0.02, evase: 0.12, ourlet: true }, col: 'capuche', capuche: true, serre: 1.13 },
};
/* Les articles de la boutique qui se portent : ceux qui ont une photo, et
   que le visiteur a le droit de voir (une pièce unique pas encore gagnée
   reste sous cadenas). L'adresse d'une photo peut porter un numéro de
   révision (`?v=`, voir applyCatalogue) : deux adresses qui ne diffèrent que
   par lui désignent le même article. */
const sansVersion = (u) => String(u || '').split('?')[0];
function articlesBoutique(tous){
  const l = [];
  if (typeof DATA !== 'undefined') DATA.forEach(cat => { if (cat.kind === 'shop') cat.items.forEach(it => {
    if (!it.img) return;
    const ferme = typeof visuelDe === 'function' && visuelDe(it) !== it;
    if (tous || !ferme) l.push(it);
  }); });
  return l;
}
const portee = (it) => ({ img: it.img, img2: it.img2 || it.img, sz: it.sz });
// un article porté par défaut : le premier t-shirt de la boutique
function articleParDefaut(){
  const l = articlesBoutique();
  const it = l.find(a => a.sz !== 'hoodie' && /tee/i.test(a.n || '') && !/polo/i.test(a.n || '')) || l[0];
  return it ? portee(it) : null;
}
// la coupe d'un article, d'après son guide des tailles et son nom
function coupeArticle(b){
  const it = article(b.img), n = ((it && it.n) || b.n || '') + ' ' + sansVersion(b.img), sz = (it && it.sz) || b.sz || '';
  if (sz === 'hoodie' || /hoodie|sweat|capuche/i.test(n)) return 'hoodie';
  if (sz === 'tank' || /tank|d[ée]bardeur/i.test(n)) return 'tank';
  if (/polo/i.test(n)) return 'polo';
  return 'boxy';
}
// la coupe réellement portée
function coupeDe(T){
  if (T && T.haut === 'boutique' && T.boutique && T.boutique.img) return coupeArticle(T.boutique);
  return T && HAUTS[T.haut] && !HAUTS[T.haut].cache ? T.haut : 'tshirt';
}
const BAS = {
  aucun:    { nom: { fr: 'Aucun', en: 'None' } },
  jean:     { nom: { fr: 'Jean droit', en: 'Straight jeans' }, bassin: { yt: 1.0, plus: 0.008 }, jambe: { fin: 1.02, plus: 0.01, droit: 0.82, ourlet: true }, motif: 'denim', jean: true,
              teintes: [['#3b5b8c'], ['#23324f'], ['#7fa3c9'], ['#1c1c22'], ['#e9e5dc']] },
  baggy:    { nom: { fr: 'Jean baggy', en: 'Baggy jeans' }, bassin: { yt: 0.99, plus: 0.014 }, jambe: { fin: 1.06, plus: 0.022, droit: 1.0, evase: (u) => 0.1 * u, ourlet: true }, motif: 'denim', jean: true,
              teintes: [['#3b5b8c'], ['#1c1c22'], ['#7fa3c9'], ['#5a4a3a']] },
  shortJean:{ nom: { fr: 'Short en jean', en: 'Denim shorts' }, bassin: { yt: 1.0, plus: 0.008 }, jambe: { fin: 0.2, plus: 0.014, evase: (u) => 0.12 * u, ourlet: true }, motif: 'denim', jean: true,
              teintes: [['#7fa3c9'], ['#3b5b8c'], ['#1c1c22'], ['#f4f1ea']] },
  bain:     { nom: { fr: 'Short de bain', en: 'Board shorts' }, bassin: { yt: 1.0, plus: 0.01 }, jambe: { fin: 0.3, plus: 0.024, evase: (u) => 0.22 * u, ourlet: true }, motif: 'hawai', lacet: true,
              teintes: [['#1d6fa3', '#ff5d8f', '#2bb673', '#0d8f6f'], ['#ff7eb6', '#fff1a8', '#3fb68b', '#1e8a6a'], ['#ffd166', '#e4572e', '#2a9d8f', '#1d6f63'], ['#141418', '#ff4fa3', '#1ed6c2', '#0b8f86']] },
  costume:  { nom: { fr: 'Pantalon de costume', en: 'Suit trousers' }, bassin: { yt: 1.02, plus: 0.01 }, jambe: { fin: 1.02, plus: 0.016, droit: 0.9, ourlet: true }, pli: true,
              teintes: [['#ffc6d9'], ['#b9f0e0'], ['#f4f1ea'], ['#d9c9ff'], ['#ffe9b0'], ['#1c1c22']] },
  jogging:  { nom: { fr: 'Jogging', en: 'Sweatpants' }, bassin: { yt: 1.02, plus: 0.012 }, jambe: { fin: 0.99, plus: 0.02, droit: 0.75, evase: (u) => -0.18 * lisse(0.85, 1, u), ourlet: true }, bandes: true, lacet: true,
              teintes: [['#9a97a3', '#f4f1ea'], ['#2a2d6e', '#ff4fa3'], ['#1c1c22', '#f4f1ea'], ['#1ec7a0', '#f4f1ea']] },
  cargo:    { nom: { fr: 'Pantalon cargo', en: 'Cargo pants' }, bassin: { yt: 1.0, plus: 0.012 }, jambe: { fin: 1.02, plus: 0.02, droit: 0.9, ourlet: true }, cargo: true,
              teintes: [['#6b6a4e'], ['#1c1c22'], ['#c2b59b'], ['#a07845']] },
  pyjama:   { nom: { fr: 'Bas de pyjama', en: 'Pyjama pants' }, bassin: { yt: 1.02, plus: 0.014 }, jambe: { fin: 1.0, plus: 0.024, droit: 0.95, ourlet: true }, motif: 'carreaux', lacet: true,
              teintes: [['#f6c1dc', '#1c1c22', '#ffffff'], ['#b8d8ff', '#1f2a5a', '#ffffff'], ['#d62246', '#1c1c22', '#ffd166']] },
  leopard:  { nom: { fr: 'Pantalon léopard', en: 'Leopard pants' }, bassin: { yt: 1.0, plus: 0.012 }, jambe: { fin: 1.0, plus: 0.03, droit: 1.0, evase: (u) => 0.06 * cloche(u - 0.5, 0.25), ourlet: true }, motif: 'leopard',
              teintes: [['#c8a36b', '#3a2515', '#6b4524'], ['#e9dcc6', '#1c1c22', '#8a8a8a'], ['#ff9ec7', '#1c1c22', '#b0457a']] },
  legging:  { nom: { fr: 'Legging galaxie', en: 'Galaxy leggings' }, bassin: { yt: 1.03, plus: 0.004 }, jambe: { fin: 1.0, plus: 0.004, ourlet: true }, motif: 'galaxie',
              teintes: [['#0b0b2a', '#6a2cff', '#ff3fa4', '#27c1ff'], ['#08140f', '#1ed6c2', '#6aff8a', '#2a6cff'], ['#1a0620', '#ff7a3d', '#ff3fa4', '#ffd166']] },
  jupe:     { nom: { fr: 'Jupe', en: 'Skirt' }, jupe: { yt: 1.02, longueur: 0.33, evase: 0.12 }, teintes: [['#1c1c22'], ['#ff7eb6'], ['#f4f1ea'], ['#7ec8ff'], ['#d62246']] },
  jupePlis: { nom: { fr: 'Jupe plissée', en: 'Pleated skirt' }, jupe: { yt: 1.02, longueur: 0.36, evase: 0.18, plis: true }, motif: 'carreaux', teintes: [['#3b2a6e', '#ff7eb6', '#f4f1ea'], ['#d62246', '#1c1c22', '#ffd166'], ['#1f2a5a', '#2bb673', '#f4f1ea']] },
};
const PIEDS = {
  pieds:     { nom: { fr: 'Pieds nus', en: 'Barefoot' } },
  retro:     { nom: { fr: 'Baskets rétro', en: 'Retro sneakers' }, chaussure: { haut: 0.13, semelle: 0.03 }, teintes: [['#f4f1ea', '#e4413b', '#8e8a93'], ['#1c1c22', '#e4413b', '#f4f1ea'], ['#f4f1ea', '#1ec7a0', '#2a2d6e']] },
  toile:     { nom: { fr: 'Montantes en toile', en: 'Canvas high-tops' }, chaussure: { haut: 0.15, semelle: 0.025, toile: true }, teintes: [['#1c1c22', '#f4f1ea', '#f4f1ea'], ['#d62246', '#f4f1ea', '#f4f1ea'], ['#f4f1ea', '#f4f1ea', '#1c1c22']] },
  basket:    { nom: { fr: 'Baskets blanches', en: 'White sneakers' }, chaussure: { haut: 0.075, semelle: 0.026 }, teintes: [['#f6f4ef', '#f6f4ef', '#c9c6cf'], ['#f6f4ef', '#ff7eb6', '#f6f4ef'], ['#f6f4ef', '#2a2d6e', '#f6f4ef']] },
  mocassin:  { nom: { fr: 'Mocassins', en: 'Loafers' }, chaussure: { haut: 0.05, semelle: 0.014, cuir: true }, teintes: [['#f4f1ea', '#c9b99a', '#6b4524'], ['#6b4524', '#3a2515', '#2a1a10'], ['#ffc6d9', '#f4f1ea', '#b0457a'], ['#1c1c22', '#3a3a44', '#101014']] },
  tongs:     { nom: { fr: 'Tongs', en: 'Flip-flops' }, tongs: true, teintes: [['#ff4fa3', '#1ec7a0'], ['#1c1c22', '#f4f1ea'], ['#ffd166', '#2a9d8f']] },
  bottes:    { nom: { fr: 'Bottes', en: 'Boots' }, chaussure: { haut: 0.24, semelle: 0.035, cuir: true }, teintes: [['#1c1c22', '#101014', '#e0c070'], ['#6b4524', '#3a2515', '#c0a060'], ['#f4f1ea', '#c9c6cf', '#1c1c22']] },
};
/* Les sous-vêtements : la couche de base, toujours là sous le reste. Un
   caleçon à carreaux bleus (celui du salon d'avant, en hommage) ou un
   maillot deux-pièces. */
const DESSOUS = {
  h: { bas: { yt: 0.99, plus: 0.004, jambe: 0.1 }, teinte: ['#9fc0e8', '#2f5a9a', '#f4f1ea'], motif: 'carreaux' },
  f: { bas: { yt: 0.93, plus: 0.003, jambe: 0 }, haut: true, teinte: ['#ff5fa8', '#ffd1e6', '#ffffff'], motif: 'uni' },
};

/* ---- les pièces ----
   Chaque constructeur rend une liste de pièces : { M, toile, ... } — un
   maillage et la toile peinte de sa texture. `pers` : { m, R, cfg }. `calque`
   ajoute de l'aisance : un t-shirt porté SOUS une veste reste dessous. */
const Kt = 32;
function nappeTronc(pers, rangs, yb, yt, o){
  const M = new Maille(), m = pers.m;
  nappe(M, rangs, Object.assign({ uv: (i, j) => [j / Kt, 1 - (rangs[i].yr - yb) / (yt - yb)], os: (i, j, P) => poidsTronc(rangs[i].yr, P[0] / m.s) }, o || {}));
  return M;
}
function mancheOuJambe(M, pers, seg, opt, spec){
  const { an, L, tot } = habitMembre(pers.m, seg, opt, Object.assign({}, spec, { d1: spec.f1 * (v3.len(v3.sub(seg[0].b, seg[0].a)) + v3.len(v3.sub(seg[1].b, seg[1].a))) }));
  const K = spec.K || 14, r0 = an[0], u0 = spec.u0 || 0, uK = spec.uK || 1;
  tuyau(M, an, { K, debut: spec.debut, fin: null,
    pointe: [v3.madd(r0.c, r0.t, -(r0.rs * (spec.pointe == null ? 0.55 : spec.pointe))), null],
    os: (r) => poidsChaine(seg, opt, L, r.d),
    uv: (r, j) => [u0 + j / K * uK, clamp(r.u, 0, 1)] });
}
function construireHaut(pers, id, v, calque, force){
  const def = HAUTS[id];
  if (!def || !def.corps) return [];
  const { m, R, cfg } = pers;
  // un article de la boutique : ses photos lues (voir lirePhoto) ; tant qu'elles ne le sont pas, la coupe unie, couleur de tissu
  const A = pers.article && !calque ? pers.article : null, P = A && A.F ? A : null;
  const C = A ? [A.hex || '#55555c'] : force || (def.teintes || T_UNIS)[v % (def.teintes || T_UNIS).length];
  const yb = def.corps.yb, yt = 1.493;
  const plus = def.corps.plus + (calque || 0);
  const rangs = tranchesHabit(m, cfg, { yb, yt, plus, drape: def.corps.drape, ampleBas: def.corps.ampleBas, epaule: !!def.manche });
  const M = nappeTronc(pers, rangs, yb, yt);
  const out = [{ M, toile: P ? peindrePhotoTronc(P, def, yb, yt, 768, 384, rangs, m) : peindreHaut(def, C, yb, yt, 1024, 512, rangs, m), double: true, spec: 0.04 }];
  if (def.manche){
    const Ms = new Maille();
    // les manches d'un article ont chacune leur moitié de toile : chacune son imprimé
    ['G', 'D'].forEach(c => mancheOuJambe(Ms, pers, segBras(m, R, c), OPT_BRAS(c), { d0: -0.014, pointe: 0.15, f1: def.manche.fin, plus: def.manche.plus + (calque || 0) * 0.8, plusHaut: 0.005 + (calque || 0) * 0.6,
      evase: (u) => (def.manche.evase || 0) * Math.pow(u, 1.5), ourlet: def.manche.ourlet || def.manche.fin < 0.5, debut: 'ferme', K: 14,
      u0: P ? (c === 'G' ? 0 : 0.5) : 0, uK: P ? 0.5 : 1 }));
    out.push({ M: Ms, toile: P ? peindrePhotoManches(P, 512, 256) : peindreManche(def, C), double: true, spec: 0.04 });
  }
  // le col d'un polo : un petit anneau qui entoure le cou, rabattu
  if (def.col === 'polo'){
    const Mc = new Maille(), s = m.s;
    const bas = anneauTronc(m, 1.485), haut = anneauTronc(m, 1.51);
    const r = (a, y, k) => ({ yr: y, c: [0, m.Y(y) * s, a.zc * s], pts: Array.from({ length: Kt + 1 }, (_, j) => {
      const th = -PI + TAU * j / Kt; const [x, z] = superE({ rs: a.rs * k, rf: a.rf * k, rb: a.rb * k, n: 2.2 }, th);
      return [x * s, m.Y(y) * s, (a.zc + z) * s]; }) });
    nappe(Mc, [r(bas, 1.458, 1.62 + plus * 6), r(haut, 1.492, 1.3 + plus * 6)], { uv: (i, j) => [j / Kt, i ? 0.02 : 0.98], os: (i) => [[O.cou, i ? 0.8 : 0.4], [O.poitrine, i ? 0.2 : 0.6]] });
    const tc = toile(256, 64), g = tc.getContext('2d'); g.fillStyle = C[0]; g.fillRect(0, 0, 256, 64);
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, 0, 256, 8);
    out.push({ M: Mc, toile: tc, double: true });
  }
  if (def.capuche) out.push(...capuche(pers, C, plus));
  return out;
}
/* ---- L'ARTICLE DE LA BOUTIQUE, PORTÉ ----
   (refait le 25 sept. 2026 : la projection de face d'avant posait la capuche
   de la photo sur la poitrine, grisait les manches et rognait les lettres.)
   Le vêtement de la boutique est une PHOTO à plat, de face et de dos ; celui
   du personnage, une coque. On lit la photo comme un patron : la silhouette
   du vêtement (tout ce qui n'est pas le fond, gagné depuis les bords) ; le
   TRONC, entre les coutures des flancs — relevées en bas, là où les manches
   ne le touchent plus —, de la ligne des épaules (sous la capuche d'un
   sweat) à l'ourlet ; les deux MANCHES, chacune de sa racine contre le tronc
   à son poignet, avec sa largeur ; la couleur du TISSU, la plus fréquente
   sur le tronc. Puis on peint la toile de la coque comme celle de n'importe
   quelle pièce : le devant de la photo sur la moitié avant, le dos sur la
   moitié arrière, chaque rangée prise en proportion de la longueur d'étoffe
   du tour à cette hauteur — un imprimé garde ses proportions sur la poitrine
   au lieu de s'étirer sur les flancs. Les manches de même, déroulées : le
   dessus du bras vient du pli du dessus de la manche posée à plat. La
   capuche et le col prennent la couleur du tissu ; le col et les
   emmanchures se découpent comme ceux des autres pièces (voir masquer). */
const photos = new Map();
function chargerImage(url){
  return new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = adresse(encodeURI(url)); });
}
function lirePhoto(img){
  const k = Math.min(1, 640 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
  const W = Math.max(16, Math.round(img.naturalWidth * k)), H = Math.max(16, Math.round(img.naturalHeight * k)), N = W * H;
  const cv = toile(W, H), g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, W, H);
  const px = g.getImageData(0, 0, W, H).data;
  // 1. le fond : sa couleur, prise un peu à l'intérieur du coin (certaines photos ont un filet tout autour), et tout ce qui la touche depuis les bords
  const f0 = (4 * W + 4) * 4, F0 = px[f0], F1 = px[f0 + 1], F2 = px[f0 + 2];
  const fond = new Uint8Array(N), vu = new Uint8Array(N), pile = new Int32Array(N);
  let n = 0;
  const pousser = (i) => { if (!vu[i]){ vu[i] = 1; pile[n++] = i; } };
  for (let x = 0; x < W; x++){ pousser(x); pousser(N - W + x); }
  for (let y = 0; y < H; y++){ pousser(y * W); pousser(y * W + W - 1); }
  while (n){
    const i = pile[--n], q = i * 4;
    if (Math.abs(px[q] - F0) + Math.abs(px[q + 1] - F1) + Math.abs(px[q + 2] - F2) > 60) continue;
    fond[i] = 1;
    const x = i % W;
    if (x > 0) pousser(i - 1); if (x < W - 1) pousser(i + 1); if (i >= W) pousser(i - W); if (i < N - W) pousser(i + W);
  }
  // le liseré du bord, mêlé au fond (et les échos du JPEG) : rendu au fond, sur quatre pixels
  for (let p = 0; p < 4; p++){
    const a = fond.slice();
    for (let i = 0; i < N; i++) if (!a[i]){ const x = i % W; if ((x > 0 && a[i - 1]) || (x < W - 1 && a[i + 1]) || (i >= W && a[i - W]) || (i < N - W && a[i + W])) fond[i] = 1; }
  }
  // 2. la boîte du vêtement
  let x0 = W, x1 = -1, y0 = H, y1 = -1;
  for (let i = 0; i < N; i++) if (!fond[i]){ const x = i % W, y = (i - x) / W; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < x0 + 16 || y1 < y0 + 16) return null;
  const Wb = x1 - x0, Hb = y1 - y0, cx = Math.round((x0 + x1) / 2);
  const plein = (x, y) => !fond[y * W + x];
  // la plage de la rangée y qui contient la colonne du milieu
  const plage = (y) => { if (!plein(cx, y)) return null; let a = cx, b = cx; while (a > x0 && plein(a - 1, y)) a--; while (b < x1 && plein(b + 1, y)) b++; return [a, b]; };
  // 3. le tronc : ses flancs, relevés sur le bas, là où les plages sont les plus étroites (les manches n'y touchent plus)
  const bas = [];
  for (let y = Math.round(y0 + 0.62 * Hb); y <= Math.round(y0 + 0.9 * Hb); y++){ const p = plage(y); if (p) bas.push(p); }
  if (bas.length < 4) return null;
  const larg = bas.map(p => p[1] - p[0]).sort((a, b) => a - b), seuil = larg[Math.floor(larg.length * 0.35)];
  const med = (l) => l.slice().sort((a, b) => a - b)[l.length >> 1];
  const etroits = bas.filter(p => p[1] - p[0] <= seuil);
  const xl = med(etroits.map(p => p[0])), xr = med(etroits.map(p => p[1]));
  // l'ourlet : la dernière rangée où le tronc a encore sa largeur
  let yh = y1;
  for (let y = y1; y > y0; y--){ const p = plage(y); if (p && p[1] - p[0] > 0.5 * (xr - xl)){ yh = y; break; } }
  // le haut : la première rangée où le vêtement s'élargit — les épaules, sous la capuche d'un sweat
  let yn = y0;
  for (let y = y0; y < yh; y++){
    let a = -1, b = -1;
    for (let x = x0; x <= x1; x++) if (plein(x, y)){ if (a < 0) a = x; b = x; }
    if (a >= 0 && b - a > 0.42 * Wb){ yn = y; break; }
  }
  // les flancs de chaque rangée : la plage du milieu, bornée aux coutures (les manches collées au tronc n'en sont pas)
  const gauche = new Float32Array(H), droite = new Float32Array(H);
  for (let y = 0; y < H; y++){
    const p = y >= yn && y <= yh ? plage(y) : null;
    gauche[y] = p ? Math.max(xl, p[0]) : xl; droite[y] = p ? Math.min(xr, p[1]) : xr;
    if (droite[y] - gauche[y] < 0.3 * (xr - xl)){ gauche[y] = xl; droite[y] = xr; }
  }
  // 4. le tissu : la couleur la plus fréquente sur le tronc (la moyenne mêlerait l'imprimé : un sweat noir aux lettres blanches deviendrait gris)
  const hist = new Map();
  for (let y = yn; y <= yh; y += 2) for (let x = xl; x <= xr; x += 2){
    const i = y * W + x; if (fond[i]) continue;
    const q = i * 4, c = ((px[q] >> 4) << 8) | ((px[q + 1] >> 4) << 4) | (px[q + 2] >> 4);
    const e = hist.get(c); if (e){ e[0]++; e[1] += px[q]; e[2] += px[q + 1]; e[3] += px[q + 2]; } else hist.set(c, [1, px[q], px[q + 1], px[q + 2]]);
  }
  let best = null; for (const e of hist.values()) if (!best || e[0] > best[0]) best = e;
  const tissu = best ? [Math.round(best[1] / best[0]), Math.round(best[2] / best[0]), Math.round(best[3] / best[0])] : [128, 128, 128];
  // 5. les manches : chacune de sa racine, contre le tronc, à son poignet (le point le plus loin de la racine)
  const manche = (cote) => {
    const bord = cote < 0 ? xl - 3 : xr + 3, pts = [];
    for (let y = y0; y <= y1; y += 2) for (let x = cote < 0 ? x0 : bord; x <= (cote < 0 ? bord : x1); x += 2) if (plein(x, y)) pts.push(x, y);
    const nb = pts.length / 2;
    if (nb < 0.003 * Wb * Hb) return null;
    let ry = 0, rk = 0, ytop = H, ybot = -1;
    for (let k = 0; k < nb; k++) if (Math.abs(pts[k * 2] - bord) <= 4){ const y = pts[k * 2 + 1]; ry += y; rk++; if (y < ytop) ytop = y; if (y > ybot) ybot = y; }
    if (!rk) return null;
    // la racine ne descend pas plus bas que l'aisselle : la manche d'un sweat longe le tronc sans y être cousue
    const R = [bord, Math.min(ry / rk, ytop + 0.5 * Math.min(ybot - ytop, 0.22 * Hb))];
    const d = new Float32Array(nb);
    for (let k = 0; k < nb; k++) d[k] = Math.hypot(pts[k * 2] - R[0], pts[k * 2 + 1] - R[1]);
    const d94 = Float32Array.from(d).sort()[Math.floor(nb * 0.94)];
    let sx = 0, sy = 0, sk = 0;
    for (let k = 0; k < nb; k++) if (d[k] >= d94){ sx += pts[k * 2]; sy += pts[k * 2 + 1]; sk++; }
    const C = [sx / sk, sy / sk], L = Math.hypot(C[0] - R[0], C[1] - R[1]) || 1, ax = [(C[0] - R[0]) / L, (C[1] - R[1]) / L];
    // la normale de la manche, vers le dehors et le haut : le pli du dessus
    let nn = [-ax[1], ax[0]];
    if (nn[0] * cote - nn[1] < 0) nn = [-nn[0], -nn[1]];
    const off = [];
    for (let k = 0; k < nb; k++){
      const vx = pts[k * 2] - R[0], vy = pts[k * 2 + 1] - R[1], le = vx * ax[0] + vy * ax[1];
      if (le > 0.25 * L && le < 0.8 * L) off.push(Math.abs(vx * nn[0] + vy * nn[1]));
    }
    off.sort((a, b) => a - b);
    return { R, C, n: nn, hw: Math.max(2, off.length ? off[Math.floor(off.length * 0.97)] : 0.1 * Wb) };
  };
  const manches = [manche(-1), manche(1)];
  /* 6. le fond devient du tissu : ce qu'on irait chercher hors du vêtement en
     prend la couleur. Et les plis de la photo s'estompent : sur le personnage,
     c'est la lumière de la scène qui les fait, ceux de la photo à plat y
     faisaient des taches. L'imprimé, loin de la couleur du tissu, n'y est pas
     touché. */
  for (let i = 0; i < N; i++){
    const q = i * 4;
    if (fond[i]){ px[q] = tissu[0]; px[q + 1] = tissu[1]; px[q + 2] = tissu[2]; px[q + 3] = 255; continue; }
    const e = Math.abs(px[q] - tissu[0]) + Math.abs(px[q + 1] - tissu[1]) + Math.abs(px[q + 2] - tissu[2]);
    if (e < 70){ const k = mix(0.35, 1, e / 70); for (let c = 0; c < 3; c++) px[q + c] = tissu[c] + (px[q + c] - tissu[c]) * k; }
  }
  return { W, H, px, xl, xr, yn, yh, gauche, droite, tissu, manches };
}
/* Les deux photos d'un article, lues une fois. Quatre articles en mémoire au
   plus : une photo lue pèse un ou deux mégaoctets. `p.pret` : déjà lues —
   le prochain personnage les prend sans attendre. */
function photosArticle(url, url2){
  const cle = url + '|' + url2;
  if (photos.has(cle)){ const p = photos.get(cle); photos.delete(cle); photos.set(cle, p); return p; }
  const p = Promise.all([chargerImage(url), chargerImage(url2 || url).catch(() => null)]).then(([a, b]) => {
    const F = lirePhoto(a);
    if (!F) throw new Error('photo illisible');
    const B = (b && lirePhoto(b)) || F;
    return (p.pret = { F, B, hex: '#' + F.tissu.map(v => v.toString(16).padStart(2, '0')).join('') });
  });
  p.catch(() => { p.rate = true; });
  photos.set(cle, p);
  while (photos.size > 4) photos.delete(photos.keys().next().value);
  return p;
}
// un point de la photo, en bilinéaire
function echantillon(P, x, y, d, o){
  const W = P.W, px = P.px;
  x = clamp(x, 0, W - 1.001); y = clamp(y, 0, P.H - 1.001);
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = (y0 * W + x0) * 4, j = i + W * 4;
  for (let c = 0; c < 3; c++){
    const a = px[i + c] + (px[i + 4 + c] - px[i + c]) * fx, b = px[j + c] + (px[j + 4 + c] - px[j + c]) * fx;
    d[o + c] = a + (b - a) * fy;
  }
  d[o + 3] = 255;
}
/* La toile du tronc : colonne par colonne, l'angle du tour ; rangée par
   rangée, la longueur d'étoffe de chaque moitié à cette hauteur. */
function peindrePhotoTronc(A, def, yb, yt, W, H, rangs, m){
  const c = toile(W, H), g = c.getContext('2d'), im = g.createImageData(W, H), d = im.data, F = A.F, B = A.B;
  const NS = 24, NT = 48, serre = def.serre || 1, enTour = (t) => t > PI ? t - TAU : t;
  /* La part de chaque colonne dans la largeur de la photo, relevée à NT
     hauteurs (entre deux, on mêle) : un tiers la longueur d'étoffe depuis le
     flanc, surtout la largeur vue de face. La seule longueur d'étoffe
     enroulait les bords d'un grand imprimé autour des flancs (« HUNT
     PEOPL ») : un vêtement ample tombe droit sur les côtés au lieu
     d'épouser le torse. Et l'imprimé se resserre un peu vers le milieu
     (`serre`) : les bras, qui pendent le long du corps, cachent les flancs ;
     ceux-ci prennent l'étoffe du bord de la photo.
     Le devant va du flanc droit (−π/2) au gauche par la poitrine — sur la
     photo de face, de gauche à droite — ; le dos, du flanc gauche au droit —
     sur celle de dos, de gauche à droite aussi. */
  const L = new Float32Array(NS + 1), X = new Float32Array(NS + 1), x0 = W >> 2, x1 = (3 * W) >> 2;
  const carte = [];
  for (let k = 0; k <= NT; k++){
    const yr = yt - k / NT * (yt - yb), f = new Float32Array(W);
    for (let moitie = 0; moitie < 2; moitie++){
      const th0 = moitie ? PI / 2 : -PI / 2, sg = moitie ? -1 : 1;
      let prec = rangs.pt(th0, yr); L[0] = 0; X[0] = prec[0] * sg;
      for (let j = 1; j <= NS; j++){ const q = rangs.pt(enTour(th0 + PI * j / NS), yr); L[j] = L[j - 1] + v3.len(v3.sub(q, prec)); X[j] = q[0] * sg; prec = q; }
      const lt = L[NS] || 1, xt = (X[NS] - X[0]) || 1;
      for (let x = moitie ? 0 : x0; x < (moitie ? W : x1); x++){
        if (moitie && x >= x0 && x < x1) continue;
        let th = -PI + TAU * (x + 0.5) / W;
        if (moitie && th < 0) th += TAU;
        const t = clamp((th - th0) / PI, 0, 1) * NS, i = Math.min(NS - 1, t | 0), w = t - i;
        const a = (L[i] + (L[i + 1] - L[i]) * w) / lt, b = (X[i] + (X[i + 1] - X[i]) * w - X[0]) / xt;
        f[x] = clamp((0.35 * a + 0.65 * b - 0.5) * serre + 0.5, 0, 1);
      }
    }
    carte.push(f);
  }
  for (let y = 0; y < H; y++){
    const v = (y + 0.5) / H, kk = v * NT, k0 = Math.min(NT - 1, kk | 0), w = kk - k0, f0 = carte[k0], f1 = carte[k0 + 1];
    const fy = F.yn + v * (F.yh - F.yn), by = B.yn + v * (B.yh - B.yn);
    const fr = clamp(Math.round(fy), 0, F.H - 1), br = clamp(Math.round(by), 0, B.H - 1);
    const fg = F.gauche[fr], fl = F.droite[fr] - fg, bg = B.gauche[br], bl = B.droite[br] - bg;
    for (let x = 0; x < W; x++){
      const f = f0[x] + (f1[x] - f0[x]) * w, o = (y * W + x) * 4;
      if (x >= x0 && x < x1) echantillon(F, fg + f * fl, fy, d, o);
      else echantillon(B, bg + f * bl, by, d, o);
    }
  }
  g.putImageData(im, 0, 0);
  const [champ, bande] = decoupeHaut(def, m);
  if (champ) masquer(g, W, H, rangs, yb, yt, champ, bande);
  return c;
}
/* La toile des manches : le bras gauche sur la moitié gauche, le droit sur
   l'autre. Autour de la manche (u), l'angle du tour — 0 devant, ±π derrière,
   +π/2 vers la gauche du personnage — ; le long (v), de l'épaule au poignet. */
function peindrePhotoManches(A, W, H){
  const c = toile(W, H), g = c.getContext('2d'), im = g.createImageData(W, H), d = im.data, Wm = W / 2;
  // de face, la manche gauche du personnage est à droite de la photo ; de dos, à gauche
  const bras = [{ F: A.F.manches[1], B: A.B.manches[0], lat: 1 }, { F: A.F.manches[0], B: A.B.manches[1], lat: -1 }];
  const tissu = (P, o) => { d[o] = P.tissu[0]; d[o + 1] = P.tissu[1]; d[o + 2] = P.tissu[2]; d[o + 3] = 255; };
  for (let y = 0; y < H; y++){
    const le = (y + 0.5) / H;
    for (let x = 0; x < W; x++){
      const b = bras[x < Wm ? 0 : 1], th = -PI + TAU * (((x % Wm) + 0.5) / Wm), o = (y * W + x) * 4;
      const devant = Math.abs(th) <= PI / 2, P = devant ? A.F : A.B, S = devant ? b.F : b.B;
      if (!S){ tissu(P, o); continue; }
      // en travers : 0 sous le bras, 1 dessus
      let a = devant ? (th + PI / 2) / PI : th > 0 ? 1.5 - th / PI : -0.5 - th / PI;
      if (b.lat < 0) a = 1 - a;
      const k = (a - 0.5) * 2 * S.hw;
      const px = S.R[0] + (S.C[0] - S.R[0]) * le + S.n[0] * k, py = S.R[1] + (S.C[1] - S.R[1]) * le + S.n[1] * k;
      // une manche n'emprunte pas l'imprimé de la poitrine
      if (px > P.xl + 1 && px < P.xr - 1 && py > P.yn && py < P.yh) tissu(P, o);
      else echantillon(P, px, py, d, o);
    }
  }
  g.putImageData(im, 0, 0);
  return c;
}
/* La capuche, rabattue dans le dos : une poche de tissu posée sur les
   omoplates, le bord relevé autour du cou. */
function capuche(pers, C, plus){
  const { m } = pers, s = m.s, M = new Maille();
  const N = 7, K = 16, idx = [];
  for (let i = 0; i <= N; i++){
    const u = i / N, a0 = M.nb; idx.push(a0);
    for (let j = 0; j <= K; j++){
      const v = j / K, th = PI * (0.6 + 0.8 * v);              // d'une omoplate à l'autre, par le dos
      const yr = mix(1.485, 1.30, u);
      const a = anneauTronc(m, Math.min(yr, 1.47));
      const [x, z] = superE({ rs: a.rs, rf: a.rf, rb: a.rb, n: a.n }, th);
      const bord = Math.sin(v * PI);
      const eps = plus + 0.006 + 0.026 * Math.sin(Math.min(1, u * 1.2) * PI) * bord + 0.012 * (1 - u) * bord;
      const l = Math.hypot(x, z) || 1;
      const X = x / l * (l * s + eps), Z = z / l * (l * s + eps);
      M.sommet([X, m.Y(yr) * s + 0.02 * (1 - u) * bord, a.zc * s + Z], [v, u], null, poidsTronc(yr, X / s));
    }
    if (i > 0) coudre(M, idx[i - 1], a0, K + 1, false, false);
  }
  M.normales();
  const t = toile(256, 256), g = t.getContext('2d');
  g.fillStyle = C[0]; g.fillRect(0, 0, 256, 256);
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 0, 256, 10);            // la doublure au bord
  g.strokeStyle = 'rgba(0,0,0,0.2)'; g.lineWidth = 2; g.beginPath(); g.moveTo(128, 0); g.lineTo(128, 256); g.stroke();
  return [{ M, toile: t, double: true }];
}
/* Le col et les emmanchures d'un haut, d'après sa forme (voir masquer) : le
   champ — positif on garde, négatif on découpe — et la bordure peinte le
   long. */
function decoupeHaut(def, m){
  const s = m.s;
  const cou = anneauTronc(m, 1.49), zCou = anneauTronc(m, 1.5).zc * s;
  const rCou = (phi) => { const [x, z] = superE({ rs: cou.rs, rf: cou.rf, rb: cou.rb, n: cou.n }, phi); return Math.hypot(x, z) * s; };
  const col = (creux, marge) => (x, y, z) => {
    const dz = z - zCou, d = Math.hypot(x, dz), phi = Math.atan2(x, dz);
    return d - (rCou(phi) + marge * s + creux * s * Math.pow(Math.max(0, Math.cos(phi)), 2));
  };
  switch (def.col){
    case 'rond': case 'capuche':
      return [col(def.col === 'capuche' ? 0.012 : 0.028, 0.012), { l: 0.013, c: 'rgba(0,0,0,1)', a: 0.2 }];
    case 'polo':                                   // l'encolure se cache sous le col rabattu
      return [col(0.004, 0.006), null];
    case 'tank': {
      // les emmanchures d'un débardeur carré : larges, découpées au-delà du haut de l'épaule
      const cc = col(0.03, 0.014);
      return [(x, y, z, th, yr) => Math.min(cc(x, y, z), Math.max((0.152 - Math.abs(x) / s) * s, (1.29 - yr) * s * 0.8)), { l: 0.01, c: 'rgba(0,0,0,1)', a: 0.18 }];
    }
    case 'brassiere':
      return [(x, y, z, th, yr) => Math.max((1.35 - yr) * s, (0.021 - Math.abs(Math.abs(x) / s - 0.078)) * s), { l: 0.008, c: 'rgba(0,0,0,1)', a: 0.2 }];
  }
  return [null, null];
}
/* La toile d'un haut uni : le motif, l'ourlet et les coutures des flancs,
   puis la découpe du col (voir decoupeHaut). */
function peindreHaut(def, C, yb, yt, W, H, rangs, m){
  const c = toile(W, H), g = c.getContext('2d'), rnd = graine(W + H + (C[0] || '').length * 131);
  peindreMotif(g, W, H, def.motif || 'uni', C, rnd);
  const P = pinceauTronc(W, H, yb, yt), fonce = 'rgba(0,0,0,0.16)';
  { const [, y] = P(0, yb + (def.col === 'brassiere' ? 0.03 : 0.02)); g.fillStyle = def.col === 'brassiere' ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.08)'; g.fillRect(0, y, W, H - y); trait(g, [[0, y], [W, y]], fonce, 2); }
  [PI / 2, -PI / 2].forEach(th => { const [x] = P(th, 0); trait(g, [[x, 0], [x, H]], 'rgba(0,0,0,0.12)', 2); });
  const [champ, bande] = decoupeHaut(def, m);
  if (champ) masquer(g, W, H, rangs, yb, yt, champ, bande);
  return c;
}
function peindreManche(def, C){
  const W = 512, H = 256, c = toile(W, H), g = c.getContext('2d'), rnd = graine(C[0].length * 77 + W);
  peindreMotif(g, W, H, def.motif || 'uni', C, rnd);
  // l'ourlet, ou le poignet
  const y = H * 0.93;
  g.fillStyle = 'rgba(0,0,0,0.14)'; g.fillRect(0, y, W, H);
  trait(g, [[0, y], [W, y]], 'rgba(0,0,0,0.2)', 2);
  return c;
}
/* ---- le bas ---- */
function construireBas(pers, id, v){
  const def = BAS[id];
  if (!def || (!def.bassin && !def.jupe)) return [];
  const { m, R, cfg } = pers, C = def.teintes[v % def.teintes.length];
  if (def.jupe) return construireJupe(pers, def, C);
  const yb = 0.795, yt = def.bassin.yt;
  const rangs = tranchesHabit(m, cfg, { yb, yt, plus: def.bassin.plus, drape: 3 });
  const M = nappeTronc(pers, rangs, yb, yt, { debut: 'ferme' });
  const out = [{ M, toile: peindreBassin(def, C, yb, yt), double: true, spec: def.jean ? 0.03 : 0.05 }];
  const Mj = new Maille();
  ['G', 'D'].forEach(c => mancheOuJambe(Mj, pers, segJambe(m, R, c), OPT_JAMBE(c), { d0: -0.075, f1: def.jambe.fin, plus: def.jambe.plus, droit: def.jambe.droit,
    evase: def.jambe.evase, ourlet: def.jambe.ourlet, debut: 'ferme', K: 16 }));
  out.push({ M: Mj, toile: peindreJambe(def, C), double: true, spec: def.jean ? 0.03 : 0.05 });
  return out;
}
function peindreBassin(def, C, yb, yt){
  const W = 1024, H = 256, c = toile(W, H), g = c.getContext('2d'), rnd = graine(C[0].length * 31 + 7);
  peindreMotif(g, W, H, def.motif || 'uni', C, rnd);
  const P = pinceauTronc(W, H, yb, yt), piqure = def.jean ? 'rgba(232,160,70,0.9)' : 'rgba(0,0,0,0.25)';
  // la ceinture
  const [, yc] = P(0, yt - 0.035);
  g.fillStyle = 'rgba(0,0,0,0.1)'; g.fillRect(0, 0, W, yc);
  trait(g, [[0, yc], [W, yc]], piqure, 2);
  if (def.jean){
    // les passants, la braguette en J, les poches avant et arrière, les rivets
    [-2.7, -1.6, -0.62, 0.62, 1.6, 2.7, PI].forEach(th => { const [x] = P(th, 0); g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x - 5, 0, 10, yc + 4); });
    const f = [P(0.03, yt - 0.035), P(0.03, yt - 0.14), P(-0.03, yt - 0.16)];
    trait(g, f, piqure, 2);
    [1, -1].forEach(sg => {
      const p = [P(sg * 0.42, yt - 0.035), P(sg * 0.62, yt - 0.1), P(sg * 0.78, yt - 0.115)];
      trait(g, p, piqure, 2.5);
      g.fillStyle = '#d9b36a'; const [rx, ry] = P(sg * 0.62, yt - 0.1); g.beginPath(); g.arc(rx, ry, 3, 0, TAU); g.fill();
      const q = [P(sg * 2.2, yt - 0.06), P(sg * 2.75, yt - 0.06), P(sg * 2.72, yt - 0.15), P(sg * 2.48, yt - 0.17), P(sg * 2.23, yt - 0.15)];
      trait(g, q.concat([q[0]]), piqure, 2);
    });
  }
  if (def.lacet){ const [x, y] = P(0, yt - 0.03); trait(g, [[x - 6, y], [x - 10, y + 36]], '#f4f1ea', 4); trait(g, [[x + 6, y], [x + 11, y + 32]], '#f4f1ea', 4); }
  if (def.pli || def.cargo) { const [x] = P(0, 0); trait(g, [[x, yc], [x, H]], 'rgba(0,0,0,0.2)', 1.5); }
  if (def.bandes) [PI / 2, -PI / 2].forEach(th => { const [x] = P(th, 0); g.fillStyle = C[1]; g.fillRect(x - 7, yc, 5, H); g.fillRect(x + 2, yc, 5, H); });
  return c;
}
function peindreJambe(def, C){
  const W = 512, H = 512, c = toile(W, H), g = c.getContext('2d'), rnd = graine(C[0].length * 17 + 3);
  peindreMotif(g, W, H, def.motif || 'uni', C, rnd);
  const piqure = def.jean ? 'rgba(232,160,70,0.9)' : 'rgba(0,0,0,0.22)';
  // la couture extérieure et l'intérieure (u = 0,25 et 0,75 : les côtés de l'anneau)
  [0.25, 0.75].forEach(u => trait(g, [[u * W, 0], [u * W, H]], piqure, 2));
  if (def.jean){                                             // le délavé : plus clair devant, sur la cuisse et au genou
    const gr = g.createRadialGradient(W * 0.5, H * 0.35, 0, W * 0.5, H * 0.35, H * 0.45);
    gr.addColorStop(0, 'rgba(255,255,255,0.2)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
  }
  if (def.bandes){ g.fillStyle = C[1]; g.fillRect(W * 0.25 - 12, 0, 8, H); g.fillRect(W * 0.25 + 4, 0, 8, H); g.fillRect(W * 0.75 - 12, 0, 8, H); g.fillRect(W * 0.75 + 4, 0, 8, H); }
  if (def.pli) trait(g, [[W * 0.5, 0], [W * 0.5, H]], 'rgba(0,0,0,0.18)', 1.5);
  if (def.cargo) [0.25, 0.75].forEach(u => { const x = u * W, y = H * 0.32; poly(g, [[x - 40, y], [x + 40, y], [x + 40, y + 90], [x - 40, y + 90]], 'rgba(0,0,0,0.12)'); trait(g, [[x - 40, y], [x + 40, y], [x + 40, y + 90], [x - 40, y + 90], [x - 40, y]], 'rgba(0,0,0,0.3)', 2); trait(g, [[x - 42, y + 22], [x + 42, y + 22]], 'rgba(0,0,0,0.3)', 2); });
  // l'ourlet
  const yo = H * 0.95; g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, yo, W, H - yo); trait(g, [[0, yo], [W, yo]], piqure, 2);
  return c;
}
/* LA JUPE : un cône du bassin à l'ourlet, qui passe autour des deux jambes au
   lieu de les suivre. Sa peau glisse du bassin vers la cuisse de son côté,
   de plus en plus vers le bas : quand une jambe avance, la jupe la suit. */
function construireJupe(pers, def, C){
  const { m, cfg } = pers, s = m.s, J = def.jupe, K = Kt, M = new Maille();
  const N = 8, rangs = [];
  for (let i = 0; i <= N; i++){
    const u = i / N, yr = J.yt - u * J.longueur;
    const a = anneauTronc(m, Math.max(0.8, yr));
    const pts = [];
    for (let j = 0; j <= K; j++){
      const th = -PI + TAU * j / K;
      const rs = Math.max(a.rs, 0.13 + 0.1 * lisse(0.95, 0.75, yr)) + J.evase * u * 0.8;
      const rf = Math.max(a.rf, 0.09) + J.evase * u * 0.5, rb = Math.max(a.rb, 0.10) + J.evase * u * 0.5;
      let [x, z] = superE({ rs, rf, rb, n: 2.3 }, th);
      const pli = J.plis ? 1 + 0.035 * Math.abs(Math.sin(th * 12)) * lisse(0, 0.3, u) : 1;
      pts.push([x * s * pli + Math.sign(x) * 0.006, m.Y(yr) * s, (a.zc + z) * s * pli + Math.sign(z) * 0.006]);
    }
    rangs.push({ yr, u, c: [0, m.Y(yr) * s, a.zc * s], pts });
  }
  nappe(M, rangs, { uv: (i, j) => [j / K, rangs[i].u],
    os: (i, j, P) => { const u = rangs[i].u, x = P[0] / s, w = lisse(0.02, 0.12, Math.abs(x)) * lisse(0.25, 1, u) * 0.7;
      return [[O.bassin, 1 - w], [O[x > 0 ? 'cuisseG' : 'cuisseD'], w]]; } });
  const W = 1024, H = 256, c = toile(W, H), g = c.getContext('2d');
  peindreMotif(g, W, H, def.motif || 'uni', C, graine(5));
  g.fillStyle = 'rgba(0,0,0,0.14)'; g.fillRect(0, 0, W, 22);
  if (J.plis) for (let k = 0; k < 24; k++){ const x = k / 24 * W; trait(g, [[x, 22], [x, H]], 'rgba(0,0,0,0.12)', 2); }
  return [{ M, toile: c, double: true }];
}

/* ---- les chaussures ----
   Un coussin autour du pied, à semelle plate, le bout arrondi ; une TIGE qui
   monte sur la cheville pour une montante ou une botte. Les lacets, la
   semelle, les bandes du côté sont peints. */
function construireChaussures(pers, id, v){
  const def = PIEDS[id];
  if (!def || (!def.chaussure && !def.tongs)) return [];
  const { m, R } = pers, s = m.s, C = def.teintes[v % def.teintes.length];
  if (def.tongs) return construireTongs(pers, C);
  const Ch = def.chaussure, M = new Maille();
  const FORME = [
    // z, demi-largeur, dessus
    [-0.068, 0.030, 0.040], [-0.060, 0.041, 0.066], [-0.040, 0.047, 0.082], [0.0, 0.049, 0.088], [0.045, 0.053, 0.070],
    [0.09, 0.057, 0.056], [0.13, 0.058, 0.047], [0.168, 0.053, 0.040], [0.196, 0.043, 0.034], [0.214, 0.026, 0.025],
  ];
  ['G', 'D'].forEach(c => {
    const sg = c === 'G' ? 1 : -1, ch = R[O['pied' + c]];
    const an = FORME.map(([z, w, h], i) => ({ t: [0, 0, 1], avant: [0, 1, 0], c: [ch[0] + sg * 0.004 * s * (z > 0.1 ? 1 : 0), (Ch.semelle * 0.5 + h * 0.5) * s * 0.9, ch[2] + z * s],
      rs: (w + (Ch.cuir ? 0.002 : 0.004)) * s, rf: h * 0.5 * s + 0.004, rb: (h * 0.5 + Ch.semelle * 0.5) * s, n: 2.8, z, i }));
    tuyau(M, an, { K: 14, debut: 'ferme', fin: 'ferme',
      point: (r, th, x, z, P) => [P[0], Math.max(0.001, P[1]), P[2]],
      uv: (r, j) => [j / 14, r.i / (FORME.length - 1)],
      os: (r) => r.z < 0.1 ? [[O['pied' + c], 1]] : jointure(O['pied' + c], O['orteils' + c], (r.z - 0.125) * s, 0.02) });
    if (Ch.haut > 0.09){
      // la tige : de la cheville jusqu'à `haut`, autour du bas de la jambe
      const seg = segJambe(m, R, c), { anneaux } = anneauxChaine(m, seg, OPT_JAMBE(c));
      const bas = anneaux.filter(r => r.c[1] < Ch.haut * s + 0.02 && r.c[1] > 0.05 * s);
      const tige = [{ c: [ch[0], 0.07 * s, ch[2] - 0.004], t: [0, 1, 0], avant: [0, 0, 1], rs: 0.047 * s, rf: 0.05 * s, rb: 0.05 * s, n: 2.2, i: 0 }]
        .concat(bas.reverse().map((r, k) => ({ c: r.c, t: v3.mul(r.t, -1), avant: [0, 0, 1], rs: r.rs + 0.009, rf: r.rf + 0.009, rb: r.rb + 0.009, n: 2.2, i: k + 1 })));
      if (tige.length > 1) tuyau(M, tige, { K: 14, uv: (r, j) => [j / 14, 1], os: (r) => jointure(O['pied' + c], O['tibia' + c], r.c[1] - 0.1 * s, 0.03) });
    }
  });
  M.normales(); souder(M);
  // la toile : la semelle en bas (le bas de l'anneau, autour de u = 0,5… : l'anneau part de l'arrière)
  const W = 512, H = 256, t = toile(W, H), g = t.getContext('2d');
  g.fillStyle = C[0]; g.fillRect(0, 0, W, H);
  if (Ch.toile){ for (let i = 0; i < 2000; i++){ g.fillStyle = 'rgba(0,0,0,0.05)'; g.fillRect(Math.random() * W, Math.random() * H, 2, 1); } }
  // le dessus (autour de u = 0,5 : l'avant du repère de l'anneau est vers le haut)
  g.fillStyle = C[1]; g.fillRect(W * 0.34, H * 0.15, W * 0.32, H * 0.55);          // la languette
  for (let k = 0; k < 5; k++){ const y = H * (0.2 + k * 0.1); trait(g, [[W * 0.4, y], [W * 0.6, y + 8]], C[2] || '#f4f1ea', 5); trait(g, [[W * 0.6, y], [W * 0.4, y + 8]], C[2] || '#f4f1ea', 5); }
  if (!Ch.cuir && !Ch.toile){ [0.2, 0.8].forEach(u => { poly(g, [[W * (u - 0.06), H * 0.3], [W * (u + 0.06), H * 0.45], [W * (u + 0.06), H * 0.6], [W * (u - 0.06), H * 0.45]], C[1]); }); }
  // la semelle : les bords bas de l'anneau (u proche de 0 et de 1, et le dessous)
  g.fillStyle = C[2] || '#f4f1ea';
  g.fillRect(0, 0, W * 0.14, H); g.fillRect(W * 0.86, 0, W * 0.14, H);
  if (Ch.toile){ g.fillStyle = '#f4f1ea'; g.fillRect(0, H * 0.82, W, H * 0.18); }
  return [{ M, toile: t, spec: Ch.cuir ? 0.4 : 0.12, cachePieds: true }];
}
function construireTongs(pers, C){
  const { m, R } = pers, s = m.s, M = new Maille();
  ['G', 'D'].forEach(c => {
    const sg = c === 'G' ? 1 : -1, ch = R[O['pied' + c]];
    const an = [[-0.07, 0.036], [-0.02, 0.046], [0.05, 0.052], [0.12, 0.058], [0.18, 0.052], [0.215, 0.034]].map(([z, w], i) => ({
      t: [0, 0, 1], avant: [0, 1, 0], c: [ch[0] + sg * 0.004 * s * (z > 0.1 ? 1 : 0), 0.006 * s, ch[2] + z * s], rs: w * s, rf: 0.006 * s, rb: 0.006 * s, n: 3, z, i }));
    tuyau(M, an, { K: 10, debut: 'ferme', fin: 'ferme', uv: () => [0.25, 0.5], os: (r) => r.z < 0.1 ? [[O['pied' + c], 1]] : jointure(O['pied' + c], O['orteils' + c], (r.z - 0.125) * s, 0.02) });
    // la bride en Y, entre les orteils
    const orteil = [ch[0] + sg * 0.006 * s, 0.014 * s, ch[2] + 0.15 * s];
    [1, -1].forEach(k => meche(M, [orteil, [ch[0] + (sg * 0.004 + k * 0.03) * s, 0.04 * s, ch[2] + 0.07 * s], [ch[0] + k * 0.045 * s, 0.012 * s, ch[2] + 0.03 * s]], 0.004 * s, 0.004 * s, [[O['pied' + c], 1]], 4));
  });
  M.normales();
  const t = toile(64, 64), g = t.getContext('2d');
  g.fillStyle = C[1]; g.fillRect(0, 0, 64, 64); g.fillStyle = C[0]; g.fillRect(0, 16, 32, 32);
  // les brides prennent leur couleur en haut à gauche (uv des mèches : j/K, u*3 → on les laisse sur la couleur C[1])
  return [{ M, toile: t, spec: 0.1 }];
}

/* ---- les dessous ---- */
function construireDessous(pers, couvertHaut, couvertBas){
  const { m, R, cfg } = pers, f = cfg.sexe === 'f', D = DESSOUS[f ? 'f' : 'h'], out = [];
  if (!couvertBas){
    const yb = 0.795, yt = D.bas.yt;
    const rangs = tranchesHabit(m, cfg, { yb, yt, plus: D.bas.plus, drape: 3 });
    const M = nappeTronc(pers, rangs, yb, yt, { debut: 'ferme' });
    const W = 1024, H = 256, c = toile(W, H), g = c.getContext('2d');
    peindreMotif(g, W, H, D.motif, D.teinte, graine(3));
    const P = pinceauTronc(W, H, yb, yt);
    g.fillStyle = f ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.8)'; g.fillRect(0, 0, W, P(0, yt - 0.025)[1]);
    if (f){                                                  // le bas du maillot, échancré sur les hanches
      decouper(g, () => { g.beginPath(); for (let i = 0; i <= 64; i++){ const th = -PI + TAU * i / 64; const p = P(th, 0.842 + 0.062 * Math.pow(Math.abs(Math.sin(th)), 1.5)); i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); } g.lineTo(W, H); g.lineTo(0, H); g.closePath(); g.fill(); });
    }
    out.push({ M, toile: c, double: true });
    if (!f && D.bas.jambe){
      const Mj = new Maille();
      ['G', 'D'].forEach(k => mancheOuJambe(Mj, pers, segJambe(m, R, k), OPT_JAMBE(k), { d0: -0.075, f1: D.bas.jambe, plus: D.bas.plus + 0.002, debut: 'ferme', K: 16 }));
      const cj = toile(256, 256), gj = cj.getContext('2d'); peindreMotif(gj, 256, 256, D.motif, D.teinte, graine(4));
      out.push({ M: Mj, toile: cj, double: true });
    }
  }
  if (f && D.haut && !couvertHaut){
    // le haut du maillot : un triangle sur chaque sein, un bandeau dessous, des bretelles nouées au cou
    const yb = 1.19, yt = 1.493;
    const rangs = tranchesHabit(m, cfg, { yb, yt, plus: 0.0035, drape: 1.4 });
    const M = nappeTronc(pers, rangs, yb, yt);
    const W = 1024, H = 512, c = toile(W, H), g = c.getContext('2d');
    const P = pinceauTronc(W, H, yb, yt);
    g.fillStyle = D.teinte[0];
    [1, -1].forEach(sg => {
      poly(g, [P(sg * 0.06, 1.205), P(sg * 0.74, 1.205), P(sg * 0.40, 1.335)], D.teinte[0]);
      trait(g, [P(sg * 0.40, 1.33), P(sg * 0.5, 1.493)], D.teinte[0], 9);
    });
    g.fillRect(0, P(0, 1.228)[1], W, P(0, 1.195)[1] - P(0, 1.228)[1]);
    out.push({ M, toile: c, double: true });
  }
  return out;
}

/* ---------------------------------------------------------------------------
   9 quater. LES ACCESSOIRES
   Des objets POSÉS, tous rigides sur un os : les couvre-chefs et les lunettes
   sur la tête, la chaîne sur la poitrine, la montre au poignet, le
   téléphone dans la main. Les couvre-chefs sont taillés sur le crâne comme
   les cheveux (voir coque) : une casquette va à toutes les têtes. Les
   cheveux s'APLATISSENT dessous (voir `sousChapeau`) au lieu de passer au
   travers — on garde ce qui dépasse, les longueurs, la nuque.
   Les lunettes et la cigarette sont les deux modèles du salon d'avant
   (models/accessoires.json), les récompenses des épreuves du site : les
   lunettes à l'œuf de la page Info, la cigarette au parcours de Jumper.
   --------------------------------------------------------------------------- */
/* La hauteur (en tête) où s'arrête un couvre-chef, et combien il couvre :
   les cheveux au-dessus s'écrasent contre le crâne. */
const COUVRE = {
  aucun:     { nom: { fr: 'Aucun', en: 'None' } },
  casquette: { nom: { fr: 'Casquette', en: 'Cap' }, bord: 0.7, teintes: [['#1c1c22', '#ff4fa3'], ['#f4f1ea', '#2a2d6e'], ['#ff7eb6', '#f4f1ea'], ['#1ec7a0', '#1c1c22'], ['#e4413b', '#f4f1ea']] },
  envers:    { nom: { fr: 'Casquette à l’envers', en: 'Backwards cap' }, bord: 0.7, teintes: [['#1c1c22', '#ff4fa3'], ['#f4f1ea', '#2a2d6e'], ['#ff7eb6', '#f4f1ea'], ['#ffd166', '#1c1c22']] },
  bob:       { nom: { fr: 'Bob', en: 'Bucket hat' }, bord: 0.66, teintes: [['#f4f1ea', '#1ec7a0'], ['#ffd166', '#e4572e'], ['#1c1c22', '#ff4fa3'], ['#9ad8ff', '#1f2a5a']] },
  bonnet:    { nom: { fr: 'Bonnet', en: 'Beanie' }, bord: 0.6, teintes: [['#1c1c22'], ['#e4413b'], ['#ffd166'], ['#2a2d6e'], ['#ff7eb6']] },
  bandana:   { nom: { fr: 'Bandana', en: 'Bandana' }, bord: 0.69, bande: true, teintes: [['#d62246', '#f4f1ea'], ['#1f2a5a', '#f4f1ea'], ['#1c1c22', '#f4f1ea'], ['#ff7eb6', '#f4f1ea']] },
  visiere:   { nom: { fr: 'Visière', en: 'Sun visor' }, bord: 0.7, bande: true, teintes: [['#f4f1ea', '#1ec7a0'], ['#ff4fa3', '#1c1c22'], ['#ffd166', '#2a2d6e']] },
  panama:    { nom: { fr: 'Panama', en: 'Panama hat' }, bord: 0.7, teintes: [['#efe2c0', '#1c1c22'], ['#f4f1ea', '#ff4fa3'], ['#1c1c22', '#f4f1ea']] },
  casque:    { nom: { fr: 'Casque audio', en: 'Headphones' }, teintes: [['#2a2a33', '#ff9f1c'], ['#f4f1ea', '#ff4fa3'], ['#1c1c22', '#1ec7a0']] },
  couronne:  { nom: { fr: 'Couronne', en: 'Crown' }, bord: 0.8, teintes: [['#f2c14e', '#d62246']] },
  chantier:  { nom: { fr: 'Casque de chantier', en: 'Hard hat' }, bord: 0.66, teintes: [['#ffc300', '#1c1c22'], ['#f4f1ea', '#1c1c22'], ['#ff7a1a', '#1c1c22']] },
  swat:      { nom: { fr: 'Casque tactique', en: 'Tactical helmet' }, bord: 0.6, teintes: [['#23252b', '#101216']] },
  spatial:   { nom: { fr: 'Casque spatial', en: 'Space helmet' }, ferme: true, teintes: [['#f2f2f5', '#e0a526']] },
};
const LUNETTES = {
  aucune:   { nom: { fr: 'Aucune', en: 'None' } },
  soleil:   { nom: { fr: 'Lunettes de soleil', en: 'Sunglasses' }, verrou: 'vertige', modele: 'lunettes', couleurs: ['#191a1e', '#3c3e45', '#1e242d'] },
  miami:    { nom: { fr: 'Lunettes Miami', en: 'Miami shades' }, verrou: 'vertige', modele: 'lunettes', couleurs: ['#f4f1ea', '#f4f1ea', '#ff4fa3'], teinte: true },
  aviateur: { nom: { fr: 'Aviateur', en: 'Aviators' }, verrou: 'vertige', modele: 'lunettes', couleurs: ['#d8b25a', '#d8b25a', '#3a2a1c'] },
};
const BIJOUX = {
  aucun:   { nom: { fr: 'Aucun', en: 'None' } },
  chaine:  { nom: { fr: 'Chaîne en or', en: 'Gold chain' } },
  montre:  { nom: { fr: 'Montre en or', en: 'Gold watch' } },
  deux:    { nom: { fr: 'Chaîne et montre', en: 'Chain and watch' } },
  creoles: { nom: { fr: 'Créoles', en: 'Hoop earrings' } },
};
const BOUCHE = {
  rien:      { nom: { fr: 'Rien', en: 'Nothing' } },
  cigarette: { nom: { fr: 'Cigarette', en: 'Cigarette' }, verrou: 'jumper' },
};
// le volume d'une coupe au sommet du crâne (en tête) : un couvre-chef se pose dessus
const VOLUME = { chauve: 0, rase: 0.004, court: 0.03, degrade: 0.035, plaque: 0.03, banane: 0.05, crete: 0.03, afro: 0.1, tresses: 0.014, dreads: 0.03,
  mulet: 0.04, milong: 0.05, carre: 0.05, long: 0.045, boucles: 0.08, queue: 0.028, chignon: 0.03, couettes: 0.028 };
/* Un chapeau est-il posé, et jusqu'où descend-il ? Les cheveux s'en servent. */
function sousChapeau(cfg){
  const c = COUVRE[cfg.acc && cfg.acc.tete];
  if (!c || !c.bord) return null;
  return { bord: c.bord, bande: !!c.bande };
}
/* La texture d'un accessoire : un aplat de sa couleur, et quelques détails
   dessinés selon ce qu'il est. */
function toileAcc(id, C){
  const W = 256, c = toile(W), g = c.getContext('2d');
  g.fillStyle = C[0]; g.fillRect(0, 0, W, W);
  const rnd = graine(id.length * 97);
  if (id === 'bandana'){ for (let i = 0; i < 60; i++){ g.fillStyle = C[1]; g.beginPath(); g.ellipse(rnd() * W, rnd() * W, 6, 3, rnd() * PI, 0, TAU); g.fill(); g.fillRect(rnd() * W, rnd() * W, 2, 2); } }
  if (id === 'bonnet'){ for (let x = 0; x < W; x += 6){ g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x, 0, 2, W); } g.fillStyle = 'rgba(0,0,0,0.1)'; g.fillRect(0, W * 0.72, W, W * 0.28); }
  if (id === 'panama'){ for (let y = 0; y < W; y += 5){ g.fillStyle = 'rgba(120,90,40,0.18)'; g.fillRect(0, y, W, 1.5); } g.fillStyle = C[1]; g.fillRect(0, W * 0.8, W, W * 0.12); }
  if (id === 'casquette' || id === 'envers'){ g.fillStyle = C[1]; g.beginPath(); g.arc(W * 0.5, W * 0.45, 26, 0, TAU); g.fill(); g.fillStyle = C[0]; g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.fillText('FP', W * 0.5, W * 0.45 + 11); }
  if (id === 'bob'){ g.fillStyle = C[1]; g.fillRect(0, W * 0.7, W, W * 0.1); }
  if (id === 'swat'){ for (let i = 0; i < 400; i++){ g.fillStyle = 'rgba(255,255,255,0.03)'; g.fillRect(rnd() * W, rnd() * W, 3, 3); } }
  return c;
}
/* Un bord de chapeau : un anneau à la hauteur `y` (en tête) autour du crâne,
   qui s'élargit de `large` (mètres) en tombant de `chute` ; `secteur` limite
   aux angles voulus (une visière de casquette). */
function bordChapeau(M, H, y, ep, large, chute, secteur, uvV){
  const K = 40, a0 = secteur ? secteur[0] : -PI, a1 = secteur ? secteur[1] : PI, idx = [];
  const HH = H.T.HH;
  [0, 1].forEach(r => {
    const i0 = M.nb; idx.push(i0);
    for (let j = 0; j <= K; j++){
      const th = mix(a0, a1, j / K);
      const p = H.local(th, y, ep);
      const w = H.monde(p);
      const dir = v3.norm([Math.sin(th), 0, Math.cos(th)]);
      const lg = typeof large === 'function' ? large(th) : large;
      const P = r ? [w[0] + dir[0] * lg, w[1] - (typeof chute === 'function' ? chute(th) : chute), w[2] + dir[2] * lg] : w;
      M.sommet(P, [j / K, uvV + r * 0.1], null, [[O.tete, 1]]);
    }
  });
  coudre(M, idx[0], idx[1], K + 1, false, false);
}
function construireCouvre(cfg, H){
  const id = cfg.acc && cfg.acc.tete, def = COUVRE[id];
  if (!def || id === 'aucun') return [];
  const C = def.teintes[(cfg.acc.teteV | 0) % def.teintes.length];
  const vol = VOLUME[cfg.cheveux.style] || 0;
  const M = new Maille(), dessus = (y) => lisse(0.55, 0.95, y);
  const coif = (bord, ep, o) => coque(M, H, Object.assign({ presence: (th, y) => lisse(bord - 0.02, bord + 0.02, y), ep, chapeau: true }, o || {}));
  switch (id){
    case 'casquette': case 'envers': {
      const dev = id === 'envers' ? PI : 0;
      coif(0.7, (th, y) => 0.018 + vol * 0.55 + 0.012 * dessus(y));
      bordChapeau(M, H, 0.73, 0.02 + vol * 0.5, (th) => 0.075 * cloche(th - dev, 0.5), (th) => 0.012 * cloche(th - dev, 0.5), [dev - 1.1, dev + 1.1], 0.9);
      break;
    }
    case 'bob':
      coif(0.66, (th, y) => 0.02 + vol * 0.5 + 0.008 * dessus(y) - 0.02 * lisse(0.9, 1, y));
      bordChapeau(M, H, 0.68, 0.022 + vol * 0.45, 0.05, 0.03, null, 0.9);
      break;
    case 'bonnet':
      coif(0.6, (th, y) => 0.024 + vol * 0.45 + 0.03 * dessus(y) + 0.012 * lisse(0.68, 0.62, y));
      boule(M, H, H.monde([0, 1.08 + vol, -0.02]), 0.022 * H.m.s, 0.02 * H.m.s, [[O.tete, 1]]);
      break;
    case 'bandana': case 'visiere':
      coif(0.69, (th, y) => (0.012 + vol * 0.2) * (1 - lisse(0.8, 0.84, y)) - 0.03 * lisse(0.82, 0.86, y), { bas: 0.6 });
      if (id === 'visiere') bordChapeau(M, H, 0.73, 0.014 + vol * 0.2, (th) => 0.07 * cloche(th, 0.55), (th) => 0.015 * cloche(th, 0.55), [-1.1, 1.1], 0.9);
      else { const n = H.monde(H.local(PI, 0.72, 0.02)); boule(M, H, n, 0.018 * H.m.s, 0.014 * H.m.s, [[O.tete, 1]]); }
      break;
    case 'panama':
      coif(0.7, (th, y) => 0.028 + vol * 0.55 + 0.05 * dessus(y) - 0.02 * cloche(th, 0.4) * lisse(0.85, 0.95, y));
      bordChapeau(M, H, 0.72, 0.03 + vol * 0.5, 0.06, (th) => 0.004 + 0.012 * Math.abs(Math.cos(th)), null, 0.85);
      break;
    case 'casque': {
      // l'arceau par-dessus la tête, et deux coussinets orange sur les oreilles
      coif(0.93, (th, y) => (0.03 + vol * 0.6) * cloche(Math.abs(Math.sin(th)) - 1, 0.1), { presence: (th, y) => lisse(0.3, 0.6, Math.abs(Math.sin(th))) * lisse(0.4, 0.5, y) });
      [1, -1].forEach(sg => {
        const c = H.monde(H.local(sg * PI / 2, 0.42, 0.05 + vol * 0.3));
        boule(M, H, c, 0.042 * H.m.s, 0.046 * H.m.s, [[O.tete, 1]]);
      });
      break;
    }
    case 'couronne': {
      // un bandeau d'or, sept pointes, et des pierres
      coif(0.76, (th, y) => (0.024 + vol * 0.5) * (1 - lisse(0.86, 0.9, y)) - 0.05 * lisse(0.88, 0.93, y), { bas: 0.7 });
      for (let k = 0; k < 7; k++){
        const th = -PI + TAU * (k + 0.5) / 7, b = H.monde(H.local(th, 0.86, 0.03 + vol * 0.5));
        meche(M, [b, [b[0], b[1] + 0.045 * H.m.s, b[2]]], 0.009 * H.m.s, 0.002 * H.m.s, [[O.tete, 1]], 4);
      }
      break;
    }
    case 'chantier':
      coif(0.64, (th, y) => 0.035 + vol * 0.5 + 0.035 * dessus(y) + 0.01 * cloche(Math.sin(th), 0.08) * lisse(0.7, 0.95, y));
      bordChapeau(M, H, 0.665, 0.036 + vol * 0.45, (th) => 0.018 + 0.03 * cloche(th, 0.6), 0.004, null, 0.9);
      break;
    case 'swat':
      coif(0.58, (th, y) => 0.04 + vol * 0.5 + 0.02 * dessus(y));
      bordChapeau(M, H, 0.62, 0.045 + vol * 0.45, (th) => 0.012 * (1 - cloche(th, 0.8)), 0.01, null, 0.9);
      break;
    case 'spatial':
      // un casque fermé : une bulle blanche autour de la tête, ouverte sous le menton (voir la visière plus bas)
      sphere(M, H.monde([0, 0.5, -0.02]), 0.7 * H.T.HH, [-PI, PI], [-0.62, PI / 2], [[O.tete, 1]]);
      break;
  }
  M.normales();
  const out = [{ M, toile: toileAcc(id, C), spec: id === 'swat' || id === 'chantier' || id === 'spatial' ? 0.5 : 0.05, double: true }];
  if (id === 'spatial'){
    // la visière : un morceau de la même bulle, un peu devant, dorée comme celles des sorties dans l'espace
    const V = new Maille();
    sphere(V, H.monde([0, 0.5, -0.02]), 0.705 * H.T.HH, [-1.15, 1.15], [-0.45, 0.62], [[O.tete, 1]]);
    V.normales();
    out.push({ M: V, toile: toileUnie(C[1]), spec: 1.4, double: true });
  }
  return out;
}
/* Un morceau de sphère : de `a` à `b` en longitude (0 devant), de `c` à `d`
   en latitude (0 à l'horizontale). */
function sphere(M, centre, r, lon, lat, os){
  const K = 28, N = 16, idx = [];
  for (let i = 0; i <= N; i++){
    const b = mix(lat[0], lat[1], i / N), a0 = M.nb; idx.push(a0);
    for (let j = 0; j <= K; j++){
      const a = mix(lon[0], lon[1], j / K);
      M.sommet([centre[0] + Math.cos(b) * Math.sin(a) * r, centre[1] + Math.sin(b) * r, centre[2] + Math.cos(b) * Math.cos(a) * r], [j / K, 1 - i / N], null, os);
    }
    if (i > 0) coudre(M, idx[i - 1], a0, K + 1, false, true);
  }
}
/* Les modèles de models/accessoires.json : chargés une fois, à la première
   paire de lunettes ou cigarette qu'on met. */
let accJSON = null, accPromesse = null;
function modelesAcc(){
  if (accJSON) return Promise.resolve(accJSON);
  return accPromesse || (accPromesse = fetch(adresse('models/accessoires.json')).then(r => r.json()).then(j => (accJSON = j)));
}
function depuisModele(geo, couleurs, place, os, braise){
  const M = new Maille(), G = geo.groupes, X = geo.xyz;
  const groupe = (v) => { for (let g = 0; g < G.length; g++) if (v >= G[g][0] && v < G[g][0] + G[g][1]) return g; return 0; };
  for (let v = 0; v < X.length / 3; v++){
    const p = [X[v * 3], X[v * 3 + 1], X[v * 3 + 2]];
    let c = hexRvb(couleurs[groupe(v)] || couleurs[0]).concat([1]);
    if (braise && p[2] > braise) c = [1.0, 0.36, 0.1, 0.55];          // le bout qui brûle : il brille (alpha < 1)
    M.sommet(place(p), null, c, os);
  }
  for (let t = 0; t < geo.tri.length; t += 3) M.tri(geo.tri[t], geo.tri[t + 1], geo.tri[t + 2]);
  M.normales();
  return M;
}
function construireLunettes(cfg, H){
  const id = cfg.acc && cfg.acc.lunettes, def = LUNETTES[id];
  if (!def || !def.modele || !accJSON) return [];
  const geo = accJSON[def.modele], T = H.T, surf = H.surf;
  const larg = (surf.eyeX * 2 + 0.2) * T.HH;                  // un peu plus large que les deux yeux
  const avant = surf(0, 0.46)[2] + 0.012;                      // devant la racine du nez
  const M = depuisModele(geo, def.couleurs, (p) => T.monde([p[0] * larg / T.HH, 0.462 + p[1] * larg / T.HH, avant + p[2] * larg / T.HH]), [[O.tete, 1]]);
  return [{ M, toile: toileUnie('#ffffff'), spec: 1.0 }];
}
function construireCigarette(cfg, H){
  if (!(cfg.acc && cfg.acc.bouche === 'cigarette') || !accJSON) return [];
  const T = H.T, surf = H.surf, L = 0.075;
  // au coin de la bouche, tournée vers l'extérieur et un peu vers le bas
  const coin = surf(angleDeX(surf, surf.mh * 0.55, 0.15), 0.15);
  const q = q4.mul(q4.axe([0, 1, 0], 0.55), q4.axe([1, 0, 0], 0.22));
  const M = depuisModele(accJSON.cigarette, ['#c8964e', '#ece7dd'], (p) => {
    const r = q4.tourne(q, [p[0] * L, p[1] * L, p[2] * L]);
    return T.monde([coin[0] + r[0] / T.HH, coin[1] + r[1] / T.HH, coin[2] + 0.004 + r[2] / T.HH]);
  }, [[O.tete, 1]], 0.87);
  return [{ M, toile: toileUnie('#ffffff'), spec: 0.1 }];
}
function construireBijoux(cfg, pers, H){
  const id = cfg.acc && cfg.acc.bijou, out = [], s = pers.m.s, m = pers.m, R = pers.R;
  if (!id || id === 'aucun') return out;
  const M = new Maille(), or = [0.95, 0.76, 0.3, 1];
  if (id === 'chaine' || id === 'deux'){
    // la chaîne : un anneau autour du cou qui retombe sur la poitrine, et sa médaille
    const pts = [];
    for (let k = 0; k <= 28; k++){
      const th = -PI + TAU * k / 28, yr = 1.455 - 0.07 * Math.pow(Math.max(0, Math.cos(th)), 3);
      const a = anneauTronc(m, yr), [x, z] = superE({ rs: a.rs, rf: a.rf, rb: a.rb, n: a.n }, th);
      const hh = HAUTS[coupeDe(cfg.tenue)], l = Math.hypot(x, z) || 1, e = 0.012 + (hh && hh.corps ? 0.012 : 0);
      pts.push([x / l * (l * s + e), m.Y(yr) * s, a.zc * s + z / l * (l * s + e)]);
    }
    meche(M, pts, 0.0032 * s, 0.0032 * s, (u) => poidsTronc(1.42, 0), 5);
    const bas = pts[14];
    boule(M, null, [bas[0], bas[1] - 0.018 * s, bas[2] + 0.004], 0.014 * s, 0.016 * s, poidsTronc(1.38, 0));
  }
  if (id === 'montre' || id === 'deux'){
    const w = R[O.mainG], e = R[O.avantbrasG], d = v3.norm(v3.sub(w, e));
    const c = v3.madd(w, d, -0.03 * s);
    meche(M, [v3.madd(c, d, -0.012 * s), v3.madd(c, d, 0.012 * s)], 0.032 * s, 0.032 * s, [[O.avantbrasG, 1]], 10);
  }
  if (id === 'creoles' && H){
    [1, -1].forEach(sg => {
      const c = H.monde(H.local(sg * PI / 2 * 0.99, 0.3, 0.02)), pts = [];
      for (let k = 0; k <= 16; k++){ const a = TAU * k / 16; pts.push([c[0] + sg * 0.004, c[1] - 0.018 * s + Math.cos(a) * 0.016 * s, c[2] + Math.sin(a) * 0.016 * s]); }
      meche(M, pts, 0.0022 * s, 0.0022 * s, [[O.tete, 1]], 5);
    });
  }
  for (let k = 0; k < M.nb; k++){ M.c[k * 4] = or[0]; M.c[k * 4 + 1] = or[1]; M.c[k * 4 + 2] = or[2]; }
  M.normales();
  out.push({ M, toile: toileUnie('#ffffff'), spec: 1.4 });
  return out;
}
/* Le téléphone de 1986 : une brique grise, son antenne, dans la main droite. */
function construireBrique(pers){
  const { R, m } = pers, s = m.s, M = new Maille();
  const w = R[O.mainD], e = R[O.avantbrasD], d = v3.norm(v3.sub(w, e));
  const c = v3.madd(w, d, 0.06 * s);
  const an = [-0.1, 0.1].map((u, i) => ({ c: v3.madd(c, [0, 1, 0], u * s), t: [0, 1, 0], avant: [0, 0, 1], rs: 0.022 * s, rf: 0.04 * s, rb: 0.03 * s, n: 5, i }));
  tuyau(M, an, { K: 12, debut: 'ferme', fin: 'ferme', os: () => [[O.mainD, 1]], uv: () => [0.5, 0.5] });
  meche(M, [v3.madd(c, [0, 1, 0], 0.1 * s), v3.madd(c, [0, 1, 0], 0.16 * s)], 0.004 * s, 0.003 * s, [[O.mainD, 1]], 4);
  M.normales();
  return [{ M, toile: toileUnie('#3a3b40'), spec: 0.6 }];
}
/* ---- L'ARGENT ----
   Des billets de cent, maison : le papier vert, le cadre, les guillochis, un
   palmier dans le médaillon et « FAKE PARADISE ». Une seule toile : le billet
   en haut à gauche, la tranche d'une liasse (le papier empilé) dessous, la
   bande de papier qui la serre en haut à droite. */
const BILLET = [0, 0, 0.5, 112 / 256], TRANCHE = [0, 128 / 256, 0.5, 192 / 256], BANDE = [0.5, 0, 1, 64 / 256];
let toileArgentC = null;
function toileArgent(){
  if (toileArgentC) return toileArgentC;
  const c = toile(512, 256), g = c.getContext('2d'), vert = '#2f5a3e';
  // le billet
  const gr = g.createLinearGradient(0, 0, 256, 112); gr.addColorStop(0, '#dde9d0'); gr.addColorStop(1, '#b7d0a6');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 112);
  g.strokeStyle = 'rgba(47,90,62,0.35)'; g.lineWidth = 1;
  for (let k = 0; k < 8; k++){ g.beginPath(); for (let x = 12; x <= 244; x += 3) g.lineTo(x, 56 + Math.sin(x * 0.085 + k * 0.8) * (34 - k * 3.5)); g.stroke(); }
  g.strokeStyle = vert; g.lineWidth = 3; g.strokeRect(5, 5, 246, 102);
  g.lineWidth = 1; g.strokeRect(10, 10, 236, 92);
  g.fillStyle = '#e8f0dd'; g.beginPath(); g.ellipse(128, 56, 30, 38, 0, 0, TAU); g.fill();
  g.lineWidth = 2; g.stroke();
  // le palmier du médaillon
  g.strokeStyle = vert; g.lineWidth = 4; g.beginPath(); g.moveTo(134, 90); g.quadraticCurveTo(136, 62, 126, 42); g.stroke();
  g.fillStyle = vert;
  for (let f = 0; f < 6; f++){ g.save(); g.translate(126, 41); g.rotate(-PI / 2 + (f - 2.5) * 0.62); g.beginPath(); g.ellipse(13, 0, 14, 3.6, 0, 0, TAU); g.fill(); g.restore(); }
  g.textBaseline = 'middle'; g.font = 'bold 22px Arial, sans-serif';
  g.textAlign = 'left'; g.fillText('100', 16, 27); g.fillText('100', 16, 86);
  g.textAlign = 'right'; g.fillText('100', 240, 27); g.fillText('100', 240, 86);
  g.textAlign = 'center'; g.font = 'bold 10px Arial, sans-serif'; g.fillText('FAKE PARADISE', 128, 20); g.fillText('ONE HUNDRED', 128, 95);
  // la tranche d'une liasse : le papier empilé
  g.fillStyle = '#e4eddb'; g.fillRect(0, 128, 256, 64);
  for (let y = 128; y < 192; y += 2){ g.fillStyle = (y >> 1) % 3 ? 'rgba(90,120,80,0.22)' : 'rgba(255,255,255,0.35)'; g.fillRect(0, y, 256, 1); }
  // la bande
  g.fillStyle = '#d4ab3a'; g.fillRect(256, 0, 256, 64);
  g.fillStyle = 'rgba(90,60,10,0.35)'; g.fillRect(256, 0, 256, 4); g.fillRect(256, 60, 256, 4);
  g.fillStyle = '#5a3d0c'; g.font = 'bold 22px Arial, sans-serif'; g.fillText('$10,000', 384, 33);
  toileArgentC = c;
  return c;
}
/* Un pavé : six faces à arêtes vives (chacune ses sommets), autour du centre
   `c`, selon trois axes et trois demi-côtés ; `uv` : la région de la toile
   des deux grandes faces (`dessus`) et des quatre autres (`cote`). */
function pave(M, c, X, Y, Z, hx, hy, hz, uv, os){
  const neg = (v) => v3.mul(v, -1);
  [[Z, hz, X, hx, Y, hy, uv.dessus], [neg(Z), hz, X, hx, Y, hy, uv.dessus], [X, hx, Y, hy, Z, hz, uv.cote], [neg(X), hx, Y, hy, Z, hz, uv.cote],
   [Y, hy, X, hx, Z, hz, uv.cote], [neg(Y), hy, X, hx, Z, hz, uv.cote]].forEach(([n, hn, u, hu, , hv, r]) => {
    const v = v3.cross(n, u);                 // u × v = n : les faces tournées vers le dehors
    const o = v3.madd(c, n, hn);
    const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) =>
      M.sommet(v3.madd(v3.madd(o, u, a * hu), v, b * hv), [a < 0 ? r[0] : r[2], b < 0 ? r[1] : r[3]], null, os));
    M.quad(q[0], q[1], q[2], q[3]);
  });
}
/* Le MONEY SPREAD : dans chaque main, neuf billets ouverts en éventail
   autour de la prise. Tout est posé dans le repère de la main au repos (elle
   pend, les doigts vers le bas) ; l'éventail s'ouvre donc dans le plan de la
   main, entre la paume et les doigts repliés, et la suit où qu'elle aille. */
function construireEventails(pers){
  const { R, m } = pers, s = m.s, M = new Maille();
  [['G', 1], ['D', -1]].forEach(([c, sg]) => {
    const w = R[O['main' + c]], dir = v3.norm(v3.sub(w, R[O['avantbras' + c]]));
    const { lar, pau } = reperesMain(sg, dir);
    const P0 = v3.madd(v3.madd(w, dir, 0.052 * s), pau, 0.017 * s), os = [[O['main' + c], 1]];
    const N = 9, L = 0.156 * s, l = 0.066 * s;
    for (let k = 0; k < N; k++){
      const a = (k / (N - 1) - 0.5) * 74 * DEG;
      const ax = v3.add(v3.mul(dir, Math.cos(a)), v3.mul(lar, Math.sin(a))), lv = v3.sub(v3.mul(lar, Math.cos(a)), v3.mul(dir, Math.sin(a)));
      // un rien d'épaisseur entre deux billets : pas de scintillement
      const b0 = v3.madd(v3.madd(P0, pau, (k - (N - 1) / 2) * 0.0011 * s), ax, -0.03 * s);
      const q = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => M.sommet(v3.madd(v3.madd(b0, ax, u * L), lv, (v - 0.5) * l),
        [mix(BILLET[0], BILLET[2], u), mix(BILLET[1], BILLET[3], v)], null, os));
      M.quad(q[0], q[1], q[2], q[3]);
    }
  });
  M.normales();
  return [{ M, toile: toileArgent(), double: true, spec: 0.08 }];
}
/* La LIASSE du money phone : une brique de billets serrés dans leur bande,
   tenue à l'oreille comme le téléphone de 1986 — la grande face contre la
   paume, le bout qui dépasse des doigts. */
function construireLiasse(pers){
  const { R, m } = pers, s = m.s, M = new Maille(), os = [[O.mainD, 1]];
  const w = R[O.mainD], dir = v3.norm(v3.sub(w, R[O.avantbrasD]));
  const { lar, pau } = reperesMain(-1, dir);
  const L = 0.156 * s, l = 0.066 * s, ep = 0.038 * s;
  // tournée d'un demi-quart vers l'extérieur : de face, on voit le billet du dessus, pas seulement la tranche
  const ep1 = v3.norm(v3.sub(pau, lar)), la1 = v3.norm(v3.add(pau, lar));
  const c = v3.madd(v3.madd(w, dir, 0.125 * s), pau, 0.012 * s + ep / 2);
  pave(M, c, dir, la1, ep1, L / 2, l / 2, ep / 2, { dessus: BILLET, cote: TRANCHE }, os);
  pave(M, c, la1, dir, ep1, l / 2 + 0.0015 * s, 0.019 * s, ep / 2 + 0.0015 * s, { dessus: BANDE, cote: BANDE }, os);
  M.normales();
  return [{ M, toile: toileArgent(), spec: 0.1 }];
}
// ce qu'une attitude met dans les mains (voir ATTITUDES, `accessoire`)
const ACCESSOIRES_ATTITUDE = { brique: construireBrique, eventails: construireEventails, liasse: construireLiasse };

/* ---------------------------------------------------------------------------
   10. LA POSE : des rotations d'os aux matrices de peau
   `rot` : une rotation locale par os (quaternion), `depl` : le déplacement du
   bassin. Chaque os descend de son parent : sa matrice monde est celle du
   parent, puis le chemin de repos jusqu'à lui, puis sa rotation. La matrice
   de PEAU retire la position de repos : c'est elle qu'on envoie au programme.
   --------------------------------------------------------------------------- */
function poser(R, rot, depl, sortie){
  const n = OS_NOMS.length;
  const G = sortie ? sortie.G : new Array(n), S = sortie ? sortie.S : new Float32Array(MAX_OS * 16);
  const tmp = new Float32Array(16), loc = new Float32Array(16);
  for (let i = 0; i < n; i++){
    const p = OS_PARENT[i];
    const off = p < 0 ? R[i] : [R[i][0] - R[p][0], R[i][1] - R[p][1], R[i][2] - R[p][2]];
    const d = i === O.bassin && depl ? [off[0] + depl[0], off[1] + depl[1], off[2] + depl[2]] : off;
    m4.qt(rot[i] || [0, 0, 0, 1], d, 1, loc);
    G[i] = p < 0 ? new Float32Array(loc) : m4.mul(G[p], loc, G[i] instanceof Float32Array ? G[i] : new Float32Array(16));
    // peau = G × translation(−repos)
    const g = G[i], r = R[i];
    for (let k = 0; k < 12; k++) tmp[k] = g[k];
    tmp[12] = g[12] - (g[0] * r[0] + g[4] * r[1] + g[8] * r[2]);
    tmp[13] = g[13] - (g[1] * r[0] + g[5] * r[1] + g[9] * r[2]);
    tmp[14] = g[14] - (g[2] * r[0] + g[6] * r[1] + g[10] * r[2]);
    tmp[15] = 1;
    S.set(tmp, i * 16);
  }
  return { G, S };
}

/* ---------------------------------------------------------------------------
   10 bis. LES GESTES
   Une ATTITUDE est une fonction du temps qui rend une pose : des angles pour
   le dos, la tête, les mains et les doigts ; un déplacement du bassin ; la
   place des pieds ; la place des MAINS ; le regard.
   LES MEMBRES SE POSENT PAR LEUR BOUT. On ne dit pas « le bras à 38°,
   tourné de 70°, le coude à 95° » — trois angles qui se composent et
   qu'aucun humain ne sait régler —, on dit « la main sur la hanche, le coude
   vers l'arrière » : le bras se plie tout seul pour y aller (voir ikMembre,
   la loi des cosinus). Et une main posée sur la hanche y reste quelle que
   soit la carrure : sa cible est donnée par rapport à un os (la hanche, la
   poitrine, la tête), en mètres du repère. Les pieds de même : plantés à leur
   place pendant que le bassin se balance, c'est ce qui sépare un
   personnage qui se déhanche d'un mannequin qui glisse.
   Par-dessus : la respiration, les paupières, les yeux qui suivent, et les
   GESTES d'un moment (un coucou, les lunettes qu'on ajuste…).
   Repères des angles (voir q4.euler : le tour sur l'axe de l'os d'abord,
   puis x, puis z) : x positif penche la tête ou le dos en avant ; y positif
   tourne la tête vers la gauche du personnage ; z positif la penche vers sa
   droite. Côté gauche seulement : `miroir` écrit le côté droit.
   --------------------------------------------------------------------------- */
const miroir = (os) => {
  const out = Object.assign({}, os);
  Object.keys(os).forEach(n => {
    const m = n.match(/^(.*)G(\d?)$/);
    if (m && !os[m[1] + 'D' + m[2]]){ const [x, y, z] = os[n]; out[m[1] + 'D' + m[2]] = [x, -y, -z]; }
  });
  return out;
};
// les doigts : repliés d'autant (0 ouverts, 1 le poing), le pouce à part
const doigts = (c, k, pouce, index) => {
  const o = {}, sg = c === 'G' ? 1 : -1;
  ['index', 'majeur', 'annulaire'].forEach((d, i) => {
    const kk = d === 'index' && index != null ? index : k;
    const a = kk * (60 + i * 6) + 5;
    o[d + c + '1'] = [0, 0, -a * sg]; o[d + c + '2'] = [0, 0, -a * 1.05 * sg];
  });
  const p = pouce == null ? k : pouce;
  o['pouce' + c + '1'] = [0, -p * 20 * sg, -p * 22 * sg]; o['pouce' + c + '2'] = [0, 0, -p * 34 * sg];
  return o;
};
const onde = (t, p, ph) => Math.sin(TAU * t / p + (ph || 0));
const souffle = (t) => Math.pow(0.5 + 0.5 * Math.sin(TAU * t / 4.4), 1.4);    // on inspire plus vite qu'on n'expire
/* Une main : sa cible (par rapport à un os, en mètres du repère), où pointe
   le coude, et où regarde la paume (dans le repère de la poitrine). */
const viser = (os, dec, coude, paume) => ({ os, dec, coude, paume });
const pendante = (sg, dx, dz) => viser('poitrine', [sg * (0.235 + (dx || 0)), -0.452, 0.03 + (dz || 0)], [sg * 0.3, 0, -1], [-sg, 0, 0.15]);
// un vrai poing (les doigts n'ont que deux phalanges : il faut les replier plus que `doigts` ne le fait)
const POING_D = { indexD1: [0, 0, 92], indexD2: [0, 0, 104], majeurD1: [0, 0, 96], majeurD2: [0, 0, 108], annulaireD1: [0, 0, 100], annulaireD2: [0, 0, 110] };
/* Les attitudes. Chacune : son nom, et sa pose à l'instant t (secondes). */
const ATTITUDES = {
  cool: { nom: { fr: 'Décontracté', en: 'Chill' }, pose: (t) => {
    const w = onde(t, 11), b = souffle(t);
    return {
      bassin: [0.028 + 0.012 * w, -0.012 - 0.004 * Math.abs(w), 0.004],
      os: Object.assign(miroir({
        bassin: [0, 2 * w, 4.5 + w], lombaires: [1.5, -1 * w, -2.5], dos: [1 + b, 0, -1.2], poitrine: [-1.5 * b, 1.5 * w, -0.8],
        cou: [5, 0, 2], tete: [1 + 2 * onde(t, 7.3), 7 * onde(t, 13, 1) + 2, -3],
        claviculeG: [0, 0, -1.2 * b], mainG: [0, 0, 4],
      }), doigts('G', 0.28), doigts('D', 0.32)),
      mains: { G: pendante(1, -0.005, 0.01), D: pendante(-1, 0.0, 0.04) },
      pieds: { G: [0.012, 0.0, 0], D: [-0.03, 0.07, 12] },
      regard: [0.15 * onde(t, 13, 1), 0.05],
    };
  } },
  bras: { nom: { fr: 'Bras croisés', en: 'Arms crossed' }, pose: (t) => {
    const b = souffle(t), n = Math.pow(Math.max(0, onde(t, 6.5)), 8);
    return {
      bassin: [0.012, -0.006, 0],
      os: Object.assign({
        bassin: [0, 0, 2], lombaires: [-2, 0, -1], dos: [-1 + b, 0, 0], poitrine: [-2 * b, 0, 0],
        cou: [2, 0, 0], tete: [-3 + 8 * n, 0, -2],
        claviculeG: [0, 0, -2 - b], claviculeD: [0, 0, 2 + b],
        mainG: [0, 60, -20], mainD: [0, -60, 20],
      }, doigts('G', 0.4), doigts('D', 0.45)),
      mains: {
        G: viser('poitrine', [-0.10, -0.07, 0.16], [0.6, -0.5, 0.4], [0, 0, 1]),
        D: viser('poitrine', [0.12, -0.05, 0.19], [-0.6, -0.5, 0.4], [0, 0, 1]),
      },
      pieds: { G: [0.05, 0.0, -8], D: [-0.05, 0.0, 8] },
      regard: [0, 0.02],
    };
  } },
  hanches: { nom: { fr: 'Mains sur les hanches', en: 'Hands on hips' }, pose: (t) => {
    const b = souffle(t), w = onde(t, 9);
    return {
      bassin: [0.008 * w, -0.008, 0],
      os: Object.assign(miroir({
        bassin: [0, 2 * w, 1.5 * w], lombaires: [-3, 0, 0], dos: [-2 + b, 0, 0], poitrine: [-3 - 1.5 * b, 1.5 * w, 0],
        tete: [-2, 6 * onde(t, 12), 0], claviculeG: [0, 0, 2 - b], mainG: [0, 0, -25],
      }), doigts('G', 0.12, 0.25), doigts('D', 0.12, 0.25)),
      mains: { G: viser('bassin', [0.17, 0.06, 0.035], [1, 0, -0.9], [-1, 0, 0]), D: viser('bassin', [-0.17, 0.06, 0.035], [-1, 0, -0.9], [1, 0, 0]) },
      pieds: { G: [0.07, 0, -10], D: [-0.07, 0, 10] },
      regard: [0, 0.03],
    };
  } },
  hanche: { nom: { fr: 'Déhanché', en: 'Hip sway' }, pose: (t) => {
    const w = onde(t, 3.2), b = souffle(t);
    return {
      bassin: [0.045 * w, -0.016 - 0.006 * Math.abs(w), 0.01],
      os: Object.assign({
        bassin: [0, 6 * w, 8 * w], lombaires: [0, -3 * w, -4 * w], dos: [b, -2 * w, -3 * w], poitrine: [-b, 0, -1 * w],
        cou: [2, 0, 3 * w], tete: [2, -6 * w, -6 * w], mainD: [0, 0, 25],
      }, doigts('G', 0.28), doigts('D', 0.15, 0.3)),
      mains: { G: pendante(1, 0.01, 0.02), D: viser('bassin', [-0.17, 0.07, 0.03], [-1, 0, -0.8], [1, 0, 0]) },
      pieds: { G: [0.02 + 0.03 * Math.max(0, -w), 0.02, 0], D: [-0.02 - 0.03 * Math.max(0, w), 0.05, 14] },
      regard: [-0.2 * w, 0.05],
    };
  } },
  disco: { nom: { fr: 'Disco', en: 'Disco' }, pose: (t) => {
    // le doigt vers le ciel, puis vers le sol de l'autre côté : un tempo de 116
    const bt = t * 116 / 60, ph = bt % 2, haut = ph < 1 ? lisse(0, 0.35, ph) : 1 - lisse(1, 1.35, ph);
    const hip = Math.sin(bt * PI);
    return {
      bassin: [0.05 * hip, -0.03 - 0.015 * Math.abs(Math.cos(bt * PI)), 0],
      os: Object.assign({
        bassin: [0, 10 * hip, 9 * hip], lombaires: [0, -4 * hip, -5 * hip], dos: [0, 6 * (haut - 0.5), -4 * hip], poitrine: [-3, 8 * (haut - 0.5), 0],
        cou: [0, -10 * (haut - 0.5), 0], tete: [-8 * haut + 4, -16 * (haut - 0.5), -6 * hip],
        mainG: [0, 0, 10],
      }, doigts('G', 0.65), doigts('D', 0.9, 0.8, 0.02)),
      mains: {
        G: viser('bassin', [0.2, 0.18, 0.12], [1, -0.6, -0.4], [0, 0, 1]),
        D: haut > 0.5 ? viser('poitrine', [mix(-0.1, -0.45, haut), mix(-0.35, 0.62, haut), mix(0.25, 0.15, haut)], [-1, -0.3, 0], [0, 0, 1])
                      : viser('poitrine', [mix(-0.1, -0.45, haut), mix(-0.35, 0.62, haut), mix(0.25, 0.15, haut)], [-1, 0.2, -0.3], [-1, 0, 0]),
      },
      pieds: { G: [0.04 + 0.03 * Math.max(0, -hip), 0.0, -6], D: [-0.05 - 0.04 * Math.max(0, hip), 0.04, 10] },
      regard: [-0.3 * (haut - 0.5), 0.3 * haut],
    };
  } },
  frime: { nom: { fr: 'Muscle Beach', en: 'Muscle Beach' }, pose: (t) => {
    // les deux biceps, puis on relâche, puis la poitrine de profil
    const c = (t % 7.5) / 7.5, a = lisse(0.02, 0.12, c) * (1 - lisse(0.42, 0.52, c)), b = lisse(0.55, 0.65, c) * (1 - lisse(0.88, 0.98, c));
    const r = souffle(t);
    const mainBiceps = (sg) => viser('poitrine', [sg * 0.33, 0.28, 0.04], [sg, -0.6, -0.2], [0, 0, 1]);
    const mainChest = (sg) => sg > 0 ? viser('bassin', [0.02, 0.2, 0.2], [1, -0.4, 0.2], [0, 1, 0]) : viser('bassin', [0.03, 0.18, 0.16], [-1, -0.3, -0.2], [0, 0, -1]);
    const m = (sg) => {
      const rp = pendante(sg);
      if (a > 0.001) return interpMain(rp, mainBiceps(sg), a);
      if (b > 0.001) return interpMain(rp, mainChest(sg), b);
      return rp;
    };
    return {
      bassin: [0, -0.02 * a - 0.03 * b, 0],
      os: Object.assign({
        bassin: [0, 22 * b, 0], lombaires: [-6 * a, 10 * b, 0], dos: [-4 * a + r * 0.5, 8 * b, 0], poitrine: [-6 * a - r, 8 * b, 0],
        cou: [0, -14 * b, 0], tete: [-5 * a, -30 * b, -6 * a],
        claviculeG: [0, 0, 7 * a], claviculeD: [0, 0, -7 * a],
      }, doigts('G', mix(0.28, 1, Math.max(a, b))), doigts('D', mix(0.32, 1, Math.max(a, b)))),
      mains: { G: m(1), D: m(-1) },
      pieds: { G: [0.08 * a, 0.04 * b, -8], D: [-0.08 * a, -0.03 * b, 8] },
      regard: [-0.4 * b, 0.1 * a],
    };
  } },
  telephone: { nom: { fr: 'Au téléphone', en: 'On the phone' }, accessoire: 'brique', pose: (t) => {
    const w = onde(t, 8), g = Math.pow(Math.max(0, onde(t, 3.1)), 2), b = souffle(t);
    return {
      bassin: [0.025 * w, -0.012, 0],
      os: Object.assign({
        bassin: [0, 3 * w, 3 * w], lombaires: [0, -2, -2], dos: [b, 0, 0], poitrine: [-b, 4 * w, 0],
        cou: [4, 0, -5], tete: [3, 10 * w, -10 - 3 * g], mainD: [0, 0, 0], mainG: [0, 0, 10 * g],
      }, doigts('D', 0.85, 0.6), doigts('G', 0.2 + 0.25 * g)),
      mains: {
        D: viser('tete', [-0.085, -0.075, 0.07], [-0.4, -1, 0.3], [1, 0, 0]),   // le poignet sous l'oreille : la main (et la brique) monte le long de la joue
        G: g > 0.02 ? interpMain(pendante(1), viser('poitrine', [0.2, -0.18, 0.25], [1, -0.5, -0.3], [0, 1, 0]), g) : pendante(1),
      },
      pieds: { G: [0.02, 0.0, 0], D: [-0.03, 0.06, 14] },
      regard: [0.3 * w, -0.1],
    };
  } },
  /* Les trois de la demande du 25 sept. 2026 : le money spread (un éventail
     de billets dans chaque main, montré à l'objectif), le money phone (la
     liasse à l'oreille, comme un téléphone) et le pouce en bas, bras tendu. */
  billets: { nom: { fr: 'Money spread', en: 'Money spread' }, accessoire: 'eventails', pose: (t) => {
    // on fait claquer les éventails, une main puis l'autre, le menton levé
    const b = souffle(t), w = onde(t, 2.4), h = onde(t, 1.2);
    return {
      bassin: [0.012 * w, -0.014, 0],
      os: Object.assign({
        bassin: [0, 4 * w, 1.5 * w], lombaires: [-4, -1.5 * w, 0], dos: [-3 + b, 0, 0], poitrine: [-3 - b, 2.5 * w, 0],
        cou: [-2, 0, 0], tete: [-7 + 1.5 * h, 7 * onde(t, 5.3), 3 * w],
        claviculeG: [0, 0, 3], claviculeD: [0, 0, -3],
        mainG: [0, 0, -8 + 5 * h], mainD: [0, 0, 8 + 5 * h],
      }, doigts('G', 0.74, 0.55), doigts('D', 0.74, 0.55)),
      mains: {
        G: viser('poitrine', [0.23, 0.02 + 0.018 * w, 0.17], [1, -1.2, -0.3], [0.1, 0, 1]),
        D: viser('poitrine', [-0.23, 0.02 - 0.018 * w, 0.17], [-1, -1.2, -0.3], [-0.1, 0, 1]),
      },
      pieds: { G: [0.08, 0.0, -10], D: [-0.08, 0.0, 10] },
      regard: [0, 0.12],
    };
  } },
  liasse: { nom: { fr: 'Money phone', en: 'Money phone' }, accessoire: 'liasse', pose: (t) => {
    // au bout du fil, les affaires marchent : on hoche la tête, la main libre fait les gros titres
    const w = onde(t, 8), g = Math.pow(Math.max(0, onde(t, 2.7)), 2), b = souffle(t), n = onde(t, 0.9);
    return {
      bassin: [0.03 * w, -0.012, 0],
      os: Object.assign({
        bassin: [0, 4 * w, 4 * w], lombaires: [-1, -2, -2], dos: [b, 0, 0], poitrine: [-2 - b, 5 * w, 0],
        cou: [4, 0, -5], tete: [3 + 2.5 * n * g, 12 * w, -11], mainD: [0, 0, 0], mainG: [0, 0, 12 * g],
      }, doigts('D', 0.82, 0.55), doigts('G', 0.25 + 0.4 * g, 0.3)),
      mains: {
        // la main tient le bas de la liasse, sous la mâchoire : la liasse monte le long de la joue jusqu'à l'oreille
        D: viser('tete', [-0.1, -0.15, 0.1], [-0.4, -1, 0.3], [1, 0, 0.2]),
        G: g > 0.02 ? interpMain(pendante(1), viser('poitrine', [0.22, -0.12, 0.28], [1, -0.5, -0.3], [0, 1, 0]), g) : pendante(1),
      },
      pieds: { G: [0.03, 0.0, -4], D: [-0.04, 0.06, 16] },
      regard: [0.3 * w, -0.05],
    };
  } },
  pouce: { nom: { fr: 'Pouce en bas', en: 'Thumbs down' }, pose: (t) => {
    // le bras tendu vers l'objectif, le poing fermé, le pouce vers le sol ; toutes les deux secondes, il appuie son verdict
    const b = souffle(t), c = (t % 2.2) / 2.2, k = c < 0.3 ? Math.sin(c / 0.3 * PI) : 0, sh = onde(t, 3.4);
    return {
      bassin: [0.02, -0.01, 0],
      os: Object.assign({
        bassin: [0, -2, 2], lombaires: [0, -1, 0], dos: [b, 0, 0], poitrine: [-b, 1, 0],
        cou: [2, 0, 0], tete: [5 + 2 * k, 5 * sh + 4, -7],
        claviculeD: [0, 0, 2], mainG: [0, 0, -25], mainD: [0, 0, 0],
      }, doigts('G', 0.12, 0.25), POING_D, { pouceD1: [-52, -31, 0], pouceD2: [0, 0, 0] }),
      mains: {
        D: viser('poitrine', [-0.3, 0.14 - 0.06 * k, 0.55], [-0.3, -1, 0], [-1, -0.4, 0.3]),
        G: viser('bassin', [0.17, 0.06, 0.035], [1, 0, -0.9], [-1, 0, 0]),
      },
      pieds: { G: [0.05, 0.0, -6], D: [-0.05, 0.03, 10] },
      regard: [0, 0.06],
    };
  } },
};
function interpMain(a, b, k){
  if (a.os !== b.os){ return k < 0.5 ? a : b; }
  const L = (u, v) => u.map((x, i) => mix(x, v[i], k));
  return { os: a.os, dec: L(a.dec, b.dec), coude: L(a.coude, b.coude), paume: L(a.paume || [0, 0, 1], b.paume || [0, 0, 1]) };
}
/* Les gestes d'un moment, par-dessus l'attitude : `duree` en secondes ; leur
   poids monte puis redescend (voir enveloppe). */
const GESTES = {
  coucou: { duree: 2.3, pose: (u) => ({ os: { mainD: [0, 0, 22 * Math.sin(u * 24)] }, mains: { D: viser('poitrine', [-0.36, 0.3 + 0.02 * Math.sin(u * 24), 0.12], [-1, -0.8, 0], [0, 0, 1]) } }) },
  lunettes: { duree: 1.6, pose: (u) => ({ os: Object.assign({ tete: [4, 0, 0] }, doigts('D', 0.6, 0.3, 0.1)), mains: { D: viser('tete', [-0.02, 0.1, 0.12], [-1, -0.8, 0.2], [0, 0, -1]) } }) },
  epaule: { duree: 1.8, pose: (u) => ({ os: { cou: [16, 10, 0], tete: [12, 14, 0] }, mains: { G: viser('poitrine', [-0.14, 0.1 + 0.03 * Math.sin(u * 20), 0.08], [1, -0.5, 0.5], [0, -1, 0]) } }) },
  cheveux: { duree: 1.8, pose: (u) => ({ os: { tete: [-8, 8, 6] }, mains: { D: viser('tete', [-0.05 + 0.08 * u, 0.2, 0.02 - 0.12 * u], [-1, 0.4, 0], [0, -1, 0]) } }) },
  victoire: { duree: 1.9, pose: (u) => ({ os: Object.assign({ tete: [-10, 0, 0] }, doigts('D', 1)), mains: { D: viser('poitrine', [-0.28, 0.55 + 0.05 * Math.sin(u * 16), 0.1], [-1, 0, 0], [0, 0, 1]) } }) },
};
const enveloppe = (u) => lisse(0, 0.18, u) * (1 - lisse(0.78, 1, u));
/* LE SOLVEUR : deux os (cuisse et tibia, bras et avant-bras), un point de
   départ, une cible, un « pôle » vers lequel plier (le genou devant, le coude
   derrière). La loi des cosinus donne l'angle ; les rotations se prennent au
   plus court, et la paume (s'il y en a une à orienter) est tournée ensuite
   autour de l'avant-bras. Rend les rotations MONDE des deux os. */
const inv = (q) => [-q[0], -q[1], -q[2], q[3]];
function ikMembre(R, i1, i2, i3, depart, cible, pole){
  const L1 = v3.len(v3.sub(R[i2], R[i1])), L2 = v3.len(v3.sub(R[i3], R[i2]));
  const d = v3.sub(cible, depart);
  const dist = clamp(v3.len(d), Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-4);
  const dir = v3.norm(d);
  const A = Math.acos(clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1));
  let ax = v3.cross(dir, v3.norm(pole));
  if (v3.len(ax) < 1e-4) ax = v3.cross(dir, [1, 0, 0]);
  const d1 = q4.tourne(q4.axe(v3.norm(ax), A), dir);
  const coude = v3.madd(depart, d1, L1);
  const d2 = v3.norm(v3.sub(v3.madd(depart, dir, dist), coude));
  const Q1 = q4.entre(v3.norm(v3.sub(R[i2], R[i1])), d1);
  // le second os part de l'orientation du premier : sa rotation au plus court se prend depuis là
  const r2 = q4.tourne(Q1, v3.norm(v3.sub(R[i3], R[i2])));
  const Q2 = q4.mul(q4.entre(r2, d2), Q1);
  return { Q1, Q2, d2 };
}
/* Le repère monde du dos, os par os : de quoi viser une main sur la hanche
   ou à l'oreille pendant que le buste bouge. */
function chaineDos(P, rot){
  const R = P.R, q = {}, p = {};
  q[O.racine] = rot[O.racine] || [0, 0, 0, 1]; p[O.racine] = R[O.racine];
  [O.bassin, O.lombaires, O.dos, O.poitrine, O.cou, O.tete, O.claviculeG, O.claviculeD].forEach(i => {
    const pa = OS_PARENT[i];
    let off = v3.sub(R[i], R[pa]);
    if (i === O.bassin) off = v3.add(off, P.depl);
    p[i] = v3.add(p[pa], q4.tourne(q[pa], off));
    q[i] = q4.mul(q[pa], rot[i]);
  });
  return { q, p };
}
const pointOs = (P, W, os, dec) => v3.add(W.p[O[os]], q4.tourne(W.q[O[os]], v3.mul(dec, P.m.s)));
function appliquerPose(P, pose){
  const rot = P.rot, R = P.R, s = P.m.s;
  for (let i = 0; i < rot.length; i++) rot[i] = [0, 0, 0, 1];
  Object.entries(pose.os || {}).forEach(([n, a]) => { if (O[n] != null) rot[O[n]] = q4.euler(a[0], a[1], a[2]); });
  const b = pose.bassin || [0, 0, 0];
  P.depl = [b[0] * s, b[1] * s, b[2] * s];
  const W = chaineDos(P, rot);
  // les jambes, pieds plantés
  [['G', 1], ['D', -1]].forEach(([c, sg]) => {
    const p = (pose.pieds && pose.pieds[c]) || [0, 0, 0];
    const repos = R[O['pied' + c]];
    const iC = O['cuisse' + c], iT = O['tibia' + c], iP = O['pied' + c];
    const hanche = v3.add(W.p[O.bassin], q4.tourne(W.q[O.bassin], v3.sub(R[iC], R[O.bassin])));
    const cible = [repos[0] + p[0] * s, repos[1] + (p[3] || 0) * s, repos[2] + p[1] * s];
    const { Q1, Q2 } = ikMembre(R, iC, iT, iP, hanche, cible, q4.tourne(W.q[O.bassin], [0, 0, 1]));
    rot[iC] = q4.mul(inv(W.q[O.bassin]), Q1);
    rot[iT] = q4.mul(inv(Q1), Q2);
    rot[iP] = q4.mul(inv(Q2), q4.axe([0, 1, 0], (p[2] || 0) * DEG));
  });
  // les bras, main visée
  [['G', 1], ['D', -1]].forEach(([c, sg]) => {
    const M = pose.mains && pose.mains[c];
    if (!M) return;
    const iCl = O['clavicule' + c], iB = O['bras' + c], iA = O['avantbras' + c], iM = O['main' + c];
    const epaule = v3.add(W.p[iCl], q4.tourne(W.q[iCl], v3.sub(R[iB], R[iCl])));
    const cible = pointOs(P, W, M.os, M.dec);
    const qP = W.q[O.poitrine];
    let { Q1, Q2, d2 } = ikMembre(R, iB, iA, iM, epaule, cible, q4.tourne(qP, M.coude));
    let vrilleMain = 0;
    if (M.paume){
      // tourner l'avant-bras sur lui-même pour que la paume regarde où l'on veut
      const { pau } = reperesMain(sg, v3.norm(v3.sub(R[iM], R[iA])));
      const actuelle = q4.tourne(Q2, pau), voulue = q4.tourne(qP, v3.norm(M.paume));
      const proj = (v) => v3.norm(v3.sub(v, v3.mul(d2, v3.dot(v, d2))));
      const a = proj(actuelle), bb = proj(voulue);
      const ang = Math.atan2(v3.dot(v3.cross(a, bb), d2), v3.dot(a, bb));
      /* LA TORSION SE PARTAGE : un peu à l'épaule (le bras tourne sur lui-
         même), le plus gros au coude, le reste au poignet. Toute au coude,
         l'avant-bras vrillait et la peau s'y pinçait comme un papillote —
         un pouce en bas, bras tendu, c'est presque un demi-tour. Le bras et
         l'avant-bras tournent autour de leur propre axe : rien ne bouge
         de place, seule la peau se répartit la torsion. */
      const d1 = v3.norm(q4.tourne(Q1, v3.sub(R[iA], R[iB])));
      Q1 = q4.mul(q4.axe(d1, ang * 0.3), Q1);
      Q2 = q4.mul(q4.axe(d2, ang * 0.72), Q2);
      vrilleMain = ang * 0.28;
    }
    rot[iB] = q4.mul(inv(W.q[iCl]), Q1);
    rot[iA] = q4.mul(inv(Q1), Q2);
    if (vrilleMain) rot[iM] = q4.mul(q4.axe(v3.norm(v3.sub(R[iM], R[iA])), vrilleMain), rot[iM]);
  });
  poser(R, rot, P.depl, P.pose);
}
/* L'ANIMATEUR : l'attitude en cours, la précédente qui s'efface (une demi-
   seconde de fondu), le geste d'un moment, le clignement. */
class Animateur {
  constructor(){ this.att = 'cool'; this.avant = null; this.geste = null; this.cligneA = 2; this.regardCible = null; }
  attitude(id, t){ if (!ATTITUDES[id] || id === this.att) return; this.avant = this.att; this.tF = t; this.att = id; }
  gesticuler(id, t){ if (GESTES[id]) this.geste = { id, t0: t }; }
  poser(P, t){
    this.tDernier = t;
    let pose = (ATTITUDES[this.att] || ATTITUDES.cool).pose(t);
    if (this.avant){
      const k = lisse(0, 0.6, t - this.tF);
      if (k >= 1) this.avant = null;
      else pose = melangerPoses((ATTITUDES[this.avant] || ATTITUDES.cool).pose(t), pose, k);
    }
    if (this.geste){
      const G = GESTES[this.geste.id], u = (t - this.geste.t0) / G.duree;
      if (u >= 1 || u < 0) this.geste = null;
      else {
        const g = G.pose(u);
        const sur = { os: Object.assign({}, pose.os, g.os || {}), bassin: pose.bassin, pieds: pose.pieds, regard: pose.regard, mains: Object.assign({}, pose.mains, g.mains || {}) };
        pose = melangerPoses(pose, sur, enveloppe(u));
      }
    }
    appliquerPose(P, pose);
    const rg = this.regardCible || pose.regard || [0, 0];
    P.regard = [clamp(rg[0], -1, 1), clamp(rg[1], -1, 1)];
    // un clignement toutes les deux à six secondes, parfois deux de suite
    if (t > this.cligneA + 0.16){ this.cligneA = t + 2 + Math.random() * 4; if (Math.random() < 0.15) this.cligneA = t + 0.3; }
    const cu = (t - this.cligneA) / 0.16;
    P.cligne = cu >= 0 && cu <= 1 ? Math.sin(cu * PI) : 0;
  }
}
function melangerPoses(a, b, k){
  const os = {};
  new Set([...Object.keys(a.os || {}), ...Object.keys(b.os || {})]).forEach(n => {
    const x = (a.os && a.os[n]) || [0, 0, 0], y = (b.os && b.os[n]) || [0, 0, 0];
    os[n] = [mix(x[0], y[0], k), mix(x[1], y[1], k), mix(x[2], y[2], k)];
  });
  const L = (u, v, n) => { u = u || new Array(n).fill(0); v = v || new Array(n).fill(0); return u.map((x, i) => mix(x, v[i] || 0, k)); };
  const pieds = {}, mains = {};
  ['G', 'D'].forEach(c => {
    pieds[c] = L(a.pieds && a.pieds[c], b.pieds && b.pieds[c], 4);
    const ma = a.mains && a.mains[c], mb = b.mains && b.mains[c];
    mains[c] = ma && mb ? interpMain(ma, mb, k) : (mb || ma);
  });
  return { os, bassin: L(a.bassin, b.bassin, 3), pieds, mains, regard: L(a.regard, b.regard, 2) };
}

/* ---------------------------------------------------------------------------
   11. LE PERSONNAGE
   Ses réglages, ses pièces à la carte graphique, sa pose. Changer un réglage
   reconstruit tout ce qui en dépend — quelques millisecondes : le corps est
   fait de quelques milliers de sommets, et c'est le prix d'un corps qui n'est
   jamais « à peu près » celui qu'on a demandé.
   --------------------------------------------------------------------------- */
const PEAU_DEFAUT = '#c69876';
const CORPS_DEFAUT = { stature: 0.5, corpulence: 0.42, muscle: 0.5, carrure: 0.5, poitrine: 0.5, taille: 0.5, hanches: 0.5, jambes: 0.5, cou: 0.5 };
const VISAGE_DEFAUT = { forme: 0.5, machoire: 0.5, menton: 0.5, pommettes: 0.5, nezLarg: 0.5, nezLong: 0.5, nezArete: 0.5,
  yeuxTaille: 0.5, yeuxEcart: 0.5, yeuxInclin: 0.5, sourcils: 0.5, levres: 0.5, bouche: 0.5, oreilles: 0.5, age: 0.2, taches: 0, fard: 0, levresC: null };
function normaliser(cfg){
  const c = cfg || {};
  const f = c.sexe === 'f';
  return {
    v: 2, sexe: f ? 'f' : 'h',
    corps: Object.assign({}, CORPS_DEFAUT, c.corps || {}),
    visage: Object.assign({}, VISAGE_DEFAUT, c.visage || {}),
    peau: /^#[0-9a-f]{6}$/i.test(c.peau || '') ? c.peau : PEAU_DEFAUT,
    yeux: /^#[0-9a-f]{6}$/i.test(c.yeux || '') ? c.yeux : '#5a3c22',
    cheveux: Object.assign({ style: f ? 'long' : 'court', couleur: '#2b1d14' }, c.cheveux || {}),
    barbe: Object.assign({ style: 'aucune' }, c.barbe || {}),
    sourcils: Object.assign({ style: f ? 'fins' : 'naturels' }, c.sourcils || {}),
    maquillage: Object.assign({ liner: f ? 0.35 : 0, linerC: '#1a1210' }, c.maquillage || {}),
    tenue: tenueNormale(c.tenue),
    acc: Object.assign({}, c.acc || {}),
    attitude: ATTITUDES[c.attitude] ? c.attitude : 'cool',
  };
}
/* Le haut porté est un article de la boutique ou l'un des basiques. Une pièce
   qui n'existe plus — les chemises de l'atelier d'avant — ou pas de haut
   choisi du tout : le premier t-shirt de la boutique. Un article porté prend
   les photos du jour (le catalogue a pu les changer, voir applyCatalogue) ;
   un article qu'on ne retrouve pas dans le catalogue reste tel quel — le
   catalogue n'est peut-être pas encore arrivé. */
function tenueNormale(t){
  const T = Object.assign({}, t || {});
  if (T.haut === 'boutique' && T.boutique && T.boutique.img){
    const it = article(T.boutique.img);
    if (it) T.boutique = portee(it);
  } else if (!(HAUTS[T.haut] && !HAUTS[T.haut].cache)){
    const a = articleParDefaut();
    if (a){ T.haut = 'boutique'; T.boutique = a; } else T.haut = 'tshirt';
  }
  return T;
}
/* Les pièces sont rangées par GROUPE — le corps, la tête, les cheveux, la
   tenue, les accessoires — et chaque groupe a sa clé : les réglages dont il
   dépend. Un changement ne reconstruit que les groupes dont la clé bouge :
   la couleur des cheveux n'est qu'un uniforme, un t-shirt ne touche pas au
   visage, un curseur de corpulence ne repeint pas les sourcils. C'est ce qui
   rend les curseurs vivants : tout refaire prend un quart de seconde. Les
   textures sont gardées d'une fois sur l'autre sous la même clé. */
const GROUPES = ['corps', 'tete', 'yeux', 'cheveux', 'tenue', 'acc'];
class Personnage {
  constructor(cfg){
    this.groupes = {}; this.tex = new Map(); this.cles = null; this.n = 0; this.liste = [];
    this.rot = OS_NOMS.map(() => [0, 0, 0, 1]); this.depl = [0, 0, 0];
    this.regard = [0, 0]; this.cligne = 0; this.anim = new Animateur();
    this.pose = { G: new Array(OS_NOMS.length), S: new Float32Array(MAX_OS * 16) };
    this.maj(cfg);
  }
  get pieces(){ return this.liste; }
  // une texture de la réserve, créée au besoin ; `groupe` dit à qui elle sert
  texte(cle, groupe, fabrique){
    let e = this.tex.get(cle);
    if (!e){ e = { t: texture(fabrique()), groupe }; this.tex.set(cle, e); }
    e.vu = this.n;
    return e.t;
  }
  vider(g){
    (this.groupes[g] || []).forEach(p => liberer(p.g));
    this.groupes[g] = [];
  }
  liberer(){
    GROUPES.forEach(g => this.vider(g));
    for (const e of this.tex.values()) gl.deleteTexture(e.t);
    this.tex.clear(); this.cles = null; this.liste = []; this.attente = null;
  }
  maj(cfg){
    const C = this.cfg = normaliser(cfg);
    const J = JSON.stringify, T = C.tenue, f = C.sexe === 'f';
    const idP = PIEDS[T.pieds] ? T.pieds : (f ? 'basket' : 'retro');
    const piedsNus = idP === 'pieds' || idP === 'tongs';
    const coupe = COIFFURES[C.cheveux.style] || COIFFURES.court;
    const ferme = !!(COUVRE[C.acc.tete] && COUVRE[C.acc.tete].ferme);
    const cles = {
      corps: J([C.sexe, C.corps, piedsNus]),
      tete: J([C.sexe, C.corps, C.visage, coupe.oreilles !== false]),
      visage: J([C.sexe, C.visage, C.peau, C.cheveux, C.barbe, C.sourcils, C.maquillage]),
      cheveux: J([C.sexe, C.corps, C.visage, C.cheveux.style, C.acc.tete, coupeDe(T)]),
      tenue: J([C.sexe, C.corps, T]),
      acc: J([C.sexe, C.corps, C.visage, C.cheveux.style, C.acc, coupeDe(T), C.attitude]),
    };
    const change = (k) => !this.cles || this.cles[k] !== cles[k];
    const refaits = new Set(GROUPES.filter(g => g !== 'yeux' && change(g)));
    if (refaits.has('tete')) refaits.add('yeux');
    this.n++;
    const m = this.m = mesures(C), R = this.R = squelette(m);
    const teinte = this.teinte = hexRvb(C.peau);
    const jeton = this.jeton = (this.jeton || 0) + 1;
    // la tête d'abord : les cheveux et les accessoires s'appuient sur elle
    if (refaits.has('tete') || !this.tete) this.tete = construireTete(C, m, R, { oreilles: coupe.oreilles !== false });
    const tete = this.tete;
    const H = this.H = contexteCheveux(C, tete.surf, tete.T, m, R);
    const tv = this.texte('visage|' + cles.visage, 'tete', () => peindreVisage(C, tete.surf, { crane: coupe.crane }));
    if (refaits.has('corps')){
      this.vider('corps');
      this.groupes.corps.push({ nom: 'corps', g: versGPU(construireCorps(C, m, R, { pieds: !piedsNus })), tex: texBlanche, teinte, spec: 0.10, rim: 0.6 });
    }
    if (refaits.has('tete')){
      this.vider('tete'); this.vider('yeux');
      this.groupes.tete.push({ nom: 'tete', g: versGPU(tete.M), tex: tv, teinte: [1, 1, 1], spec: 0.10, rim: 0.6 });
      construireYeux(C, tete.surf, tete.T).forEach(y => this.groupes.yeux.push({ nom: 'oeil', g: versGPU(y.M), oeil: true, cote: y.cote, teinte }));
    }
    // ce qui ne coûte rien : la peau et les yeux sont des uniformes, le visage une texture déjà là
    (this.groupes.corps || []).forEach(p => { p.teinte = teinte; });
    (this.groupes.tete || []).forEach(p => { p.tex = tv; });
    (this.groupes.yeux || []).forEach(p => { p.teinte = teinte; });
    if (refaits.has('cheveux')){
      this.vider('cheveux');
      const ch = ferme ? null : construireCheveux(C, H);
      if (ch) this.groupes.cheveux.push({ nom: 'cheveux', g: versGPU(ch), tex: texGrainGL(coupe.grain || 'lisse'), spec: 0.14, rim: 0.7, double: true });
    }
    (this.groupes.cheveux || []).forEach(p => { p.teinte = v3.mul(hexRvb(C.cheveux.couleur), 1.3); });
    const pers = { m, R, cfg: C, article: null };
    const monter = (groupe, lot, prefixe) => lot.forEach((p, i) => {
      if (!p.M.lisse) p.M.normales();
      const tx = this.texte(prefixe + '|' + i, groupe, () => p.toile);
      this.groupes[groupe].push({ nom: groupe, g: versGPU(p.M), tex: tx, teinte: [1, 1, 1], spec: p.spec || 0.05, rim: 0.55, double: !!p.double });
    });
    if (refaits.has('tenue')){
      this.vider('tenue');
      const idH = coupeDe(T);
      /* Un article de la boutique : ses photos, lues une fois (voir
         lirePhoto). La première fois, le temps qu'elles arrivent, la coupe
         nue ; on refait la tenue à leur arrivée. Une photo introuvable
         (l'article a quitté le catalogue) laisse la coupe, en gris. */
      let photo = '';
      this.attente = null;
      if (T.haut === 'boutique' && T.boutique && T.boutique.img){
        const pa = photosArticle(T.boutique.img, T.boutique.img2 || T.boutique.img);
        pers.article = pa.pret || { hex: '#55555c' };
        photo = pa.pret ? '|photo' : '';
        if (!pa.pret && !pa.rate){
          // refaire à l'arrivée — si le personnage porte encore cet article, quoi qu'on ait changé d'autre entre-temps
          const attente = this.attente = {};
          const refaire = () => { if (this.attente === attente && gl){ this.attente = null; this.cles.tenue = ''; this.maj(this.cfg); if (this.surPret) this.surPret(); } };
          pa.then(refaire, refaire);
        }
      }
      const idB = BAS[T.bas] ? T.bas : 'jean';
      const vH = T.hautV | 0, vB = T.basV | 0, vP = T.piedsV | 0;
      const dH = HAUTS[idH], lot = [];
      lot.push(...construireDessous(pers, idH !== 'aucun' && dH.col !== 'brassiere' ? true : dH.col === 'brassiere', idB !== 'aucun'));
      lot.push(...construireBas(pers, idB, vB));
      lot.push(...construireHaut(pers, idH, vH));
      lot.push(...construireChaussures(pers, idP, vP));
      monter('tenue', lot, 'tenue|' + cles.tenue + photo);
    }
    if (refaits.has('acc')){
      this.vider('acc');
      const lot = [...construireCouvre(C, H), ...construireBijoux(C, pers, ferme ? null : H)];
      // les lunettes et la cigarette attendent leur modèle, la première fois
      const modele = (LUNETTES[C.acc.lunettes] && LUNETTES[C.acc.lunettes].modele) || C.acc.bouche === 'cigarette';
      if (modele && !accJSON) modelesAcc().then(() => { if (this.jeton === jeton && gl){ this.cles.acc = ''; this.maj(this.cfg); if (this.surPret) this.surPret(); } }).catch(() => {});
      if (!ferme) lot.push(...construireLunettes(C, H), ...construireCigarette(C, H));
      const tenu = ACCESSOIRES_ATTITUDE[(ATTITUDES[C.attitude] || {}).accessoire];
      if (tenu) lot.push(...tenu(pers));
      monter('acc', lot, 'acc|' + cles.acc);
    }
    // les textures des groupes refaits qui n'ont pas resservi
    for (const [k, e] of this.tex) if (e.vu !== this.n && (refaits.has(e.groupe) || (e.groupe === 'tete' && k.startsWith('visage|')))){ gl.deleteTexture(e.t); this.tex.delete(k); }
    this.cles = cles;
    this.liste = [].concat(...GROUPES.map(g => this.groupes[g] || []));
    // l'attitude : en fondu si le personnage bougeait déjà, d'emblée sinon (un personnage neuf, une vignette)
    if (this.anim && C.attitude && ATTITUDES[C.attitude] && this.anim.att !== C.attitude){
      if (this.anim.tDernier != null) this.anim.attitude(C.attitude, this.anim.tDernier);
      else { this.anim.att = C.attitude; this.anim.avant = null; }
    }
    poser(this.R, this.rot, this.depl, this.pose);
    return this;
  }
  // la hauteur des yeux, dans le monde, au repos : la caméra s'y règle
  yeuxY(){ return this.tete.T.monde([0, 0.458, 0])[1]; }
}

/* ---------------------------------------------------------------------------
   12. LE RENDU
   --------------------------------------------------------------------------- */
const LUMIERE = {
  soleil: v3.norm([-0.62, 0.20, -0.76]),     // vers le soleil : derrière, à gauche, bas sur l'horizon
  soleilC: [1.30, 0.70, 0.50],
  cle: v3.norm([0.66, 0.52, 0.55]),          // la clé, de trois quarts à droite et au-dessus : les joues tournent dans l'ombre
  cleC: [0.98, 0.9, 0.86],
  cielC: [0.34, 0.3, 0.46],
  solC: [0.46, 0.35, 0.3],
  brumeC: [1.0, 0.60, 0.50],
  brume: [35, 320],
};
function lumieres(u, L, cam){
  gl.uniform3fv(u.uSoleil, L.soleil); gl.uniform3fv(u.uSoleilC, L.soleilC);
  gl.uniform3fv(u.uCle, L.cle); gl.uniform3fv(u.uCleC, L.cleC);
  gl.uniform3fv(u.uCielC, L.cielC); gl.uniform3fv(u.uSolC, L.solC);
  gl.uniform3fv(u.uBrumeC, L.brumeC); gl.uniform2fv(u.uBrume, L.brume);
  gl.uniform3fv(u.uCam, cam);
}
function camera(w, h, oeil, cible, fov){
  const P = m4.persp(fov * DEG, w / h, 0.08, 600), V = m4.regard(oeil, cible, [0, 1, 0]);
  return { PV: m4.mul(P, V), P, V, oeil, cible, w, h };
}
function dessinerPerso(perso, cam, modele, L, alpha){
  const pr = PR.perso, u = pr.u;
  gl.useProgram(pr.p);
  gl.uniformMatrix4fv(u.uPV, false, cam.PV);
  gl.uniformMatrix4fv(u.uModele, false, modele);
  gl.uniformMatrix4fv(u.uOs, false, perso.pose.S);
  lumieres(u, L, cam.oeil);
  gl.uniform1f(u.uAlpha, alpha == null ? 1 : alpha);
  gl.activeTexture(gl.TEXTURE0); gl.uniform1i(u.uTex, 0);
  const C = perso.cfg;
  perso.pieces.forEach(p => {
    if (p.cache) return;
    gl.bindTexture(gl.TEXTURE_2D, p.tex || texBlanche);
    gl.uniform3fv(u.uTeinte, p.teinte || [1, 1, 1]);
    gl.uniform1f(u.uPlat, p.plat ? 1 : 0);
    gl.uniform1f(u.uCleK, p.cle == null ? 1 : p.cle);
    gl.uniform1f(u.uRim, p.rim == null ? 0.5 : p.rim);
    gl.uniform1f(u.uSpec, p.spec || 0);
    gl.uniform1f(u.uMode, p.oeil ? 1 : 0);
    if (p.oeil){
      const V = C.visage;
      gl.uniform3fv(u.uIris, hexRvb(C.yeux));
      gl.uniform2fv(u.uRegard, perso.regard);
      gl.uniform1f(u.uCligne, perso.cligne);
      gl.uniform1f(u.uOeilH, 0.49 * (1 + k5(V.yeuxTaille) * 0.12));
      gl.uniform1f(u.uOeilInc, k5(V.yeuxInclin) * 0.5 + 0.06);
      gl.uniform1f(u.uLiner, (C.maquillage && C.maquillage.liner) || 0);
      gl.uniform3fv(u.uLinerC, hexRvb((C.maquillage && C.maquillage.linerC) || '#1a1210'));
      gl.uniform1f(u.uCote, p.cote);
    }
    if (p.double) gl.disable(gl.CULL_FACE); else gl.enable(gl.CULL_FACE);
    gl.bindVertexArray(p.g.vao);
    gl.drawElements(gl.TRIANGLES, p.g.n, gl.UNSIGNED_INT, 0);
  });
  gl.bindVertexArray(null);
  gl.enable(gl.CULL_FACE);
}
function dessinerCiel(cam, t){
  const pr = PR.ciel, u = pr.u;
  gl.useProgram(pr.p);
  gl.uniformMatrix4fv(u.uInvPV, false, m4.inv(cam.PV));
  gl.uniform3fv(u.uCam, cam.oeil);
  gl.uniform3fv(u.uSoleilDir, CIEL.soleil);
  gl.uniform3fv(u.uHorizon, CIEL.horizon); gl.uniform3fv(u.uRose, CIEL.rose);
  gl.uniform3fv(u.uMauve, CIEL.mauve); gl.uniform3fv(u.uNuit, CIEL.nuit);
  gl.uniform1f(u.uT, t);
  gl.depthMask(false);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.depthMask(true);
}
const CIEL = {
  soleil: v3.norm([-0.58, 0.035, -0.82]),
  horizon: [1.0, 0.62, 0.42], rose: [0.98, 0.42, 0.56], mauve: [0.50, 0.22, 0.52], nuit: [0.13, 0.08, 0.26],
};
/* Le décor : des pièces statiques (voir versGPU(…, true)) avec leur matrice.
   `o.vent` : l'amplitude du vent pour cette pièce (0 : immobile). */
function dessinerDecor(objets, cam, L, t){
  const pr = PR.decor, u = pr.u;
  gl.useProgram(pr.p);
  gl.uniformMatrix4fv(u.uPV, false, cam.PV);
  lumieres(u, L, cam.oeil);
  gl.uniform1f(u.uT, t);
  gl.uniform1f(u.uCleK, 0.3);
  objets.forEach(o => {
    if (!o.g) return;
    gl.uniformMatrix4fv(u.uModele, false, o.modele || IDENT);
    gl.uniform1f(u.uVentK, o.vent == null ? 1 : o.vent);
    gl.bindVertexArray(o.g.vao);
    gl.drawElements(gl.TRIANGLES, o.g.n, gl.UNSIGNED_INT, 0);
  });
  gl.bindVertexArray(null);
}
const IDENT = m4.id();
/* La mer : une grille régulière, soulevée par le programme. `rive` : le z du
   bord de l'eau sur le sable. Plus fine près du bord, où l'on voit les
   vagues, plus lâche au large — la grille va jusqu'à l'horizon. */
function grilleMer(x0, x1, z0, z1, nx, nz){
  const M = new Maille();
  for (let j = 0; j <= nz; j++){
    const v = j / nz, z = z0 + (z1 - z0) * Math.pow(v, 2.2);
    for (let i = 0; i <= nx; i++){
      const x = x0 + (x1 - x0) * i / nx;
      M.sommet([x + (j % 2 ? (x1 - x0) / nx * 0.5 : 0), 0, z], null, [1, 1, 1, 1]);
    }
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++){
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    M.tri(a, b, c); M.tri(b, d, c);
  }
  return M;
}
const EAU = { pres: [0.08, 0.72, 0.78], loin: [0.50, 0.20, 0.60] };
function dessinerMer(mer, cam, L, t){
  const pr = PR.mer, u = pr.u;
  gl.useProgram(pr.p);
  gl.uniformMatrix4fv(u.uPV, false, cam.PV);
  lumieres(u, L, cam.oeil);
  gl.uniform1f(u.uT, t);
  gl.uniform1f(u.uRiveZ, mer.rive);
  gl.uniform3fv(u.uEauPres, EAU.pres); gl.uniform3fv(u.uEauLoin, EAU.loin);
  gl.uniform3fv(u.uHorizon, CIEL.horizon); gl.uniform3fv(u.uRose, CIEL.rose); gl.uniform3fv(u.uMauve, CIEL.mauve);
  gl.bindVertexArray(mer.g.vao);
  gl.drawElements(gl.TRIANGLES, mer.g.n, gl.UNSIGNED_INT, 0);
  gl.bindVertexArray(null);
}
/* L'ombre de contact : un disque en fondu sous les pieds, qui suit le
   personnage (et s'allonge un peu vers l'arrière, à l'opposé du soleil). */
let disque = null;
function dessinerOmbre(cam, x, z, rx, rz, force){
  if (!disque){
    const M = new Maille();
    const c = M.sommet([0, 0, 0]);
    for (let j = 0; j <= 24; j++){ const a = j / 24 * TAU; M.sommet([Math.cos(a), 0, Math.sin(a)]); }
    for (let j = 0; j < 24; j++) M.tri(c, j + 2, j + 1);
    disque = versGPU(M, true);
  }
  const pr = PR.ombre, u = pr.u;
  gl.useProgram(pr.p);
  gl.uniformMatrix4fv(u.uPV, false, cam.PV);
  const mo = m4.id(); mo[0] = rx; mo[10] = rz; mo[12] = x; mo[13] = 0.006; mo[14] = z;
  gl.uniformMatrix4fv(u.uModele, false, mo);
  gl.uniform1f(u.uForce, force);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  gl.bindVertexArray(disque.vao);
  gl.drawElements(gl.TRIANGLES, disque.n, gl.UNSIGNED_INT, 0);
  gl.bindVertexArray(null);
  gl.depthMask(true); gl.disable(gl.BLEND);
}
/* Prépare le canvas du moteur à la taille voulue et l'efface. `fond` : faux
   pour un personnage seul sur fond transparent (le profil, la carte). */
function cadre(w, h, fond){
  if (cvGL.width !== w || cvGL.height !== h){ cvGL.width = w; cvGL.height = h; }
  gl.viewport(0, 0, w, h);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
  gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
  gl.disable(gl.BLEND);
}

//@@SUITE@@

/* ===========================================================================
   13. LA PLAGE DE L'ATELIER (Vice City, coucher de soleil)

   Le décor du créateur de personnage : une plage de Miami en 1986, à l'heure
   où le soleil touche l'eau. Tout est taillé ici, en facettes, avec la boîte
   à outils de l'atelier (`BOITE()` dans atelier.js) : aucun fichier 3D.

   CE QUE LA CAMÉRA VOIT. L'œil est bas (1 m) et le champ étroit (30°) : un
   téléobjectif. Un palmier proche n'y montre que son tronc ; pour voir des
   palmes contre le ciel, il faut les planter à 25 m et plus. D'où la forme du
   rivage : une plage devant, et une langue de sable qui file vers l'horizon
   sur la droite, où poussent les palmiers et où veille la tour du sauveteur.
   À gauche, la baie ouverte et, de l'autre côté de l'eau, Ocean Drive.
   Le panneau de l'interface couvre le tiers droit de l'écran : ce qui doit
   frapper (l'aileron de la Cadillac, un palmier) reste dans les deux tiers
   de gauche.

   Repères : ceux de l'atelier — mètres, y en haut, le personnage à l'origine
   regarde vers +z (vers la caméra), sa gauche est en +x.
   =========================================================================== */
const construireDecor = (() => {

let B = null;                          // la boîte à outils de l'atelier, reçue à chaque construction
const CAM = [0.9, 4.2];                // la caméra principale (x, z) : les grilles s'y règlent

/* ---------------------------------------------------------------------------
   1. PETITS OUTILS
   Chaque facette a ses propres sommets : la couleur y reste franche d'un
   bord à l'autre (des sommets partagés la fondraient avec la voisine), et
   c'est ce qui fait le « low poly ». Les normales, elles, sont calculées
   par la carte graphique.
   --------------------------------------------------------------------------- */
const rvba = (h, a) => { const c = typeof h === 'string' ? B.hexRvb(h) : h; return [c[0], c[1], c[2], a == null ? (c[3] == null ? 1 : c[3]) : a]; };
const teinte = (c, k) => [c[0] * k, c[1] * k, c[2] * k, c[3] == null ? 1 : c[3]];
const v3add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/* Un sommet, et son poids de vent si la pièce en porte (M.vent tenu à jour). */
function S(M, p, c, v){
  const i = M.sommet(p, null, c);
  if (M.vent) M.vent.push(v || 0);
  return i;
}
/* Un polygone convexe (sens trigonométrique vu de dehors), en éventail.
   `c` : une couleur, ou une par sommet (le chrome : clair en haut, sombre en
   bas, comme s'il renvoyait le ciel et le sable). */
function poly(M, pts, c, v){
  const i0 = M.nb, parSommet = Array.isArray(c[0]);
  pts.forEach((p, k) => S(M, p, parSommet ? c[k] : c, Array.isArray(v) ? v[k] : v));
  for (let k = 1; k < pts.length - 1; k++) M.tri(i0, i0 + k, i0 + k + 1);
}
/* Le même, vu des deux côtés : les feuilles, les voiles, les toiles. */
function poly2(M, pts, c, c2, v){
  poly(M, pts, c, v);
  poly(M, pts.slice().reverse(), c2 || c, Array.isArray(v) ? v.slice().reverse() : v);
}
/* Une boîte par ses huit coins : x0y0z0, x1y0z0, x1y1z0, x0y1z0, puis z1.
   `c` : une couleur, ou six (−z, +z, −x, +x, −y, +y ; null = face omise,
   pour celles qu'on ne voit jamais). */
const FACES = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 4, 7, 3], [1, 2, 6, 5], [0, 1, 5, 4], [3, 7, 6, 2]];
function boite(M, k, c, v){
  const six = c.length === 6;
  FACES.forEach((f, i) => { const cc = six ? c[i] : c; if (cc) poly(M, f.map(j => k[j]), cc, v); });
}
/* La même, dégradée du bas vers le haut sur chaque face : le chrome, sombre
   en bas (le sable qu'il renvoie), clair en haut (le ciel). */
function boiteChrome(M, k, bas, haut, dessus){
  const y0 = Math.min(...k.map(p => p[1])), y1 = Math.max(...k.map(p => p[1]));
  FACES.forEach((f, i) => {
    if (i === 4) return;                                    // le dessous : jamais vu
    if (i === 5) return poly(M, f.map(j => k[j]), dessus || haut);
    poly(M, f.map(j => k[j]), f.map(j => B.melange(bas, haut, (k[j][1] - y0) / ((y1 - y0) || 1)).concat([1])));
  });
}
function coins(x0, x1, y0, y1, z0, z1, T){
  const k = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  return T ? k.map(T) : k;
}
/* Un repère : rotation (quaternion), puis translation. */
const place = (q, t) => p => { const r = B.q4.tourne(q, p); return [r[0] + t[0], r[1] + t[1], r[2] + t[2]]; };
/* Un cylindre (ou un cône, r1 = 0) de a vers b, à n pans. `o.fa`, `o.fb` :
   la couleur des fonds (false : ouverts) ; `o.v` : [vent en a, vent en b]. */
function cylindre(M, a, b, r0, r1, n, c, o){
  o = o || {};
  const { v3 } = B;
  const t = v3.norm(v3.sub(b, a));
  const u = v3.norm(v3.cross(t, Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), w = v3.cross(t, u);
  const ph = o.phase || 0;
  const pt = (c0, r, k) => { const th = (k + ph) / n * B.TAU; return v3.add(c0, v3.add(v3.mul(u, r * Math.cos(th)), v3.mul(w, r * Math.sin(th)))); };
  const va = o.v ? o.v[0] : 0, vb = o.v ? o.v[1] : 0;
  for (let k = 0; k < n; k++){
    const cc = typeof c === 'function' ? c(k) : c;
    if (r1 > 0) poly(M, [pt(a, r0, k), pt(a, r0, k + 1), pt(b, r1, k + 1), pt(b, r1, k)], cc, [va, va, vb, vb]);
    else poly(M, [pt(a, r0, k), pt(a, r0, k + 1), b], cc, [va, va, vb]);
  }
  if (o.fb && r1 > 0) poly(M, Array.from({ length: n }, (_, k) => pt(b, r1, k)), o.fb, vb);
  if (o.fa) poly(M, Array.from({ length: n }, (_, k) => pt(a, r0, n - k)), o.fa, va);
}

/* ---------------------------------------------------------------------------
   2. LE RIVAGE ET LE SABLE
   Deux bords d'eau : celui de devant, presque droit, et celui de la langue de
   sable, qui part vers l'horizon en s'écartant peu à peu vers la droite.
   `terre(x, z)` est la distance signée au rivage (positive sur le sable) :
   l'union des deux terres par un maximum adouci, ce qui arrondit l'anse où
   elles se rejoignent.
   --------------------------------------------------------------------------- */
const NIVEAU = -0.35;                  // la mer : un peu plus bas que le sable où se tient le personnage
const RIVE_Z = -7.2;                   // le bord de l'eau, devant
const riveDevant = x => RIVE_Z + 0.30 * Math.sin(0.23 * x + 0.8) + 0.16 * Math.sin(0.61 * x + 2.0);
const riveDroite = z => { const u = Math.max(0, -z - 6); return 1.7 + 0.05 * u + 0.0008 * u * u + 0.35 * Math.sin(0.19 * z); };
function smax(a, b, k){ const h = B.clamp(0.5 + 0.5 * (a - b) / k, 0, 1); return B.mix(b, a, h) + k * h * (1 - h); }
const terre = (x, z) => smax(z - riveDevant(x), (x - riveDroite(z)) * 0.96, 2.2);

/* Les dunes : trois houles de sable qui ne se répètent pas ensemble. */
const dunes = (x, z) => 0.5 * (0.55 + Math.sin(x * 0.21 + z * 0.13) * 0.6 + Math.sin(x * 0.07 - z * 0.19 + 1.3) * 0.8 + Math.sin(x * 0.43 + z * 0.37) * 0.25);

/* Les aires plates : sous les pieds du personnage (son ombre y est posée à
   y = 0) et sous la voiture. Rempli par `construireDecorDev`. */
const AIRES = [];
function hauteur(x, z){
  const s = terre(x, z);
  // la grève : sous l'eau la pente continue ; au-dessus, le bas de plage que
  // les vagues lèchent, raide, puis le haut de plage, presque plat
  let h = s < 0 ? NIVEAU + 0.10 * s : NIVEAU + 0.36 * (1 - Math.exp(-s / 1.5));
  h += dunes(x, z) * B.lisse(5, 18, s);
  // les rides que le vent laisse sur le haut de plage : de quoi accrocher la lumière rasante
  h += 0.06 * Math.sin(x * 1.7 + z * 0.9) * Math.sin(z * 1.25 - x * 0.45) * B.lisse(1.5, 4, s);
  h *= B.lisse(1.3, 3.4, Math.hypot(x, z));
  for (const a of AIRES){
    const k = B.lisse(a.r + a.fondu, a.r, Math.hypot((x - a.x) / a.ex, (z - a.z) / a.ez));
    h = B.mix(h, a.y, k);
  }
  return h;
}
/* La couleur du sable selon sa hauteur au-dessus de l'eau : mouillé, plus
   sombre et plus saturé, dans la bande que les vagues atteignent. */
function couleurSable(h, g){
  const e = h - NIVEAU;
  // l'ambiance du soir est mauve : elle mange le vert. Un sable clair y
  // paraîtrait rose ; on le veut pêche, d'où une base presque jaune.
  const sec = [1.0, 0.93, 0.58], mouille = [0.80, 0.62, 0.42], fond = [0.42, 0.40, 0.40];
  let c = B.melange(mouille, sec, B.lisse(0.10, 0.36, e));
  if (e < 0) c = B.melange(c, fond, B.lisse(0, -0.6, e));
  const k = 0.93 + g * 0.1;            // le grain : pas deux facettes du même ton
  return [c[0] * k, c[1] * k, c[2] * k, 1];
}
/* Le sable : une grille en éventail autour de la caméra principale — des
   rangs de plus en plus espacés avec la distance, pour que les facettes
   gardent à peu près la même taille à l'écran. Les triangles tout à fait
   noyés ne sont pas gardés : la mer les cache. */
function sable(){
  const M = new B.Maille(), al = B.graine(7);
  const [cx, cz] = CAM, nt = 36, th0 = -52 * B.DEG, th1 = 60 * B.DEG, q = 1.06;
  const rayons = [];
  for (let r = 2.0; ; r *= q){ rayons.push(Math.min(r, 340)); if (r >= 340) break; }
  const H = [];
  rayons.forEach((r, j) => {
    for (let i = 0; i <= nt; i++){
      // un peu de désordre : des facettes toutes pareilles feraient carrelage
      const bj = j > 0 && j < rayons.length - 1 ? (al() - 0.5) * 0.5 : 0;
      const bi = i > 0 && i < nt ? (al() - 0.5) * 0.5 : 0;
      const rr = r * Math.pow(q, bj), th = B.mix(th0, th1, (i + bi) / nt);
      const x = cx + rr * Math.sin(th), z = cz - rr * Math.cos(th), h = hauteur(x, z);
      H.push(h);
      M.sommet([x, h, z], null, couleurSable(h, al()));
    }
  });
  const noye = (a, b, c) => H[a] < NIVEAU - 0.45 && H[b] < NIVEAU - 0.45 && H[c] < NIVEAU - 0.45;
  const W = nt + 1;
  for (let j = 0; j < rayons.length - 1; j++) for (let i = 0; i < nt; i++){
    const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
    const t = (i + j) % 2 ? [[a, b, d], [a, d, c]] : [[a, b, c], [b, d, c]];
    t.forEach(([p, q2, r]) => { if (!noye(p, q2, r)) M.tri(p, q2, r); });
  }
  return M;
}

/* ---------------------------------------------------------------------------
   3. LA MER
   Pas `grilleMer` : ses rangs se resserrent près du bord jusqu'à dix
   centimètres pour cinq mètres de large (des stries, à l'écran), et elle
   tourne ses triangles vers le bas quand z1 < z0 (la face cachée, que le
   moteur ne dessine pas). Ici, un quinconce en trapèze : des rangs en
   progression géométrique depuis la caméra, une largeur qui s'ouvre avec la
   distance — des facettes de taille à peu près égale à l'écran, et rien de
   gaspillé sous la langue de sable. Le programme de la mer soulève chaque
   sommet ; il n'a besoin que de la position.
   --------------------------------------------------------------------------- */
function mer(){
  const M = new B.Maille();
  const [cx, cz] = CAM, nx = 40, q = 1.065;
  const rangs = [];
  for (let d = 6.4; ; d *= q){ rangs.push(Math.min(d, 336)); if (d >= 336) break; }
  const blanc = [1, 1, 1, 1];
  rangs.forEach((d, j) => {
    const z = cz - d, g = cx - (10 + 0.8 * d), dr = Math.min(cx + 10 + 0.8 * d, riveDroite(z) + 5);
    for (let i = 0; i <= nx; i++) M.sommet([B.mix(g, dr, (i + (j % 2) * 0.5) / (nx + 0.5)), NIVEAU, z], null, blanc);
  });
  const W = nx + 1;
  for (let j = 0; j < rangs.length - 1; j++) for (let i = 0; i < nx; i++){
    const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
    // la diagonale suit le décalage du rang suivant : des triangles presque équilatéraux
    if (j % 2 === 0){ M.tri(a, b, c); M.tri(b, d, c); }
    else { M.tri(a, b, d); M.tri(a, d, c); }
  }
  return M;
}

/* ---------------------------------------------------------------------------
   4. LES PALMIERS
   Des cocotiers, ceux des cartes postales. Le tronc est une pile de
   tambours, chacun plus large en haut qu'en bas : ce sont les cicatrices des
   palmes tombées, qui font les anneaux ; deux tons alternés les marquent
   encore. La couronne : des palmes qui partent en éventail puis retombent,
   chacune une nervure et deux rangs de folioles en dents de scie, vues des
   deux côtés (on les regarde par-dessous). Le vent : rien au pied, un peu en
   haut du tronc, beaucoup au bout des palmes.
   Chaque palmier est bâti à l'origine et planté par sa matrice : la phase du
   vent dépend de la place de l'objet, deux palmiers ne dansent donc pas au
   même pas. On ne les tourne pas : le vent souffle pour tous du même côté.
   --------------------------------------------------------------------------- */
/* Une foliole (ou toute feuille mince) : la face qui regarde le ciel prend
   `dessus`, l'autre `dessous`. */
function feuille(M, pts, dessus, dessous, v){
  const { v3 } = B;
  const n = v3.cross(v3.sub(pts[1], pts[0]), v3.sub(pts[2], pts[0]));
  if (n[1] >= 0) poly2(M, pts, dessus, dessous, v);
  else poly2(M, pts.slice().reverse(), dessus, dessous, Array.isArray(v) ? v.slice().reverse() : v);
}
/* Un octaèdre un peu écrasé : une noix de coco, à cette distance. */
function noix(M, c, r, col, v){
  const P = [[r, 0, 0], [-r, 0, 0], [0, r * 0.85, 0], [0, -r * 0.85, 0], [0, 0, r], [0, 0, -r]].map(q => B.v3.add(c, q));
  [[0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0], [0, 4, 3], [4, 1, 3], [1, 5, 3], [5, 0, 3]]
    .forEach(([a, b, d], i) => poly(M, [P[a], P[b], P[d]], teinte(col, i < 4 ? 1.08 : 0.9), v));
}
/* Une palme : la nervure part de `base` dans la direction `az`, avec
   l'élévation `elev`, puis s'incurve vers le sol ; les folioles pendent de
   part et d'autre (le V renversé des palmes de cocotier). */
function palme(M, base, az, elev, L, al, v0, vert){
  const { v3 } = B;
  const N = 10, chute = B.mix(1.3, 2.3, al());
  const dir = [Math.cos(az), 0, Math.sin(az)];
  const R = [base];
  for (let k = 1; k <= N; k++){
    const e = elev - chute * Math.pow(k / N, 1.5);
    R.push(v3.madd(R[k - 1], [dir[0] * Math.cos(e), Math.sin(e), dir[2] * Math.cos(e)], L / N));
  }
  const vent = k => v0 + 0.24 * Math.pow(k / N, 1.4);
  const dessus = teinte(vert, 0.9 + al() * 0.2), dessous = teinte(B.melange(vert, [0.75, 0.72, 0.35], 0.35), 1.1);
  for (let k = 0; k < N; k++){
    const s = (k + 0.5) / N;
    const w = L * 0.34 * Math.pow(Math.sin(Math.PI * Math.min(0.96, 0.12 + s * 0.9)), 0.7);
    const a = R[k], b = R[k + 1], t = v3.norm(v3.sub(b, a));
    const cote = v3.norm(v3.cross(t, [0, 1, 0]));
    for (const sg of [-1, 1]){
      // la pointe : de côté, vers le bas (le V), et un peu vers le bout de la palme
      const pointe = v3.add(v3.madd(v3.madd(b, cote, sg * w * 0.78), [0, -1, 0], w * 0.52), v3.mul(t, w * 0.3));
      feuille(M, [a, b, pointe], dessus, dessous, [vent(k), vent(k + 1), vent(k + 1) + 0.04]);
    }
  }
}
/* o : { h, pente: [dx, dz] du sommet, palmes, lp (longueur des palmes), r, g (graine) } */
function palmier(o){
  const { v3 } = B;
  const M = new B.Maille(); M.vent = [];
  const al = B.graine(o.g);
  // l'axe : une courbe de Bézier qui part penchée et se redresse vers le haut
  const P0 = [0, -0.12, 0], P1 = [o.pente[0] * 0.8, o.h * 0.45, o.pente[1] * 0.8], P2 = [o.pente[0], o.h, o.pente[1]];
  const axe = t => [0, 1, 2].map(i => (1 - t) * (1 - t) * P0[i] + 2 * t * (1 - t) * P1[i] + t * t * P2[i]);
  const ventT = t => 0.07 * t * t;
  const n = Math.round(o.h * 1.35), r = o.r || 0.19;
  const rayon = t => r * (1 - 0.36 * t) * (1 + 0.5 * Math.exp(-t * 16));      // le pied renflé
  const ecorce = [rvba('#9a7d68'), rvba('#76604f')];
  for (let k = 0; k < n; k++){
    const t0 = k / n, t1 = (k + 1) / n, c0 = axe(t0), c1 = axe(t1);
    const col = teinte(ecorce[k % 2], 0.94 + al() * 0.12);
    const tt = v3.norm(v3.sub(c1, c0));
    // le tambour, évasé en haut, puis la marche jusqu'au suivant
    cylindre(M, c0, c1, rayon(t0), rayon(t1) * 1.16, 7, col, { v: [ventT(t0), ventT(t1)], phase: k * 0.31 });
    cylindre(M, c1, v3.madd(c1, tt, 0.035), rayon(t1) * 1.16, rayon(t1), 7, teinte(col, 0.8), { v: [ventT(t1), ventT(t1)], phase: k * 0.31 });
  }
  const top = axe(1), vt = ventT(1);
  // les noix, en grappe sous la couronne
  const nn = 3 + Math.floor(al() * 3);
  for (let i = 0; i < nn; i++){
    const a = i / nn * B.TAU + al();
    noix(M, v3.add(top, [Math.cos(a) * 0.2, -0.22 - al() * 0.12, Math.sin(a) * 0.2]), 0.12, rvba(i % 2 ? '#6b5a22' : '#7c6a2a'), vt);
  }
  // la couronne
  const np = o.palmes || 9, lp = o.lp || (3.0 + o.h * 0.2);
  const verts = [rvba('#3f7a35'), rvba('#4d8a3a'), rvba('#6a8a34')];
  for (let i = 0; i < np; i++){
    const az = i / np * B.TAU + (al() - 0.5) * 0.45 + (o.az || 0);
    const jeune = i % 4 === 0;                                 // quelques jeunes palmes, dressées
    let elev = jeune ? B.mix(0.55, 0.9, al()) : B.mix(-0.05, 0.35, al()), k = jeune ? 0.8 : B.mix(0.9, 1.08, al());
    // `evite` : une direction où les palmes restent courtes et hautes — celle
    // où elles viendraient barrer la tête du personnage, vue de la caméra
    if (o.evite != null){
      const d = Math.abs(Math.atan2(Math.sin(az - o.evite), Math.cos(az - o.evite)));
      if (d < 1.1){ const t = d / 1.1; k *= B.mix(0.35, 1, t); elev += 0.5 * (1 - t); }
    }
    palme(M, v3.add(top, [0, 0.05, 0]), az, elev, lp * k, al, vt, verts[Math.floor(al() * 3)]);
  }
  return M;
}
/* Leur place : un à gauche, au bord de l'eau, dont le tronc et les palmes
   encadrent le coin de l'image (plus près, on ne verrait qu'un tronc ; plus
   à gauche, rien). Les autres sur la langue de sable, assez loin pour qu'on
   voie leur couronne contre le ciel ; le deuxième penche vers la baie, sa
   couronne tombe dans la partie de l'écran que le panneau ne couvre pas, et
   le dernier, tout au bout, se dresse au-dessus de l'aileron de la voiture. */
const PALMIERS = [
  { x: -4.3, z: -6.3, h: 5.3, pente: [1.1, 0.25], palmes: 10, g: 11, evite: 0.25 },
  { x: 4.5, z: -22, h: 8.6, pente: [-1.7, 0.4], palmes: 10, g: 13 },
  { x: 6.0, z: -41, h: 9.0, pente: [-0.9, 0.2], palmes: 9, g: 14 },
  { x: 6.6, z: -30.5, h: 6.9, pente: [1.0, -0.3], palmes: 9, g: 15 },
  { x: 11.5, z: -23, h: 7.8, pente: [0.7, 0.6], palmes: 9, g: 16 },
  { x: 14.5, z: -54, h: 8.2, pente: [-0.5, 0.0], palmes: 8, g: 17 },
  { x: 5.6, z: -72, h: 8.8, pente: [-1.4, 0.2], palmes: 8, g: 12 },
];

/* ---------------------------------------------------------------------------
   5. LA CADILLAC
   Une Eldorado Biarritz de 1959, décapotée, rose bonbon : la voiture la plus
   « Miami » qui soit. Ce qui la fait reconnaître, dans l'ordre : les
   ailerons démesurés et les deux feux-obus plantés dans chacun, la longueur
   (5,7 m pour 1,3 m de haut), le chrome, les flancs blancs des pneus, le
   pare-brise panoramique qui s'enroule sur les côtés.
   La caisse est un LOFT : une suite de sections (la moitié droite d'une
   coupe, du bas de caisse jusqu'à l'axe), cousues bout à bout. Une section
   dit tout d'un coup : la passe de roue (le bas de caisse remonte en arc),
   l'aileron (l'arête haute monte et se pince vers l'arrière), l'habitacle
   (le dessus plonge : la garniture, puis le plancher). Chaque bande de la
   section a sa couleur : l'enjoliveur du bas de caisse, la baguette, la tôle.
   Repère de la voiture : x vers l'avant, y en haut, z à sa droite.
   --------------------------------------------------------------------------- */
const XR = -1.49, XF = 1.81, R_ROUE = 0.38, R_PASSE = 0.47;    // essieux (3,30 m d'empattement), roue, passe
const X_AR = -2.86, X_AV = 2.86;                                // la caisse, hors pare-chocs
const HAB0 = -1.10, HAB1 = 0.60;                                // l'habitacle : de la banquette arrière au tableau de bord
const JOURS = [[0.64, 0.66], [-0.64, -0.62]];                   // les jours des portières

/* La section à l'abscisse x : dix points [z, y], du bas de caisse à l'axe. */
function section(x, ouvert){
  const { lisse } = B;
  const w = 1.0 - 0.03 * lisse(2.3, 2.86, Math.abs(x));         // les coins s'arrondissent un peu
  let yA = 0.30 + 0.12 * lisse(2.1, 2.86, -x) + 0.08 * lisse(2.3, 2.86, x);
  for (const xa of [XR, XF]){
    const d = x - xa;
    if (Math.abs(d) < R_PASSE) yA = Math.max(yA, R_ROUE + Math.sqrt(R_PASSE * R_PASSE - d * d) * 0.95);
  }
  // l'aileron : de plus en plus vite vers l'arrière, et de plus en plus mince
  const f = x < -0.2 ? Math.pow((-0.2 - x) / 2.66, 1.7) : 0;
  const yF = 0.93 + 0.19 * f - 0.025 * lisse(2.0, 2.86, x);
  // au-dessus des roues, les bandes se serrent contre l'arc : la baguette en devient l'enjoliveur de la passe
  const yB = Math.max(0.42, yA + 0.05), yC = Math.max(0.60, yB + 0.015), yD = Math.max(0.635, yC + 0.03), yE = Math.max(0.86, yD + 0.03);
  const zG = w * (0.88 - 0.16 * f), yG = 0.945 - 0.02 * f;
  const P = [[w * 0.975, yA], [w * 0.99, yB], [w, yC], [w, yD], [w * 0.99, yE], [w * (0.955 - 0.045 * f), yF], [zG, yG]];
  if (ouvert) P.push([0.855 * w, 0.90], [0.835 * w, 0.40], [0, 0.37]);
  else {
    const yH = x < 0 ? 0.925 : 0.955 - 0.035 * lisse(1.2, 2.86, x);   // le coffre ; le capot, qui plonge vers l'avant
    P.push([zG * 0.62, B.mix(yG, yH, 0.6)], [zG * 0.3, B.mix(yG, yH, 0.9)], [0, yH]);
  }
  return P;
}
/* Les abscisses des sections : serrées autour des roues, doublées aux deux
   bouts de l'habitacle (fermée d'un côté, ouverte de l'autre : la bande qui
   les relie est la paroi du baquet). */
function stations(){
  const L = [[X_AR, 3], [X_AV, 3], [HAB0, 3], [HAB1, 3]];
  JOURS.forEach(([a, b]) => L.push([a, 2], [b, 2]));
  for (const xa of [XR, XF]) for (let k = -5; k <= 5; k++) L.push([xa + k * R_PASSE / 5, 1]);
  for (let x = X_AR; x < X_AV; x += 0.2) L.push([x, 0]);
  L.sort((a, b) => b[1] - a[1]);
  const xs = [];
  for (const [x, p] of L) if (!xs.some(g => Math.abs(g - x) < (p === 2 ? 0.005 : 0.035))) xs.push(x);
  xs.sort((a, b) => a - b);
  const S = [];
  for (const x of xs){
    if (x === HAB0) S.push([x, false], [x, true]);
    else if (x === HAB1) S.push([x, true], [x, false]);
    else S.push([x, x > HAB0 && x < HAB1]);
  }
  return S;
}
function couleurBande(x0, x1, j, ouvert, C){
  if (x1 - x0 < 1e-6) return j >= 6 ? C.creme : C.rose;                 // les parois du baquet
  if (j >= 1 && j <= 5 && JOURS.some(([a, b]) => Math.abs(x0 - a) < 1e-6 && Math.abs(x1 - b) < 1e-6)) return C.jour;
  if (j === 0) return C.chromeBas;
  if (j === 2) return C.chrome;
  if (j === 1 && x1 < -2.0) return C.chrome;                              // l'écusson chromé du bas d'aile arrière
  if (ouvert && j === 7) return C.creme;
  if (ouvert && j === 8) return C.tapis;
  return C.rose;
}
/* Un polygone plan quelconque (concave : le cul de la voiture, entre ses
   ailerons), découpé en triangles par la méthode des oreilles. `P` : les
   points en 2D ; rend des triplets d'indices, dans le sens trigonométrique. */
function oreilles(P){
  let idx = P.map((_, i) => i);
  const aire = (a, b, c) => (P[b][0] - P[a][0]) * (P[c][1] - P[a][1]) - (P[b][1] - P[a][1]) * (P[c][0] - P[a][0]);
  let s = 0;
  idx.forEach((a, i) => { const b = idx[(i + 1) % idx.length]; s += P[a][0] * P[b][1] - P[b][0] * P[a][1]; });
  if (s < 0) idx.reverse();
  const T = [];
  for (let garde = 0; idx.length > 3 && garde < 800; garde++){
    const n = idx.length;
    let fait = false;
    for (let k = 0; k < n && !fait; k++){
      const a = idx[(k + n - 1) % n], b = idx[k], c = idx[(k + 1) % n], ar = aire(a, b, c);
      if (Math.abs(ar) < 1e-9){ idx.splice(k, 1); fait = true; break; }          // trois points alignés : le milieu ne sert à rien
      if (ar < 0) continue;                                                      // un creux
      if (idx.some(j => j !== a && j !== b && j !== c && aire(a, b, j) >= 0 && aire(b, c, j) >= 0 && aire(c, a, j) >= 0)) continue;
      T.push([a, b, c]); idx.splice(k, 1); fait = true;
    }
    if (!fait) break;
  }
  if (idx.length === 3 && aire(idx[0], idx[1], idx[2]) > 1e-9) T.push(idx.slice());
  return T;
}
/* Le fond d'un bout de la caisse (le cul, ou la face avant), plan. */
function fondCaisse(M, x, sec, sens, c){
  const cont = sec.concat(sec.slice(0, -1).reverse().map(([z, y]) => [-z, y]));
  // vu de derrière, +z est à droite ; vu de devant, à gauche
  const T = oreilles(cont.map(([z, y]) => [sens < 0 ? z : -z, y]));
  T.forEach(t => poly(M, t.map(k => [x, cont[k][1], cont[k][0]]), c));
}
function carrosserie(M, C){
  const ST = stations(), secs = ST.map(([x, o]) => section(x, o));
  const { v3 } = B;
  for (let i = 0; i < ST.length - 1; i++){
    const [x0, o0] = ST[i], [x1, o1] = ST[i + 1], A = secs[i], Z = secs[i + 1];
    for (let j = 0; j < A.length - 1; j++){
      const c = couleurBande(x0, x1, j, o0 && o1, C);
      for (const sg of [1, -1]){
        const q = [[x0, A[j][1], sg * A[j][0]], [x1, Z[j][1], sg * Z[j][0]], [x1, Z[j + 1][1], sg * Z[j + 1][0]], [x0, A[j + 1][1], sg * A[j + 1][0]]];
        const n = v3.cross(v3.sub(q[2], q[0]), v3.sub(q[3], q[1]));
        if (v3.len(n) < 1e-7) continue;                                          // bande nulle (sections doublées)
        poly(M, sg > 0 ? q : [q[0], q[3], q[2], q[1]], c);
      }
    }
  }
  fondCaisse(M, X_AR, secs[0], -1, C.rose);
  fondCaisse(M, X_AV, secs[secs.length - 1], 1, C.rose);
  // le fond des passes de roue : sans lui, on verrait à travers la voiture
  for (const xa of [XR, XF]) for (const sg of [1, -1]){
    const pts = [];
    for (let k = 0; k <= 8; k++){ const a = Math.PI * k / 8; pts.push([xa + Math.cos(a) * R_PASSE, R_ROUE + Math.sin(a) * R_PASSE * 0.95, sg * 0.62]); }
    pts.push([xa - R_PASSE, 0.1, sg * 0.62], [xa + R_PASSE, 0.1, sg * 0.62]);
    poly(M, sg > 0 ? pts : pts.slice().reverse(), C.passe);
  }
}
/* Une roue : la bande de roulement, puis, du bord vers le moyeu, le flanc
   noir, le flanc blanc, la jante et l'enjoliveur bombé. */
function roue(M, x, cote, C){
  const y = R_ROUE, zi = cote * 0.69, zo = cote * 0.91, n = 14;
  cylindre(M, [x, y, zi], [x, y, zo], R_ROUE, R_ROUE, n, C.pneu);
  const A = [[R_ROUE, 0, C.pneu], [0.32, 0.012, C.flanc], [0.235, 0.016, C.pneu], [0.215, 0.02, C.chrome], [0.08, 0.055, C.chromeBas], [0, 0.08]];
  for (let k = 0; k < A.length - 1; k++){
    const [r0, d0, c] = A[k], [r1, d1] = A[k + 1];
    cylindre(M, [x, y, zo + cote * d0], [x, y, zo + cote * (d1 + 1e-3)], r0, r1, n, c);
  }
}
/* Le pare-brise panoramique : il s'enroule sur les côtés, ses montants
   partent vers l'arrière. Le verre prend la couleur du ciel qu'il renvoie. */
function pareBrise(M, C){
  const { v3 } = B;
  const bas = [[0.36, -0.9], [0.54, -0.8], [0.63, -0.45], [0.65, 0], [0.63, 0.45], [0.54, 0.8], [0.36, 0.9]].map(([x, z]) => [x, 0.955, z]);
  const haut = [[0.1, -0.84], [0.25, -0.76], [0.31, -0.43], [0.33, 0], [0.31, 0.43], [0.25, 0.76], [0.1, 0.84]].map(([x, z]) => [x, 1.32 - 0.05 * Math.abs(z), z]);
  for (let i = 0; i < bas.length - 1; i++){
    const b0 = bas[i], b1 = bas[i + 1], h0 = haut[i], h1 = haut[i + 1];
    const m0 = v3.lerp(b0, h0, 0.9), m1 = v3.lerp(b1, h1, 0.9);
    poly2(M, [b0, b1, m1, m0], [C.verreBas, C.verreBas, C.verre, C.verre], [C.verre, C.verre, C.verreBas, C.verreBas]);
    poly2(M, [m0, m1, h1, h0], C.chrome, C.chromeBas);
  }
  for (const i of [0, bas.length - 1]) cylindre(M, bas[i], haut[i], 0.024, 0.02, 4, C.chrome);
}
/* Un dossier capitonné (les boudins du « tuck and roll ») : `n` boudins
   côte à côte, inclinés vers l'arrière de `incl` degrés. */
function dossier(M, x, y, z0, z1, h, incl, C){
  const T = place(B.q4.axe([0, 0, 1], incl * B.DEG), [x, y, 0]);
  const n = Math.max(3, Math.round((z1 - z0) / 0.15));
  for (let k = 0; k < n; k++){
    const za = B.mix(z0, z1, k / n), zb = B.mix(z0, z1, (k + 1) / n), e = k % 2 ? 0.02 : 0;
    const c = teinte(C.creme, k % 2 ? 1.04 : 0.94);
    boite(M, coins(-0.13, 0.02 + e, 0, h, za, zb, T), [c, c, c, teinte(c, 1.05), null, teinte(c, 1.08)]);
  }
}
/* L'habitacle : deux banquettes crème, le tableau de bord, le volant, et la
   capote repliée sous son couvre-capote. */
function habitacle(M, C){
  const { v3 } = B;
  const assise = (x0, x1, z0, z1) => boite(M, coins(x0, x1, 0.38, 0.6, z0, z1), [C.creme, C.creme, teinte(C.creme, 0.9), teinte(C.creme, 0.9), null, teinte(C.creme, 1.08)]);
  assise(-0.32, 0.22, -0.8, 0.8);
  dossier(M, -0.33, 0.58, -0.8, -0.04, 0.44, 14, C);
  dossier(M, -0.33, 0.58, 0.04, 0.8, 0.44, 14, C);
  assise(-1.05, -0.58, -0.82, 0.82);
  dossier(M, -1.06, 0.58, -0.82, 0.82, 0.38, 10, C);
  // le tableau de bord, et sa baguette
  boite(M, coins(0.46, 0.63, 0.6, 0.975, -0.84, 0.84), [C.rose, C.rose, C.creme, C.rose, null, teinte(C.rose, 0.8)]);
  boite(M, coins(0.44, 0.47, 0.8, 0.86, -0.8, 0.8), C.chrome);
  // le volant, côté conducteur (à gauche : −z), incliné vers lui
  const c = [0.3, 0.93, -0.42], ax = v3.norm([1, -0.8, 0]);
  const u = v3.norm(v3.cross(ax, [0, 0, 1])), w = v3.cross(ax, u);
  const N = 12, m = 4, R = 0.19, r = 0.02;
  const P = (i, j) => { const th = i / N * B.TAU, ph = j / m * B.TAU, e = v3.add(v3.mul(u, Math.cos(th)), v3.mul(w, Math.sin(th)));
    return v3.add(c, v3.add(v3.mul(e, R + r * Math.cos(ph)), v3.mul(ax, r * Math.sin(ph)))); };
  for (let i = 0; i < N; i++) for (let j = 0; j < m; j++) poly(M, [P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)], C.creme);
  for (const th of [0.5, 2.6, 4.7]){
    const e = v3.add(v3.mul(u, Math.cos(th)), v3.mul(w, Math.sin(th)));
    cylindre(M, c, v3.madd(c, e, R), 0.012, 0.012, 4, C.chrome);
  }
  cylindre(M, v3.madd(c, ax, -0.02), v3.madd(c, ax, 0.3), 0.03, 0.035, 6, C.chrome, { fa: C.chrome });
  // la capote repliée, sous son couvre-capote blanc
  const prof = [[-1.46, 0.925], [-1.41, 1.0], [-1.28, 1.04], [-1.15, 1.01], [-1.1, 0.93]];
  for (let k = 0; k < prof.length - 1; k++){
    const [xa, ya] = prof[k], [xb, yb] = prof[k + 1];
    poly(M, [[xa, ya, 0.86], [xb, yb, 0.86], [xb, yb, -0.86], [xa, ya, -0.86]], teinte(C.creme, 0.95 + 0.04 * k));
  }
  for (const sg of [1, -1]){
    const pts = prof.map(([x, y]) => [x, y, sg * 0.86]);
    poly(M, sg > 0 ? pts : pts.reverse(), teinte(C.creme, 0.9));
  }
}
/* Les chromes et les feux : pare-chocs enveloppants, obus des butoirs, les
   quatre phares, et à l'arrière ce qui signe la voiture — deux feux-obus
   rouges dans la pointe de chaque aileron. */
function chromes(M, C){
  const bouclier = (x0, x1) => {
    boiteChrome(M, coins(x0, x1, 0.27, 0.53, -0.99, 0.99), C.chromeBas, C.chrome, C.chromeHaut);
    for (const sg of [1, -1]){
      const xa = x0 < 0 ? x0 + 0.05 : x1 - 0.5, xb = x0 < 0 ? x0 + 0.5 : x1 - 0.05;
      boiteChrome(M, coins(xa, xb, 0.29, 0.51, sg > 0 ? 0.95 : -1.035, sg > 0 ? 1.035 : -0.95), C.chromeBas, C.chrome, C.chromeHaut);
    }
  };
  bouclier(X_AR - 0.17, X_AR + 0.02);
  bouclier(X_AV - 0.02, X_AV + 0.16);
  for (const sg of [1, -1]){
    // à l'arrière : les nacelles des feux de recul, et la plaque
    cylindre(M, [X_AR - 0.12, 0.4, sg * 0.6], [X_AR - 0.24, 0.4, sg * 0.6], 0.1, 0.085, 8, C.chrome, { fb: C.recul });
    // à l'avant : les deux obus des butoirs
    cylindre(M, [X_AV + 0.1, 0.44, sg * 0.42], [X_AV + 0.32, 0.44, sg * 0.42], 0.075, 0, 8, C.chrome);
    // la pointe de l'aileron, qui file au-dessus des feux
    const F = [X_AR, 1.12, sg * 0.884], Fe = [X_AR, 1.035, sg * 0.955], Fi = [X_AR, 1.035, sg * 0.83], P = [X_AR - 0.24, 1.1, sg * 0.9];
    if (sg > 0){ poly(M, [Fe, F, P], C.rose); poly(M, [F, Fi, P], C.rose); poly(M, [Fi, Fe, P], teinte(C.rose, 0.8)); }
    else { poly(M, [F, Fe, P], C.rose); poly(M, [Fi, F, P], C.rose); poly(M, [Fe, Fi, P], teinte(C.rose, 0.8)); }
    // les feux-obus, deux par aileron, dans leur boîtier chromé
    const zf = sg * 0.92, yf = 1.03;
    boiteChrome(M, coins(X_AR - 0.035, X_AR + 0.01, 0.82, yf + 0.005, zf - 0.065, zf + 0.065), C.chromeBas, C.chrome, C.chromeHaut);
    for (const y of [yf - 0.06, yf - 0.16]){
      cylindre(M, [X_AR - 0.03, y, zf], [X_AR - 0.1, y, zf], 0.048, 0.048, 8, C.feu);
      cylindre(M, [X_AR - 0.1, y, zf], [X_AR - 0.19, y, zf], 0.048, 0, 8, C.feu);
    }
    // les quatre phares, dans leurs cerclages
    for (const z of [0.58, 0.8]){
      cylindre(M, [X_AV - 0.02, 0.8, sg * z], [X_AV + 0.035, 0.8, sg * z], 0.095, 0.09, 10, C.chrome);
      cylindre(M, [X_AV + 0.035, 0.8, sg * z], [X_AV + 0.05, 0.8, sg * z], 0.075, 0.06, 10, C.phare, { fb: C.phare });
    }
  }
  boite(M, coins(X_AR - 0.18, X_AR - 0.16, 0.33, 0.47, -0.22, 0.22), C.passe);
  // entre les ailerons, la « calandre » arrière de 1959 : un bandeau sombre
  // barré de chrome, et le jonc du bord de coffre
  boite(M, coins(X_AR - 0.03, X_AR + 0.01, 0.57, 0.75, -0.8, 0.8), [null, null, C.passe, null, null, C.chrome]);
  for (const y of [0.6, 0.66, 0.72]) boite(M, coins(X_AR - 0.05, X_AR - 0.02, y, y + 0.022, -0.78, 0.78), [null, null, C.chrome, null, null, C.chromeHaut]);
  boiteChrome(M, coins(X_AR - 0.05, X_AR + 0.01, 0.75, 0.79, -0.82, 0.82), C.chromeBas, C.chrome, C.chromeHaut);
  boiteChrome(M, coins(X_AR - 0.03, X_AR + 0.01, 0.885, 0.91, -0.74, 0.74), C.chromeBas, C.chrome, C.chromeHaut);
  // la calandre : un fond sombre et deux barres
  boite(M, coins(X_AV - 0.01, X_AV + 0.025, 0.52, 0.74, -0.68, 0.68), C.passe);
  for (const y of [0.57, 0.67]) boite(M, coins(X_AV + 0.02, X_AV + 0.045, y, y + 0.035, -0.66, 0.66), C.chrome);
}
function cadillac(){
  const M = new B.Maille();
  const C = {
    rose: rvba('#ff4da6'), jour: rvba('#8a1f58'), tapis: rvba('#6e1a44'), creme: rvba('#fbf0de'), passe: rvba('#1c1420'),
    chrome: rvba('#eeeef6'), chromeHaut: rvba('#ffffff', 0.8), chromeBas: rvba('#5d5870'),
    pneu: rvba('#1a1618'), flanc: rvba('#f4f1ea'),
    verre: rvba('#b9c4ee'), verreBas: rvba('#7c86b8'),
    feu: rvba('#ff1a2e', 0.12), phare: rvba('#fff4cf', 0.3), recul: rvba('#ffe9f0', 0.6),
  };
  carrosserie(M, C);
  for (const x of [XR, XF]) for (const sg of [1, -1]) roue(M, x, sg, C);
  pareBrise(M, C);
  habitacle(M, C);
  chromes(M, C);
  return M;
}
/* Garée derrière le personnage, à sa gauche, le cul vers lui : la caméra
   voit son flanc droit et ses ailerons en trois-quarts arrière. */
const CADILLAC = { x: 3.4, z: -4.3, cap: 22 };

/* ---------------------------------------------------------------------------
   6. LA TOUR DU SAUVETEUR
   Celles de Miami Beach : une cabane pastel à rayures perchée sur pilotis,
   une rampe pour y monter, un toit en pointe, un fanion au vent.
   --------------------------------------------------------------------------- */
function tourSauveteur(){
  const M = new B.Maille(); M.vent = [];
  const C = { mur: rvba('#ffd76a'), bande: rvba('#3cc9c0'), toit: rvba('#ff5c9d'), bois: rvba('#d7b08a'), pied: rvba('#f3ece6'),
    vitre: rvba('#2a3f66'), rouge: rvba('#ff3040'), jaune: rvba('#ffe04a') };
  const Y0 = 1.7, Y1 = 3.75;                      // le plancher, le haut des murs
  // les pilotis, un peu écartés vers le bas
  for (const [x, z] of [[-0.95, -0.85], [0.95, -0.85], [-0.95, 0.85], [0.95, 0.85]]) cylindre(M, [x * 1.08, -0.3, z * 1.08], [x, Y0, z], 0.09, 0.08, 4, C.pied);
  boite(M, coins(-1.35, 1.35, Y0, Y0 + 0.14, -1.2, 1.3), [C.bois, C.bois, C.bois, C.bois, teinte(C.bois, 0.7), teinte(C.bois, 1.05)]);
  // la cabane : des lés verticaux, jaune et turquoise en alternance
  const n = 7;
  for (let k = 0; k < n; k++){
    const x0 = B.mix(-1.0, 1.0, k / n), x1 = B.mix(-1.0, 1.0, (k + 1) / n), c = k % 2 ? C.bande : C.mur;
    boite(M, coins(x0, x1, Y0 + 0.14, Y1, -0.9, 0.9), [c, c, null, null, null, null]);
  }
  boite(M, coins(-1.0, 1.0, Y0 + 0.14, Y1, -0.9, 0.9), [null, null, C.mur, C.bande, null, null]);
  // les vitres, en bandeau sur trois côtés
  boite(M, coins(-0.8, 0.8, 2.75, 3.4, 0.9, 0.93), C.vitre);
  boite(M, coins(1.0, 1.03, 2.75, 3.4, -0.6, 0.6), C.vitre);
  boite(M, coins(-1.03, -1.0, 2.75, 3.4, -0.6, 0.6), C.vitre);
  // le toit en pointe, qui déborde
  const s = [[-1.3, Y1, -1.15], [1.3, Y1, -1.15], [1.3, Y1, 1.15], [-1.3, Y1, 1.15]], som = [0, Y1 + 0.95, 0];
  for (let k = 0; k < 4; k++) poly(M, [s[(k + 1) % 4], s[k], som], teinte(C.toit, k % 2 ? 0.92 : 1.05));
  poly(M, s, teinte(C.toit, 0.6));
  // la rampe, du plancher au sable, avec sa main courante
  const r0 = [0.25, Y0 + 0.1, 1.3], r1 = [0.25, -0.05, 4.4];
  boite(M, [[-0.3, r0[1] - 0.08, r0[2]], [0.8, r0[1] - 0.08, r0[2]], [0.8, r0[1], r0[2]], [-0.3, r0[1], r0[2]],
    [-0.3, r1[1] - 0.08, r1[2]], [0.8, r1[1] - 0.08, r1[2]], [0.8, r1[1], r1[2]], [-0.3, r1[1], r1[2]]],
    [C.bois, C.bois, C.bois, C.bois, null, teinte(C.bois, 1.08)]);
  for (const x of [-0.3, 0.8]){
    cylindre(M, [x, r0[1], r0[2]], [x, r0[1] + 0.85, r0[2]], 0.03, 0.03, 4, C.pied);
    cylindre(M, [x, r1[1], r1[2] - 0.2], [x, r1[1] + 0.85, r1[2] - 0.2], 0.03, 0.03, 4, C.pied);
    cylindre(M, [x, r0[1] + 0.85, r0[2]], [x, r1[1] + 0.85, r1[2] - 0.2], 0.025, 0.025, 4, C.pied);
  }
  // la rambarde du balcon
  cylindre(M, [-1.3, Y0 + 0.95, 1.25], [1.3, Y0 + 0.95, 1.25], 0.03, 0.03, 4, C.pied);
  for (const x of [-1.3, -0.35, 1.3]) cylindre(M, [x, Y0 + 0.1, 1.25], [x, Y0 + 0.95, 1.25], 0.03, 0.03, 4, C.pied);
  // le mât et le fanion, qui claque au bout
  const mat = [0.9, Y1 + 0.3, -0.9];
  cylindre(M, [0.9, Y1 - 0.2, -0.9], v3add(mat, [0, 2.1, 0]), 0.03, 0.025, 4, C.pied);
  const f0 = v3add(mat, [0, 2.05, 0]), f1 = v3add(mat, [0, 1.55, 0]);
  poly2(M, [f0, f1, v3add(mat, [0.05, 1.82, 0.85])], C.rouge, C.rouge, [0, 0, 0.18]);
  poly2(M, [f1, v3add(mat, [0, 1.3, 0]), v3add(mat, [0.05, 1.55, 0.8])], C.jaune, C.jaune, [0, 0, 0.16]);
  return M;
}

/* ---------------------------------------------------------------------------
   7. SUR LE SABLE : LE PARASOL, LA SERVIETTE, L'ÉTOILE DE MER
   --------------------------------------------------------------------------- */
function parasol(){
  const M = new B.Maille(); M.vent = [];
  const pied = [0, -0.25, 0], haut = [0.12, 2.3, 0.05];
  cylindre(M, pied, haut, 0.025, 0.02, 5, rvba('#f4efe8'));
  const n = 8, R = 1.15, c = [haut[0], 2.36, haut[2]], bord = 1.92;
  const toiles = [rvba('#ffffff'), rvba('#2fc4c8')];
  for (let k = 0; k < n; k++){
    const a0 = k / n * B.TAU, a1 = (k + 1) / n * B.TAU;
    const p0 = [c[0] + Math.cos(a0) * R, bord, c[2] + Math.sin(a0) * R], p1 = [c[0] + Math.cos(a1) * R, bord, c[2] + Math.sin(a1) * R];
    // par-dessus, la toile rayée ; par-dessous, la même, à l'ombre
    poly2(M, [p1, p0, c], toiles[k % 2], teinte(toiles[k % 2], 0.8), [0.04, 0.04, 0.01]);
  }
  cylindre(M, c, [c[0], c[1] + 0.12, c[2]], 0.03, 0.0, 5, rvba('#f4efe8'), { v: [0.01, 0.01] });
  return M;
}
/* La serviette, posée en travers, qui épouse le sable (une grille de 6 × 2). */
function serviette(x, z, ang){
  const M = new B.Maille();
  const L = 1.8, l = 0.9, nx = 6, nz = 2, ca = Math.cos(ang), sa = Math.sin(ang);
  const bandes = [rvba('#ff4fa0'), rvba('#ffffff'), rvba('#ffb03a'), rvba('#ffffff'), rvba('#2fc4c8'), rvba('#ff4fa0')];
  const P = (i, j) => {
    const u = (i / nx - 0.5) * L, v = (j / nz - 0.5) * l, px = x + u * ca - v * sa, pz = z + u * sa + v * ca;
    return [px, hauteur(px, pz) + 0.025 + 0.012 * Math.sin(i * 2.1 + j), pz];
  };
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) poly(M, [P(i, j), P(i, j + 1), P(i + 1, j + 1), P(i + 1, j)], bandes[i]);
  return M;
}

/* Un bout de caillebotis, des planches grises de sel posées sur deux
   longerons, qui mène du bas de l'image vers l'arrière de la voiture. */
function caillebotis(a, b, larg){
  const M = new B.Maille(), al = B.graine(31), { v3 } = B;
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], n = [-d[1], d[0]];
  const bois = rvba('#c9a88c'), longeron = rvba('#8d7260');
  const P = (u, v, y) => { const x = a[0] + d[0] * u + n[0] * v, z = a[1] + d[1] * u + n[1] * v; return [x, hauteur(x, z) + y, z]; };
  // les deux longerons, à fleur de sable
  for (const v of [-larg * 0.38, larg * 0.38]){
    const k = [P(0, v - 0.05, -0.02), P(L, v - 0.05, -0.02), P(L, v - 0.05, 0.05), P(0, v - 0.05, 0.05)];
    poly(M, [k[0], k[1], k[2], k[3]].reverse(), longeron);
    poly(M, [P(0, v - 0.05, 0.05), P(L, v - 0.05, 0.05), P(L, v + 0.05, 0.05), P(0, v + 0.05, 0.05)].reverse(), longeron);
  }
  // les planches, chacune un peu de travers et d'un ton à elle
  for (let u = 0.05; u + 0.15 < L; u += 0.195){
    const c = teinte(bois, 0.86 + al() * 0.2), j = (al() - 0.5) * 0.03;
    const k = [[u + j, -larg / 2], [u + 0.15 - j, -larg / 2], [u + 0.15 + j, larg / 2], [u - j, larg / 2]];
    const bas = k.map(([uu, vv]) => P(uu, vv, 0.05)), haut = k.map(([uu, vv]) => P(uu, vv, 0.085));
    versLeCiel(M, [haut[0], haut[1], haut[2]], c); versLeCiel(M, [haut[0], haut[2], haut[3]], c);
    for (let i = 0; i < 4; i++){
      const i2 = (i + 1) % 4;
      feuille(M, [bas[i], bas[i2], haut[i2]], teinte(c, 0.75), teinte(c, 0.75));
    }
  }
  return M;
}
/* Une étoile de mer et quelques coquillages, au premier plan : de quoi
   donner l'échelle au sable, sans rien mettre dans les pieds du personnage. */
function versLeCiel(M, pts, c){                        // un triangle posé, tourné vers le haut
  const { v3 } = B, n = v3.cross(v3.sub(pts[1], pts[0]), v3.sub(pts[2], pts[0]));
  poly(M, n[1] >= 0 ? pts : pts.slice().reverse(), c);
}
function coquillages(){
  const M = new B.Maille();
  const etoile = (x, z, r, ang, c) => {
    const y = hauteur(x, z) + 0.01, cen = [x, y + 0.02, z];
    for (let k = 0; k < 5; k++){
      const a = ang + k / 5 * B.TAU, e = B.TAU / 10;
      const bout = [x + Math.cos(a) * r, y + 0.005, z + Math.sin(a) * r];
      const g = [x + Math.cos(a - e) * r * 0.36, y + 0.012, z + Math.sin(a - e) * r * 0.36];
      const d = [x + Math.cos(a + e) * r * 0.36, y + 0.012, z + Math.sin(a + e) * r * 0.36];
      versLeCiel(M, [cen, g, bout], c);
      versLeCiel(M, [cen, bout, d], teinte(c, 0.85));
    }
  };
  // un pétoncle : un éventail de côtes, bombé au milieu
  const coquille = (x, z, r, ang, c) => {
    const y = hauteur(x, z) + 0.008, ch = [x, y, z], n = 5;
    for (let k = 0; k < n; k++){
      const a0 = ang + (k / n - 0.5) * 2.2, a1 = ang + ((k + 1) / n - 0.5) * 2.2, h = 0.02 * Math.sin(Math.PI * (k + 0.5) / n);
      versLeCiel(M, [ch, [x + Math.cos(a0) * r, y + h, z + Math.sin(a0) * r], [x + Math.cos(a1) * r, y + h, z + Math.sin(a1) * r]], teinte(c, k % 2 ? 1 : 0.88));
    }
  };
  etoile(-1.16, -1.2, 0.15, 0.4, rvba('#ffa07a'));
  coquille(1.36, -1.8, 0.07, 1.2, rvba('#fff0e0'));
  coquille(-1.74, -3.3, 0.08, -0.6, rvba('#ffc9b8'));
  coquille(2.6, 0.2, 0.07, 2.2, rvba('#f7e3ff'));
  coquille(-0.7, -2.6, 0.05, 0.3, rvba('#ffe6c8'));
  return M;
}

/* ---------------------------------------------------------------------------
   8. AU LOIN : OCEAN DRIVE, DE L'AUTRE CÔTÉ DE LA BAIE, ET UN VOILIER
   Une presqu'île basse, à deux cents mètres sur la gauche, et ses hôtels
   Art déco : des blocs pastel, un fronton en gradins, une tour d'angle, une
   enseigne verticale ; des néons roses et turquoise le long des corniches,
   quelques fenêtres allumées, des palmiers sur la promenade.
   Le soleil est derrière eux : leurs façades sont à l'ombre, et la brume du
   soir les délave. Des pastels trop clairs s'y fondraient dans le ciel ; on
   les prend donc à mi-teinte, pour qu'ils restent des silhouettes. Les néons,
   qui brillent d'eux-mêmes, percent la brume.
   --------------------------------------------------------------------------- */
const quaiZ = x => { const t = (x + 360) / 302; return -150 - 42 * t - 10 * Math.sin(t * 3.1); };
function hotel(M, x1, al, P){
  const w = B.mix(10, 19, al()), h = B.mix(6.5, 12.5, al()), d = B.mix(10, 16, al());
  const z1 = quaiZ(x1) - 7, z0 = z1 - d, x0 = x1 - w, y0 = P.yT, y1 = y0 + h;
  const c = P.pastels[Math.floor(al() * P.pastels.length)], cf = teinte(c, 0.85);
  const neon = () => P.neons[Math.floor(al() * P.neons.length)];
  boite(M, coins(x0, x1, y0, y1, z0, z1), [null, c, cf, cf, null, teinte(c, 1.1)]);
  // la corniche, et son néon
  boite(M, coins(x0 - 0.3, x1 + 0.3, y1 - 0.25, y1 + 0.35, z1 - 0.5, z1 + 0.5), [null, teinte(c, 1.1), cf, cf, null, c]);
  if (al() < 0.85) boite(M, coins(x0, x1, y1 - 0.9, y1 - 0.45, z1 + 0.5, z1 + 0.7), neon());
  const style = al(), xm = (x0 + x1) / 2;
  if (style < 0.38){
    // le fronton en gradins, et son épine de néon
    const fw = w * 0.34;
    boite(M, coins(xm - fw / 2, xm + fw / 2, y1, y1 + 2.4, z1 - 3, z1 + 0.3), [null, c, cf, cf, null, c]);
    boite(M, coins(xm - fw / 4, xm + fw / 4, y1 + 2.4, y1 + 4.2, z1 - 2, z1 + 0.3), [null, c, cf, cf, null, c]);
    boite(M, coins(xm - 0.35, xm + 0.35, y0 + 2.5, y1 + 3.9, z1 + 0.3, z1 + 0.7), neon());
  } else if (style < 0.62){
    // la tour d'angle, ronde, cerclée de néon
    cylindre(M, [x1 - 2.6, y0, z1 - 2.6], [x1 - 2.6, y1 + 2.6, z1 - 2.6], 3, 3, 8, cf, { fb: c });
    cylindre(M, [x1 - 2.6, y1 + 1.9, z1 - 2.6], [x1 - 2.6, y1 + 2.3, z1 - 2.6], 3.12, 3.12, 8, neon());
  } else if (style < 0.85){
    // l'enseigne verticale, en drapeau sur le coin de la façade
    boite(M, coins(x0 + 1.2, x0 + 2.3, y1 - 5.5, y1 + 2.2, z1, z1 + 1.6), neon());
  }
  // quelques fenêtres allumées : peu, c'est l'heure où l'on sort
  const nf = Math.max(2, Math.floor(w / 3.4)), ne = Math.max(1, Math.floor((h - 1.5) / 3));
  for (let i = 0; i < nf; i++) for (let j = 0; j < ne; j++){
    if (al() > 0.28) continue;
    const fx = x0 + (i + 0.5) * (w / nf), fy = y0 + 1.5 + j * 3;
    poly(M, [[fx - 0.8, fy, z1 + 0.05], [fx + 0.8, fy, z1 + 0.05], [fx + 0.8, fy + 1.3, z1 + 0.05], [fx - 0.8, fy + 1.3, z1 + 0.05]], P.fenetres[Math.floor(al() * P.fenetres.length)]);
  }
  return x0;
}
/* Un palmier de carte postale, vu de si loin qu'un tronc et une étoile de
   palmes suffisent. */
function palmierLointain(M, x, z, h, al, c){
  const top = [x + (al() - 0.5) * 1.5, h, z];
  cylindre(M, [x, NIVEAU + 0.8, z], top, 0.28, 0.2, 3, teinte(c, 0.8));
  for (let k = 0; k < 6; k++){
    const a = k / 6 * B.TAU + al(), l = B.mix(3, 4.2, al());
    const bout = [top[0] + Math.cos(a) * l, top[1] - B.mix(0.8, 2.2, al()), top[2] + Math.sin(a) * l];
    const cote = [-Math.sin(a) * 0.7, 0, Math.cos(a) * 0.7];
    poly2(M, [top, v3add(bout, cote), v3add(bout, [-cote[0], 0, -cote[2]])], c, c);
  }
}
function oceanDrive(){
  const M = new B.Maille(), al = B.graine(41);
  const P = {
    yT: NIVEAU + 0.9,
    pastels: ['#e38bb6', '#7cc7bd', '#a08fd8', '#ee9f8a', '#8cb0de', '#e9b8cc', '#d18bd0'].map(h => rvba(h)),
    neons: [rvba('#ff3fb4', 0), rvba('#35f2ff', 0), rvba('#c86bff', 0), rvba('#ff3fb4', 0)],
    fenetres: [rvba('#ffd98a', 0.15), rvba('#ffb0d8', 0.2), rvba('#b0f0ff', 0.25)],
  };
  // la presqu'île : un quai face à la baie, qui s'arrondit vers la pointe
  const terre = rvba('#9c6f7c'), berge = rvba('#6f4a63');
  let prec = null;
  for (let k = 0; k <= 14; k++){
    const x = B.mix(-360, -58, k / 14), q = [x, quaiZ(x)];
    if (prec){
      const [xa, za] = prec, [xb, zb] = q;
      poly(M, [[xa, P.yT, za], [xb, P.yT, zb], [xb, P.yT, zb - 70], [xa, P.yT, za - 70]], terre);
      poly(M, [[xa, NIVEAU - 1.5, za], [xb, NIVEAU - 1.5, zb], [xb, P.yT, zb], [xa, P.yT, za]], berge);
    }
    prec = q;
  }
  poly(M, [[prec[0], NIVEAU - 1.5, prec[1]], [prec[0], NIVEAU - 1.5, prec[1] - 70], [prec[0], P.yT, prec[1] - 70], [prec[0], P.yT, prec[1]]], berge);
  // les hôtels, de la pointe vers la gauche ; entre eux, des palmiers sur la promenade
  const palme = rvba('#3d2c4e');
  let x = -63;
  while (x > -330){
    const x0 = hotel(M, x, al, P);
    if (al() < 0.6) palmierLointain(M, x0 - 1.5, quaiZ(x0) - 3, B.mix(8, 12, al()), al, palme);
    x = x0 - B.mix(3, 10, al());
  }
  return M;
}
/* Un voilier à l'horizon, entre le personnage et la voiture. */
function voilier(){
  const M = new B.Maille(); M.vent = [];
  const blanc = rvba('#fff6f2'), coque = rvba('#f1ebf0');
  boite(M, coins(-3.2, 3.2, -0.2, 0.7, -0.9, 0.9), [coque, coque, coque, coque, null, teinte(coque, 0.9)]);
  cylindre(M, [0, 0.7, 0], [0, 9.5, 0], 0.09, 0.06, 4, blanc, { v: [0, 0.05] });
  poly2(M, [[0.15, 1.3, 0], [3.1, 1.3, 0], [0.15, 9.2, 0]], blanc, teinte(blanc, 0.85), [0, 0.03, 0.06]);
  poly2(M, [[-0.15, 1.4, 0], [-0.15, 8.6, 0], [-3.4, 1.4, 0]], teinte(blanc, 0.95), teinte(blanc, 0.8), [0, 0.06, 0.03]);
  return M;
}

/* ---------------------------------------------------------------------------
   9. L'ÉCUME DE LA LANGUE DE SABLE
   Le programme de la mer dessine son écume le long d'un rivage droit (z
   constant) : il ne la mettra pas au bord de la langue, qui file vers
   l'horizon. On y pose un liseré clair, à fleur d'eau : les vagues le
   couvrent et le découvrent, et il vit sans rien animer.
   --------------------------------------------------------------------------- */
function xRivage(z, s){                               // le x où terre(x, z) = s, par dichotomie
  let a = -10, b = 80;
  for (let k = 0; k < 30; k++){ const m = (a + b) / 2; if (terre(m, z) < s) a = m; else b = m; }
  return (a + b) / 2;
}
function ecumeLangue(){
  const M = new B.Maille(), al = B.graine(5);
  const blanc = rvba('#f6dfe6'), clair = rvba('#eed3dc');
  let prec = null;
  // par plaques de longueur inégale : un trait continu ferait une route
  let trou = 0;
  for (let z = -8; z >= -70; z -= 0.8 + (-z) * 0.03){
    const xa = xRivage(z, 0.03), xb = xRivage(z, B.mix(0.12, 0.3, al()));
    const p = [[xa, NIVEAU + 0.02, z], [xb, hauteur(xb, z) + 0.012, z]];
    if (trou > 0) trou--;
    else if (al() < 0.22) trou = 1 + Math.floor(al() * 2);
    else if (prec) poly(M, [prec[0], p[0], p[1], prec[1]].reverse(), al() < 0.5 ? blanc : clair);
    prec = p;
  }
  return M;
}

/* ---------------------------------------------------------------------------
   10. LA PLACE DES CHOSES, ET L'ASSEMBLAGE
   Le tiers droit de l'écran est sous le panneau de l'interface : la tour,
   le parasol et la serviette y sont, flous derrière lui, pour qu'il ne
   recouvre pas du vide ; ce qui doit se lire reste à gauche.
   --------------------------------------------------------------------------- */
const TOUR = { x: 9.8, z: -32, cap: -40 };
const PARASOL = { x: 7.4, z: -10.5 };
const SERVIETTE = { x: 6.6, z: -9.6, ang: 0.35 };
const VOILIER = { x: -18, z: -150, y: NIVEAU, cap: 20 };
const CAILLEBOTIS = { a: [2.45, 1.4], b: [3.25, -1.75], larg: 1.1 };

return function (boite){
  B = boite;
  AIRES.length = 0;
  const objets = [];
  // la voiture d'abord : le sable s'aplanit sous elle
  const yv = hauteur(CADILLAC.x, CADILLAC.z);
  AIRES.push({ x: CADILLAC.x, z: CADILLAC.z, ex: 1, ez: 1, r: 3.3, fondu: 1.6, y: yv });
  objets.push({ M: cadillac(), modele: B.m4.qt(B.q4.axe([0, 1, 0], CADILLAC.cap * B.DEG), [CADILLAC.x, yv, CADILLAC.z]), nom: 'cadillac' });
  objets.push({ M: sable(), nom: 'sable' });
  objets.push({ M: ecumeLangue(), nom: 'ecume' });
  objets.push({ M: coquillages(), nom: 'coquillages' });
  objets.push({ M: caillebotis(CAILLEBOTIS.a, CAILLEBOTIS.b, CAILLEBOTIS.larg), nom: 'caillebotis' });
  // `nom` ne sert qu'à qui inspecte le décor ; le moteur l'ignore
  const pose = (M, o, nom) => objets.push({ M, modele: B.m4.qt(B.q4.axe([0, 1, 0], (o.cap || 0) * B.DEG), [o.x, o.y == null ? hauteur(o.x, o.z) : o.y, o.z]), nom });
  pose(tourSauveteur(), TOUR, 'tour');
  pose(parasol(), PARASOL, 'parasol');
  objets.push({ M: serviette(SERVIETTE.x, SERVIETTE.z, SERVIETTE.ang), nom: 'serviette' });
  objets.push({ M: oceanDrive(), nom: 'oceanDrive' });
  pose(voilier(), VOILIER, 'voilier');
  PALMIERS.forEach((p, i) => objets.push({ M: palmier(p), modele: B.m4.qt([0, 0, 0, 1], [p.x, hauteur(p.x, p.z), p.z]), nom: 'palmier' + i }));
  return { objets, mer: { M: mer(), rive: RIVE_Z } };
};
})();

/* ---------------------------------------------------------------------------
   14. LA PLAGE À LA CARTE GRAPHIQUE
   Un décor de secours (le sable et la mer seuls, pour un essai), la boîte à
   outils qu'on passe au décor, et le montage de ses pièces.
   --------------------------------------------------------------------------- */
function construireDecorMinimal(){
  const M = new Maille();
  const sable = [0.93, 0.74, 0.58, 1];
  const a = M.sommet([-40, 0, 12], null, sable), b = M.sommet([40, 0, 12], null, sable);
  const c = M.sommet([40, 0, -8], null, sable), d = M.sommet([-40, 0, -8], null, sable);
  M.quad(a, b, c, d);
  M.vent = [0, 0, 0, 0];
  return { objets: [{ M }], mer: { M: grilleMer(-160, 160, -7, -320, 64, 40), rive: -6.2 } };
}
const BOITE = () => ({ Maille, v3, m4, q4, PI, TAU, DEG, clamp, mix, lisse, cloche, graine, hexRvb, melange, assombrir,
  tuyau, coudre, couvercle, lireTable, superE, grilleMer, repere });
let decor = null;
function monterDecor(construire){
  if (decor){ decor.objets.forEach(o => liberer(o.g)); liberer(decor.mer.g); }
  const d = (construire || (typeof construireDecor === 'function' ? construireDecor : construireDecorMinimal))(BOITE());
  d.objets.forEach(o => { if (!o.M.vent) o.M.vent = new Array(o.M.nb).fill(0); o.g = versGPU(o.M, true); o.M = null; });
  d.mer.g = versGPU(d.mer.M, true); d.mer.M = null;
  decor = d;
  return d;
}

/* ---------------------------------------------------------------------------
   16. L'ÉCRAN
   L'atelier tel qu'on le voit, le personnage du profil, la carte qu'on
   partage. C'est la seule partie de ce fichier qui connaît le site : ses
   textes (currentLang), ses sons (sfx), son stockage (STOCK), le profil
   (profil), les épreuves passées (DEBLOQUE), la boutique (DATA, visuelDe) —
   des noms d'index.html, qu'un script chargé après lui partage.
   --------------------------------------------------------------------------- */
const tr = (fr, en) => (typeof currentLang !== 'undefined' && currentLang === 'fr') ? fr : en;
const nomDe = (n) => n ? tr(n.fr, n.en) : '';
const son = (quoi) => { try { if (typeof sfx !== 'undefined' && sfx[quoi]) sfx[quoi](); } catch (e) {} };
/* TOUT EST OUVERT (22 sept. 2026, provisoire, à la demande) : les
   récompenses des épreuves restent déclarées — les lunettes gardent leur
   `verrou`, la cigarette le sien —, mais le cadenas ne tombe plus sur
   personne. Remettre ce drapeau à `false` referme tout. */
const TOUT_OUVERT = true;
const ouvertA = (verrou) => TOUT_OUVERT || !verrou || (typeof DEBLOQUE !== 'undefined' && DEBLOQUE.a(verrou));

/* ---- les palettes ---- */
// l'échelle de Monk (2022) : dix teintes, du plus clair au plus foncé — reprise du salon d'avant
const PEAUX = ['#f6ede4', '#f3e7db', '#f7ead0', '#eadaba', '#d7bd96', '#a07e56', '#825c43', '#604134', '#3a312a', '#292420'];
const IRIS = ['#3b2414', '#6a4526', '#8a6a3a', '#5b7a3a', '#3d7fb0', '#7fa6c2', '#6c7a7e', '#b07a2a', '#7a4fb0'];
const POILS = ['#161210', '#2b1d14', '#553621', '#6d2d1a', '#a3481f', '#8a6a3a', '#c9a060', '#e6dcc0', '#8f8a86', '#e8e6e2', '#ff6fae', '#3fa4ff', '#8b5cf6', '#5ee6b8'];
const LEVRES = [null, '#c07a6e', '#d9677a', '#c3243a', '#ff3f8e', '#7a2a4a', '#ff7a5a'];
const BARBES = {
  aucune: { fr: 'Rasé de près', en: 'Clean' }, troisJours: { fr: 'Trois jours', en: 'Stubble' }, moustache: { fr: 'Moustache', en: 'Moustache' },
  bouc: { fr: 'Bouc', en: 'Goatee' }, collier: { fr: 'Collier', en: 'Chin strap' }, barbe: { fr: 'Barbe', en: 'Full beard' }, favoris: { fr: 'Favoris', en: 'Sideburns' },
};
const SOURCILS = { fins: { fr: 'Fins', en: 'Thin' }, naturels: { fr: 'Naturels', en: 'Natural' }, epais: { fr: 'Épais', en: 'Thick' }, broussailleux: { fr: 'Broussailleux', en: 'Bushy' }, arques: { fr: 'Arqués', en: 'Arched' } };
const VISAGES = [
  { nom: { fr: 'Classique', en: 'Classic' }, v: {} },
  { nom: { fr: 'Carré', en: 'Square' }, v: { machoire: 0.82, menton: 0.7, forme: 0.35, nezLarg: 0.62, sourcils: 0.35, pommettes: 0.45 } },
  { nom: { fr: 'Doux', en: 'Soft' }, v: { forme: 0.28, machoire: 0.3, pommettes: 0.62, yeuxTaille: 0.66, levres: 0.62, menton: 0.4 } },
  { nom: { fr: 'Anguleux', en: 'Angular' }, v: { forme: 0.78, pommettes: 0.85, menton: 0.62, nezLong: 0.68, nezArete: 0.7, machoire: 0.62 } },
  { nom: { fr: 'Juvénile', en: 'Youthful' }, v: { yeuxTaille: 0.76, nezLong: 0.32, menton: 0.36, age: 0, levres: 0.58, forme: 0.38 } },
  { nom: { fr: 'Buriné', en: 'Weathered' }, v: { age: 0.85, nezLarg: 0.7, machoire: 0.62, levres: 0.36, sourcils: 0.3, pommettes: 0.6 } },
];
const CURSEURS_CORPS = [
  ['stature', { fr: 'Taille', en: 'Height' }], ['corpulence', { fr: 'Corpulence', en: 'Weight' }], ['muscle', { fr: 'Muscles', en: 'Muscle' }],
  ['carrure', { fr: 'Carrure', en: 'Shoulders' }], ['poitrine', { fr: 'Poitrine', en: 'Chest' }], ['taille', { fr: 'Tour de taille', en: 'Waist' }],
  ['hanches', { fr: 'Hanches', en: 'Hips' }], ['jambes', { fr: 'Longueur des jambes', en: 'Leg length' }], ['cou', { fr: 'Cou', en: 'Neck' }],
];
const CURSEURS_VISAGE = {
  forme: [['forme', { fr: 'Rond ↔ allongé', en: 'Round ↔ long' }], ['machoire', { fr: 'Mâchoire', en: 'Jaw' }], ['menton', { fr: 'Menton', en: 'Chin' }], ['pommettes', { fr: 'Pommettes', en: 'Cheekbones' }]],
  yeux: [['yeuxTaille', { fr: 'Taille des yeux', en: 'Eye size' }], ['yeuxEcart', { fr: 'Écart des yeux', en: 'Eye spacing' }], ['yeuxInclin', { fr: 'Inclinaison', en: 'Eye tilt' }], ['sourcils', { fr: 'Arcade', en: 'Brow ridge' }]],
  nez: [['nezLarg', { fr: 'Largeur du nez', en: 'Nose width' }], ['nezLong', { fr: 'Longueur du nez', en: 'Nose length' }], ['nezArete', { fr: 'Arête du nez', en: 'Nose bridge' }]],
  bouche: [['levres', { fr: 'Lèvres', en: 'Lips' }], ['bouche', { fr: 'Largeur de la bouche', en: 'Mouth width' }], ['oreilles', { fr: 'Oreilles', en: 'Ears' }], ['age', { fr: 'Âge', en: 'Age' }]],
};

/* ---- la configuration retenue (fp.tenue) ----
   Le personnage entier : son corps, son visage, sa coupe, sa tenue, ses
   accessoires, son attitude. La clé est celle du salon d'avant (la rubrique
   Cookies la déclare déjà) ; son contenu d'avant — la tenue portée, la peau,
   le visage et la coiffure du pack — est converti une fois (voir migrer). */
function article(img){
  if (typeof DATA === 'undefined' || !img) return null;
  const b = sansVersion(img);
  for (const cat of DATA) if (cat.kind === 'shop') for (const it of cat.items) if (it.img && sansVersion(it.img) === b) return it;
  return null;
}
function migrer(t){
  if (!t || typeof t !== 'object') return null;
  if (t.v === 2) return t;
  const c = { sexe: 'h', acc: {}, tenue: {} };
  if (typeof t.peau === 'string') c.peau = t.peau;
  const ch = { cheveux1: 'court', cheveux2: 'degrade', cheveux3: 'plaque', cheveux4: 'milong', cheveux5: 'mulet', cheveux6: 'afro', crete: 'crete', '': 'rase' }[t.cheveux];
  if (ch) c.cheveux = { style: ch, couleur: '#2b1d14' };
  if (t.cheveux === 'barbiche') c.barbe = { style: 'bouc' };
  if (t.cheveux === 'moustache') c.barbe = { style: 'moustache' };
  const cv = { couronne: 'couronne', chapeau: 'panama', chantier: 'chantier', swat: 'swat', spatial: 'spatial' }[t.couvre];
  if (cv) c.acc.tete = cv;
  const p = t.portees || {};
  if (p.lunettes === 'acc:lunettes') c.acc.lunettes = 'soleil';
  if (p.bouche === 'acc:cigarette') c.acc.bouche = 'cigarette';
  const it = p.haut && article(p.haut);
  if (it) c.tenue = { haut: 'boutique', boutique: { img: it.img, img2: it.img2 || it.img, sz: it.sz } };
  return c;
}
let cfg = null;
function configuration(){
  if (cfg) return cfg;
  let t = null;
  try { t = typeof STOCK !== 'undefined' ? STOCK.lire('fp.tenue', null) : null; } catch (e) {}
  cfg = normaliser(migrer(t) || { sexe: 'h' });
  return cfg;
}
let sauverT = 0;
function sauver(){
  clearTimeout(sauverT);
  sauverT = setTimeout(() => { try { STOCK.ecrire('fp.tenue', cfg); } catch (e) {} }, 250);
}

/* ---- le personnage partagé ----
   Un seul : l'atelier le montre, le profil aussi, la carte l'emporte. */
let perso = null;
function personnage(){
  if (!perso && initGL()){
    perso = new Personnage(configuration());
    perso.surPret = () => { redessiner = true; };
  }
  return perso;
}
let redessiner = true;
/* Un changement : la configuration bouge tout de suite, le personnage suit
   à la prochaine image — et pas plus d'une fois tous les 120 ms pendant qu'on
   fait glisser un curseur (voir `majDiff`). */
let aMettre = false, derniereMaj = 0, majT = 0;
function changer(fn, geste){
  fn(cfg);
  cfg = normaliser(cfg);
  sauver();
  aMettre = true;
  if (geste && perso) perso.anim.gesticuler(geste, perso.anim.tDernier || 0);
  majDiff();
}
function majDiff(force){
  if (!aMettre || !perso) return;
  const t = performance.now();
  if (!force && t - derniereMaj < 120){ clearTimeout(majT); majT = setTimeout(() => majDiff(true), 125 - (t - derniereMaj)); return; }
  aMettre = false; derniereMaj = t;
  perso.maj(cfg);
  redessiner = true;
  if (ecran.ouvert) ecran.refleter();
}

/* ---- les rendus hors de l'atelier ----
   La lumière du profil et de la carte n'est pas celle de la plage : le
   personnage y est seul sur le verre sombre du site, éclairé comme en studio. */
const STUDIO = {
  soleil: v3.norm([-0.5, 0.35, -0.8]), soleilC: [0.55, 0.6, 0.85],
  cle: v3.norm([0.62, 0.5, 0.6]), cleC: [1.05, 0.97, 0.9],
  cielC: [0.34, 0.36, 0.46], solC: [0.26, 0.24, 0.26], brumeC: [0, 0, 0], brume: [100, 200],
};
function camPied(w, h, P, zoom){
  const H = P.m.H, fov = 26, d = (H * 0.62) / Math.tan(fov * DEG / 2) * (zoom || 1);
  return camera(w, h, [0, H * 0.53, d], [0, H * 0.5, 0], fov);
}
function dessinerProfil(g, w, h, t){
  if (ecran.ouvert || !initGL()) return false;
  const P = personnage(); if (!P) return false;
  majDiff(true);
  P.anim.poser(P, t / 1000);
  cadre(w, h, false);
  const cam = camPied(w, h, P, Math.max(0.9, (w / h) / 0.62) * 0.9);
  dessinerPerso(P, cam, m4.qt(q4.axe([0, 1, 0], -12 * DEG), [0, 0, 0]), STUDIO);
  g.clearRect(0, 0, w, h); g.drawImage(cvGL, 0, 0);
  return true;
}
function image(N){
  if (!initGL()) return null;
  const P = personnage(); if (!P) return null;
  if (ecran.ouvert) return null;
  majDiff(true);
  P.anim.poser(P, (P.anim.tDernier || 0));
  cadre(N, N, false);
  dessinerPerso(P, camPied(N, N, P, 1.0), m4.qt(q4.axe([0, 1, 0], -12 * DEG), [0, 0, 0]), STUDIO);
  const c = toile(N); c.getContext('2d').drawImage(cvGL, 0, 0);
  return c;
}

/* ---- les vignettes ----
   Les coupes, les barbes, les couvre-chefs, les lunettes, les visages et les
   attitudes se montrent EN 3D, sur le personnage lui-même : c'est la seule
   façon de choisir une coupe. Elles sont peintes une par image (voir
   `vignettes`), hors écran — dans un tampon à part (un « framebuffer »), relu
   puis posé dans sa case —, avec un second personnage qui ne sert qu'à ça. */
let fbo = null, fboT = null, fboP = null, fboW = 0;
function tampon(W){
  if (fbo && fboW === W) return;
  if (fbo){ gl.deleteFramebuffer(fbo); gl.deleteTexture(fboT); gl.deleteRenderbuffer(fboP); }
  fboW = W;
  fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  fboT = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, fboT);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, W, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboT, 0);
  fboP = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, fboP);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, W, W);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, fboP);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}
let persoV = null;
function vignette(c, variante, vue){
  const W = 192;
  tampon(W);
  if (!persoV) persoV = new Personnage(variante); else persoV.maj(variante);
  persoV.anim.att = variante.attitude || 'cool'; persoV.anim.avant = null; persoV.anim.geste = null;
  persoV.anim.poser(persoV, vue === 'pied' ? 2.3 : 1.2);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.viewport(0, 0, W, W);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.enable(gl.CULL_FACE); gl.disable(gl.BLEND);
  let cam;
  if (vue === 'pied') cam = camPied(W, W, persoV, 0.86);
  else { const y = persoV.yeuxY() + 0.02; cam = camera(W, W, [0.1, y + 0.04, 0.78], [0, y - 0.01, 0], 25); }
  dessinerPerso(persoV, cam, m4.qt(q4.axe([0, 1, 0], (vue === 'pied' ? -10 : 18) * DEG), [0, 0, 0]), STUDIO);
  const px = new Uint8Array(W * W * 4);
  gl.readPixels(0, 0, W, W, gl.RGBA, gl.UNSIGNED_BYTE, px);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  // readPixels lit de bas en haut, et en alpha prémultiplié : on retourne, et on défait
  const im = new ImageData(W, W);
  for (let y = 0; y < W; y++){
    for (let x = 0; x < W; x++){
      const s = ((W - 1 - y) * W + x) * 4, d = (y * W + x) * 4, a = px[s + 3];
      const k = a ? 255 / a : 0;
      im.data[d] = Math.min(255, px[s] * k); im.data[d + 1] = Math.min(255, px[s + 1] * k); im.data[d + 2] = Math.min(255, px[s + 2] * k); im.data[d + 3] = a;
    }
  }
  const g = c.getContext('2d');
  c.width = W; c.height = W;
  g.putImageData(im, 0, 0);
}
const fileV = [], dejaV = new Map();
function demanderVignette(c, fabrique, vue){
  const v = fabrique(), cle = vue + JSON.stringify(v), d = dejaV.get(cle);
  if (d){ c.width = d.width; c.height = d.height; c.getContext('2d').drawImage(d, 0, 0); return; }
  fileV.push({ c, v, vue, cle });
}
function vignettes(){
  // une par image, après le rendu de l'atelier
  let job = fileV.shift();
  while (job && !job.c.isConnected) job = fileV.shift();
  if (!job) return;
  // un article de la boutique dont les photos ne sont pas encore lues : la vignette repasse plus tard
  const b = job.v.tenue && job.v.tenue.haut === 'boutique' && job.v.tenue.boutique;
  if (b && b.img){ const pa = photosArticle(b.img, b.img2 || b.img); if (!pa.pret && !pa.rate){ fileV.push(job); return; } }
  try {
    vignette(job.c, job.v, job.vue);
    const k = toile(job.c.width, job.c.height); k.getContext('2d').drawImage(job.c, 0, 0);
    dejaV.set(job.cle, k);
    if (dejaV.size > 240) dejaV.delete(dejaV.keys().next().value);
  } catch (e) {}
}

/* ---- les pictogrammes des vêtements ----
   Les pièces d'une tenue se reconnaissent à leur silhouette : un dessin à
   plat, rempli du motif de la pièce dans sa teinte (voir peindreMotif). */
const SILHOUETTES = {
  tee: 'M30 14 L42 10 Q50 18 58 10 L70 14 L88 30 L78 42 L70 36 L70 90 L30 90 L30 36 L22 42 L12 30 Z',
  large: 'M26 14 L42 10 Q50 18 58 10 L74 14 L92 34 L80 48 L72 42 L74 92 L26 92 L28 42 L20 48 L8 34 Z',
  longue: 'M30 14 L42 10 Q50 18 58 10 L70 14 L86 34 L92 80 L82 82 L74 44 L70 90 L30 90 L26 44 L18 82 L8 80 L14 34 Z',
  debardeur: 'M36 10 L42 10 Q50 26 58 10 L64 10 L66 32 Q72 40 72 50 L72 90 L28 90 L28 50 Q28 40 34 32 Z',
  chemise: 'M30 14 L42 10 L50 30 L58 10 L70 14 L88 32 L78 44 L70 38 L70 92 L30 92 L30 38 L22 44 L12 32 Z',
  veste: 'M28 14 L42 10 L50 44 L58 10 L72 14 L86 36 L90 76 L80 78 L74 44 L74 92 L54 92 L50 60 L46 92 L26 92 L26 44 L20 78 L10 76 L14 36 Z',
  crop: 'M30 18 L42 14 Q50 22 58 14 L70 18 L86 32 L77 42 L70 38 L70 62 L30 62 L30 38 L23 42 L14 32 Z',
  brassiere: 'M32 20 L40 20 Q50 40 60 20 L68 20 L70 44 Q70 56 66 60 L34 60 Q30 56 30 44 Z',
  pantalon: 'M30 10 L70 10 L74 92 L56 92 L50 36 L44 92 L26 92 Z',
  large2: 'M28 10 L72 10 L82 92 L56 92 L50 38 L44 92 L18 92 Z',
  short: 'M28 22 L72 22 L78 68 L55 70 L50 44 L45 70 L22 68 Z',
  jupe: 'M34 16 L66 16 L80 80 L20 80 Z',
  basket: 'M12 56 L40 52 L52 40 L66 42 L86 58 Q92 64 88 70 L12 70 Z',
  montante: 'M20 30 L46 26 L50 44 L66 48 L86 60 Q92 66 88 72 L16 72 Z',
  mocassin: 'M12 60 L30 52 L62 50 L86 60 Q90 66 86 70 L12 70 Z',
  tong: 'M14 66 Q50 58 86 66 Q90 70 86 72 L14 72 Q10 70 14 66 Z M46 64 L52 50 L58 64',
  botte: 'M28 14 L50 14 L52 48 L78 56 Q90 62 88 72 L24 72 Z',
  rien: 'M30 30 L70 70 M70 30 L30 70',
};
const SIL_DE = {
  tshirt: 'tee', oversize: 'large', brassiere: 'brassiere',
  jean: 'pantalon', baggy: 'large2', shortJean: 'short', bain: 'short', costume_b: 'pantalon', jogging: 'pantalon', cargo: 'large2', pyjama: 'large2', leopard: 'large2', legging: 'pantalon', jupe: 'jupe', jupePlis: 'jupe',
  retro: 'basket', toile: 'montante', basket: 'basket', mocassin: 'mocassin', tongs: 'tong', bottes: 'botte',
};
function pictogramme(c, sil, motif, C){
  const W = 160; c.width = W; c.height = W;
  const g = c.getContext('2d');
  g.clearRect(0, 0, W, W);
  if (sil === 'rien'){
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 7; g.lineCap = 'round';
    g.scale(W / 100, W / 100); g.stroke(new Path2D(SILHOUETTES.rien)); return;
  }
  const t = toile(W), gt = t.getContext('2d');
  peindreMotif(gt, W, W, motif || 'uni', C, graine(C[0].length * 7 + W));
  g.save(); g.scale(W / 100, W / 100);
  const p = new Path2D(SILHOUETTES[sil] || SILHOUETTES.tee);
  g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = 6; g.shadowOffsetY = 2;
  g.fillStyle = C[0]; g.fill(p);
  g.shadowColor = 'transparent';
  g.clip(p); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(t, 0, 0);
  g.restore();
  g.save(); g.scale(W / 100, W / 100); g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1.2; g.stroke(p); g.restore();
}

/* ---- les icônes des onglets ---- */
const ICONE = (d) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
const ONGLETS = [
  { id: 'identite', nom: { fr: 'Identité', en: 'Identity' }, vue: 'pied', icone: ICONE('<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="9" cy="11" r="2.4"/><path d="M5.8 16.5c.8-1.8 2-2.6 3.2-2.6s2.4.8 3.2 2.6M14.5 10h4M14.5 13.5h3"/>') },
  { id: 'corps', nom: { fr: 'Corps', en: 'Body' }, vue: 'pied', icone: ICONE('<circle cx="12" cy="4.5" r="2.2"/><path d="M7 9.5h10M12 8v6M12 14l-3 7M12 14l3 7M7 9.5l-2 5M17 9.5l2 5"/>') },
  { id: 'visage', nom: { fr: 'Visage', en: 'Face' }, vue: 'visage', icone: ICONE('<path d="M12 3c-4 0-6.5 3-6.5 7.5 0 5 3 9.5 6.5 9.5s6.5-4.5 6.5-9.5C18.5 6 16 3 12 3z"/><path d="M9.3 10.2h.01M14.7 10.2h.01M10 15.2c1.2.9 2.8.9 4 0"/>') },
  { id: 'cheveux', nom: { fr: 'Cheveux', en: 'Hair' }, vue: 'visage', icone: ICONE('<path d="M5 13c0-6 3.5-9 7-9s7 3 7 9"/><path d="M5 13c1.5-3 4-4.5 7-4.5M19 13c-.8-2-2.4-3.4-4.5-4"/><path d="M5 13v6M19 13v6"/>') },
  { id: 'tenue', nom: { fr: 'Tenue', en: 'Outfit' }, vue: 'pied', icone: ICONE('<path d="M8.5 3.5 4 6l1.8 4.2 2.2-1V20.5h8V9.2l2.2 1L20 6l-4.5-2.5c-.6 1.6-1.9 2.5-3.5 2.5S9.1 5.1 8.5 3.5z"/>') },
  { id: 'accessoires', nom: { fr: 'Accessoires', en: 'Extras' }, vue: 'visage', icone: ICONE('<path d="M2.5 11h19"/><path d="M4 11l1 5h5l1-5M13 11l1 5h5l1-5"/><path d="M11 13h2"/>') },
  { id: 'attitude', nom: { fr: 'Attitude', en: 'Attitude' }, vue: 'pied', icone: ICONE('<circle cx="13" cy="4.3" r="2"/><path d="M12.5 7.5 10 13l3 2.5-1 5.5M10 13l-4 1M12.5 7.5l5 2.5 1-3.5M13 15.5l4 4"/>') },
];
const HASARD = ICONE('<rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><circle cx="8.5" cy="8.5" r="1.1" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.1" fill="currentColor"/><circle cx="12" cy="12" r="1.1" fill="currentColor"/>');

/* ---- le hasard ----
   Un personnage tiré au sort, mais plausible : les curseurs autour du
   milieu, une teinte de cheveux naturelle neuf fois sur dix, une barbe une
   fois sur trois pour un homme — et des récompenses seulement si on les a. */
function auHasard(){
  const r = Math.random, pick = (l) => l[Math.floor(r() * l.length)], autour = (e) => clamp(0.5 + (r() + r() + r() - 1.5) * (e || 0.5), 0, 1);
  const f = cfg.sexe === 'f';
  changer(c => {
    CURSEURS_CORPS.forEach(([k]) => { c.corps[k] = autour(0.55); });
    Object.keys(VISAGE_DEFAUT).forEach(k => { if (typeof VISAGE_DEFAUT[k] === 'number' && k !== 'taches' && k !== 'fard') c.visage[k] = autour(0.6); });
    c.visage.age = r() * 0.6; c.visage.taches = r() < 0.15 ? 1 : 0;
    c.peau = pick(PEAUX); c.yeux = pick(IRIS.slice(0, 8));
    const coupes = Object.keys(COIFFURES).filter(k => k !== 'chauve' || !f);
    c.cheveux = { style: pick(f ? coupes.filter(k => !['rase', 'crete', 'degrade'].includes(k) || r() < 0.2) : coupes), couleur: r() < 0.88 ? pick(POILS.slice(0, 10)) : pick(POILS.slice(10)) };
    c.barbe = { style: !f && r() < 0.35 ? pick(Object.keys(BARBES).slice(1)) : 'aucune' };
    c.sourcils = { style: pick(Object.keys(SOURCILS)) };
    c.maquillage = { liner: f ? r() * 0.8 : (r() < 0.1 ? 0.5 : 0), linerC: '#1a1210' };
    c.visage.levresC = f && r() < 0.6 ? pick(LEVRES.slice(1)) : null;
    c.visage.fard = f && r() < 0.4 ? 1 : 0;
    // le haut : un article de la boutique, presque toujours
    const arts = articlesBoutique(), basiques = ['tshirt', 'oversize'].concat(f ? ['brassiere'] : []);
    const bas = Object.keys(BAS).filter(k => k !== 'aucun' && (f || !['jupe', 'jupePlis', 'legging'].includes(k) || r() < 0.1));
    const pieds = Object.keys(PIEDS).filter(k => k !== 'pieds');
    const b = pick(bas), p = pick(pieds);
    c.tenue = { haut: pick(basiques), hautV: Math.floor(r() * 8), bas: b, basV: Math.floor(r() * 8), pieds: p, piedsV: Math.floor(r() * 8) };
    if (arts.length && r() < 0.9){ c.tenue.haut = 'boutique'; c.tenue.boutique = portee(pick(arts)); }
    const tetes = Object.keys(COUVRE).filter(k => k !== 'spatial' && k !== 'swat');
    c.acc = { tete: r() < 0.3 ? pick(tetes.slice(1)) : 'aucun', teteV: Math.floor(r() * 5), lunettes: r() < 0.35 ? pick(Object.keys(LUNETTES).slice(1).filter(k => ouvertA(LUNETTES[k].verrou))) || 'aucune' : 'aucune',
      bijou: r() < 0.3 ? pick(Object.keys(BIJOUX).slice(1)) : 'aucun', bouche: 'rien' };
    c.attitude = pick(Object.keys(ATTITUDES));
  }, 'coucou');
  son('select');
}

/* ---- l'écran ---- */
const ecran = {
  ouvert: false, creation: false, onglet: 'identite',
  brouillon: { nom: '', photo: null },       // l'identité, tant que le profil n'existe pas
  angle: 0, elan: 0, zoom: 0, zoomCible: 0, dernier: 0, eveil: 0, raf: 0,
  controles: [],
};
const $ = (id) => document.getElementById(id);
function el(tag, cls, html){ const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
/* Les contrôles : chacun se fabrique, puis sait se remettre à jour (`refleter`)
   quand la configuration change d'ailleurs — un autre curseur, le hasard. */
function titre(txt){ ecran.contenu.appendChild(el('div', 'at-titre', '')).textContent = txt; }
function note(txt){ ecran.contenu.appendChild(el('div', 'at-note', '')).textContent = txt; }
function curseur(nom, lire, ecrire, geste){
  const l = el('label', 'at-curseur'), s = el('span'), o = el('output'), i = el('input');
  s.textContent = nom; i.type = 'range'; i.min = 0; i.max = 100; i.step = 1;
  l.append(s, o, i); ecran.contenu.appendChild(l);
  const maj = () => { const v = Math.round(lire() * 100); i.value = v; o.textContent = v; i.style.setProperty('--v', v + '%'); };
  i.addEventListener('input', () => { changer(c => ecrire(c, i.value / 100)); o.textContent = i.value; i.style.setProperty('--v', i.value + '%'); });
  i.addEventListener('change', () => { if (geste && perso) perso.anim.gesticuler(geste, perso.anim.tDernier || 0); majDiff(true); });
  maj(); ecran.controles.push(maj);
}
function teintes(liste, lire, ecrire, geste, aucun){
  const d = el('div', 'at-teintes'); ecran.contenu.appendChild(d);
  const bts = liste.map(col => {
    const b = el('button', 'at-teinte' + (col == null ? ' at-teinte--aucun' : '')); b.type = 'button';
    if (col != null) b.style.background = Array.isArray(col) ? `linear-gradient(135deg, ${col[0]} 50%, ${col[1] || col[0]} 50%)` : col;
    b.title = col == null ? (aucun || tr('Aucun', 'None')) : '';
    b.setAttribute('aria-label', b.title || String(col));
    b.addEventListener('click', () => { changer(c => ecrire(c, col), geste); son('select'); });
    d.appendChild(b); return b;
  });
  const maj = () => { const v = JSON.stringify(lire()); bts.forEach((b, i) => b.classList.toggle('on', JSON.stringify(liste[i]) === v)); };
  maj(); ecran.controles.push(maj);
}
function puces(liste, lire, ecrire, geste){
  const d = el('div', 'at-puces'); ecran.contenu.appendChild(d);
  const bts = liste.map(([v, nom]) => {
    const b = el('button', 'at-puce'); b.type = 'button'; b.textContent = nomDe(nom);
    b.addEventListener('click', () => { changer(c => ecrire(c, v), geste); son('select'); });
    d.appendChild(b); return b;
  });
  const maj = () => { const cur = lire(); bts.forEach((b, i) => b.classList.toggle('on', liste[i][0] === cur)); };
  maj(); ecran.controles.push(maj);
}
/* Une grille de cases : `items` [{ v, nom, verrou, dessin(canvas) | img }] */
function grille(items, lire, ecrire, geste, quatre, refaire){
  const d = el('div', 'at-grille' + (quatre ? ' at-grille--4' : '')); ecran.contenu.appendChild(d);
  const bts = items.map(it => {
    const b = el('button', 'at-case'); b.type = 'button';
    const ferme = it.ferme != null ? it.ferme : !!(it.verrou && !ouvertA(it.verrou));
    if (ferme) b.classList.add('verrou');
    let v;
    // une photo introuvable (un article retiré du catalogue, le fichier parti) : la case s'efface
    if (it.img){ v = el('img', 'at-vignette'); v.src = it.img; v.alt = ''; v.loading = 'lazy'; v.onerror = () => { b.hidden = true; }; }
    else { v = el('canvas', 'at-vignette'); v.width = v.height = 8; if (it.dessin) it.dessin(v); }
    const n = el('span'); n.textContent = ferme ? tr('Verrouillé', 'Locked') : nomDe(it.nom) || it.texte || '';
    b.append(v, n);
    b.title = n.textContent;
    b.addEventListener('click', () => {
      if (ferme){ b.classList.remove('refus'); void b.offsetWidth; b.classList.add('refus'); son('refus'); return; }
      changer(c => ecrire(c, it.v), geste); son('select');
      if (refaire){ const y = ecran.contenu.scrollTop; montrerOnglet(ecran.onglet); ecran.contenu.scrollTop = y; }
    });
    b.addEventListener('animationend', () => b.classList.remove('refus'));
    d.appendChild(b); return b;
  });
  const maj = () => { const cur = JSON.stringify(lire()); bts.forEach((b, i) => b.classList.toggle('on', JSON.stringify(items[i].v) === cur)); };
  maj(); ecran.controles.push(maj);
}
// une variante de config, pour une vignette : le personnage tel qu'il est, avec ce seul changement
const avec = (fn) => () => { const c = JSON.parse(JSON.stringify(cfg)); fn(c); return normaliser(c); };
const tete3D = (fn) => (cv) => demanderVignette(cv, avec(c => { c.tenue = { haut: 'aucun', bas: c.tenue.bas }; c.attitude = 'cool'; fn(c); }), 'tete');
const pied3D = (fn) => (cv) => demanderVignette(cv, avec(fn), 'pied');

/* ---- les onglets ---- */
const PANNEAUX = {
  identite(){
    const moi = typeof profil !== 'undefined' && profil.existe() ? profil.lire() : null;
    titre(tr('Gamertag', 'Gamertag'));
    const i = el('input', 'at-champ'); i.type = 'text'; i.maxLength = 16; i.spellcheck = false; i.autocomplete = 'nickname';
    i.value = moi ? moi.nom : ecran.brouillon.nom;
    i.placeholder = tr('Ton nom de joueur', 'Your player name');
    ecran.contenu.appendChild(i);
    const aide = el('div', 'at-aide'); aide.textContent = tr('2 à 16 caractères — lettres, chiffres, espaces, points, tirets.', '2 to 16 characters — letters, digits, spaces, dots, dashes.');
    ecran.contenu.appendChild(aide);
    i.addEventListener('input', () => { i.classList.remove('refus'); ecran.brouillon.nom = i.value; ecran.titre.textContent = i.value.trim() || titreParDefaut(); });
    ecran.champNom = i;
    titre(tr('Photo de profil', 'Profile picture'));
    const ph = el('div', 'at-photo'), cadreP = el('div', 'at-photo-cadre'), bts = el('div', 'at-puces');
    ph.append(cadreP, bts); ecran.contenu.appendChild(ph);
    const fichier = el('input'); fichier.type = 'file'; fichier.accept = 'image/*'; fichier.hidden = true; ecran.contenu.appendChild(fichier);
    const photoActuelle = () => ecran.brouillon.photo !== undefined && ecran.brouillon.photoTouchee ? ecran.brouillon.photo : (moi ? moi.photo : ecran.brouillon.photo);
    const montrer = () => {
      const p = photoActuelle();
      cadreP.innerHTML = '';
      if (p){ const im = el('img'); im.src = p; im.alt = ''; cadreP.appendChild(im); }
      else cadreP.textContent = ((i.value || '?').trim().charAt(0) || '?').toUpperCase();
    };
    const bouton = (txt, fn) => { const b = el('button', 'at-puce'); b.type = 'button'; b.textContent = txt; b.addEventListener('click', fn); bts.appendChild(b); return b; };
    bouton(tr('Choisir une photo', 'Choose a photo'), () => fichier.click());
    if (gl) bouton(tr('Portrait du personnage', 'Character portrait'), () => { const c = portrait(256); if (c){ ecran.brouillon.photo = c.toDataURL('image/jpeg', 0.88); ecran.brouillon.photoTouchee = true; montrer(); son('photo'); } });
    bouton(tr('Retirer', 'Remove'), () => { ecran.brouillon.photo = null; ecran.brouillon.photoTouchee = true; montrer(); son('retirer'); });
    fichier.addEventListener('change', () => {
      const f = fichier.files && fichier.files[0];
      if (!f || typeof reduireImage !== 'function') return;
      reduireImage(f, 256, 0.85, true).then(url => { if (url){ ecran.brouillon.photo = url; ecran.brouillon.photoTouchee = true; montrer(); son('tick'); } });
    });
    i.addEventListener('input', montrer);
    montrer();
    titre(tr('Personnage', 'Character'));
    const sx = el('div', 'at-sexes'); ecran.contenu.appendChild(sx);
    const sexes = [['h', tr('Homme', 'Male')], ['f', tr('Femme', 'Female')]].map(([v, t]) => {
      const b = el('button', 'at-sexe'); b.type = 'button'; b.textContent = t;
      b.addEventListener('click', () => { if (cfg.sexe !== v){ changer(c => changerSexe(c, v), 'coucou'); son('select'); } });
      sx.appendChild(b); return [v, b];
    });
    const maj = () => sexes.forEach(([v, b]) => b.classList.toggle('on', cfg.sexe === v));
    maj(); ecran.controles.push(maj);
    note(tr('Tout le reste se règle dans les onglets suivants — et se retouche quand on veut.', 'Everything else is in the next tabs — and can be changed anytime.'));
  },
  corps(){
    titre(tr('Peau', 'Skin'));
    teintes(PEAUX, () => cfg.peau, (c, v) => { c.peau = v; });
    titre(tr('Silhouette', 'Build'));
    CURSEURS_CORPS.slice(0, 3).forEach(([k, n]) => curseur(nomDe(n), () => cfg.corps[k], (c, v) => { c.corps[k] = v; }));
    titre(tr('Proportions', 'Proportions'));
    CURSEURS_CORPS.slice(3).forEach(([k, n]) => curseur(nomDe(n), () => cfg.corps[k], (c, v) => { c.corps[k] = v; }));
  },
  visage(){
    titre(tr('Visages', 'Faces'));
    grille(VISAGES.map(p => ({ v: p.v, nom: p.nom, dessin: tete3D(c => { c.visage = Object.assign({}, VISAGE_DEFAUT, { age: c.visage.age, taches: c.visage.taches, levresC: c.visage.levresC, fard: c.visage.fard }, p.v); }) })),
      () => null, (c, v) => { const garde = { levresC: c.visage.levresC, fard: c.visage.fard, taches: c.visage.taches }; c.visage = Object.assign({}, VISAGE_DEFAUT, garde, v); });
    titre(tr('Yeux', 'Eyes'));
    teintes(IRIS, () => cfg.yeux, (c, v) => { c.yeux = v; });
    CURSEURS_VISAGE.yeux.forEach(([k, n]) => curseur(nomDe(n), () => cfg.visage[k], (c, v) => { c.visage[k] = v; }));
    titre(tr('Forme du visage', 'Face shape'));
    CURSEURS_VISAGE.forme.forEach(([k, n]) => curseur(nomDe(n), () => cfg.visage[k], (c, v) => { c.visage[k] = v; }));
    titre(tr('Nez', 'Nose'));
    CURSEURS_VISAGE.nez.forEach(([k, n]) => curseur(nomDe(n), () => cfg.visage[k], (c, v) => { c.visage[k] = v; }));
    titre(tr('Bouche, oreilles, âge', 'Mouth, ears, age'));
    CURSEURS_VISAGE.bouche.forEach(([k, n]) => curseur(nomDe(n), () => cfg.visage[k], (c, v) => { c.visage[k] = v; }));
    puces([[0, { fr: 'Sans taches', en: 'No freckles' }], [1, { fr: 'Taches de rousseur', en: 'Freckles' }]], () => cfg.visage.taches ? 1 : 0, (c, v) => { c.visage.taches = v; });
  },
  cheveux(){
    titre(tr('Coupe', 'Haircut'));
    grille(Object.keys(COIFFURES).map(k => ({ v: k, nom: COIFFURES[k].nom, dessin: tete3D(c => { c.cheveux.style = k; c.acc.tete = 'aucun'; }) })),
      () => cfg.cheveux.style, (c, v) => { c.cheveux.style = v; }, 'cheveux');
    titre(tr('Couleur', 'Colour'));
    teintes(POILS, () => cfg.cheveux.couleur, (c, v) => { c.cheveux.couleur = v; }, 'cheveux');
    titre(tr('Barbe', 'Facial hair'));
    grille(Object.keys(BARBES).map(k => ({ v: k, nom: BARBES[k], dessin: tete3D(c => { c.barbe.style = k; c.acc.tete = 'aucun'; }) })),
      () => cfg.barbe.style, (c, v) => { c.barbe.style = v; });
    titre(tr('Sourcils', 'Eyebrows'));
    puces(Object.keys(SOURCILS).map(k => [k, SOURCILS[k]]), () => cfg.sourcils.style, (c, v) => { c.sourcils.style = v; });
    titre(tr('Maquillage', 'Make-up'));
    curseur(tr('Trait de liner', 'Eyeliner'), () => cfg.maquillage.liner || 0, (c, v) => { c.maquillage.liner = v; });
    teintes(LEVRES, () => cfg.visage.levresC || null, (c, v) => { c.visage.levresC = v; }, null, tr('Lèvres naturelles', 'Natural lips'));
    puces([[0, { fr: 'Sans fard', en: 'No blush' }], [1, { fr: 'Fard à joues', en: 'Blush' }]], () => cfg.visage.fard ? 1 : 0, (c, v) => { c.visage.fard = v; });
  },
  tenue(){
    const section = (nom, CAT, cle, cleV, suffixe, geste) => {
      titre(nom);
      grille(Object.keys(CAT).filter(k => !CAT[k].cache).map(k => {
        const d = CAT[k], C0 = d.teintes ? d.teintes[0] : ['#8a8a8a'];
        const sil = k === 'aucun' || k === 'pieds' ? 'rien' : SIL_DE[k + (CAT === BAS && k === 'costume' ? '_b' : '')] || 'tee';
        return { v: k, nom: d.nom, dessin: (cv) => pictogramme(cv, sil, d.motif || (d.jean ? 'denim' : 'uni'), C0) };
      }), () => cfg.tenue[cle], (c, v) => { c.tenue[cle] = v; c.tenue[cleV] = 0; }, geste, false, true);
      const d = CAT[cfg.tenue[cle]];
      if (d && d.teintes && d.teintes.length > 1) teintes(d.teintes, () => d.teintes[(cfg.tenue[cleV] | 0) % d.teintes.length], (c, v) => { c.tenue[cleV] = d.teintes.indexOf(v); }, geste);
    };
    /* LE HAUT : les articles de la boutique — le t-shirt qu'on achète, sur le
       personnage —, puis les basiques unis. */
    const articles = articlesBoutique(true);
    if (articles.length){
      titre(tr('Haut — la boutique FakeParadise', 'Top — the FakeParadise shop'));
      grille(articles.map(it => {
        const vu = typeof visuelDe === 'function' ? visuelDe(it) : it;
        const ferme = vu !== it;
        return { v: portee(it), texte: ferme ? tr('Verrouillé', 'Locked') : (typeof L === 'function' ? L(it.n) : it.n), img: ferme ? vu.img : it.img, ferme };
      }), () => cfg.tenue.haut === 'boutique' ? cfg.tenue.boutique : null, (c, v) => { c.tenue.haut = 'boutique'; c.tenue.boutique = v; }, 'epaule', false, true);
    }
    section(articles.length ? tr('Basiques', 'Basics') : tr('Haut', 'Top'), HAUTS, 'haut', 'hautV', '', 'epaule');
    section(tr('Bas', 'Bottoms'), BAS, 'bas', 'basV', '', null);
    section(tr('Chaussures', 'Shoes'), PIEDS, 'pieds', 'piedsV', '', null);
  },
  accessoires(){
    titre(tr('Couvre-chef', 'Headwear'));
    grille(Object.keys(COUVRE).map(k => ({ v: k, nom: COUVRE[k].nom, dessin: tete3D(c => { c.acc.tete = k; c.acc.teteV = 0; }) })),
      () => cfg.acc.tete || 'aucun', (c, v) => { c.acc.tete = v; c.acc.teteV = 0; }, 'cheveux', false, true);
    const d = COUVRE[cfg.acc.tete];
    if (d && d.teintes && d.teintes.length > 1) teintes(d.teintes, () => d.teintes[(cfg.acc.teteV | 0) % d.teintes.length], (c, v) => { c.acc.teteV = d.teintes.indexOf(v); });
    titre(tr('Lunettes', 'Glasses'));
    if (!TOUT_OUVERT && !ouvertA('vertige')) note(tr('Elles se gagnent : un secret sur la page Info.', 'They are earned: a secret on the Info page.'));
    grille(Object.keys(LUNETTES).map(k => ({ v: k, nom: LUNETTES[k].nom, verrou: LUNETTES[k].verrou, dessin: tete3D(c => { c.acc.lunettes = k; }) })),
      () => cfg.acc.lunettes || 'aucune', (c, v) => { c.acc.lunettes = v; }, 'lunettes');
    titre(tr('Bijoux', 'Jewellery'));
    puces(Object.keys(BIJOUX).map(k => [k, BIJOUX[k].nom]), () => cfg.acc.bijou || 'aucun', (c, v) => { c.acc.bijou = v; });
    titre(tr('À la bouche', 'In the mouth'));
    grille(Object.keys(BOUCHE).map(k => ({ v: k, nom: BOUCHE[k].nom, verrou: BOUCHE[k].verrou, dessin: tete3D(c => { c.acc.bouche = k; }) })),
      () => cfg.acc.bouche || 'rien', (c, v) => { c.acc.bouche = v; });
  },
  attitude(){
    titre(tr('Attitude', 'Attitude'));
    note(tr('La pose de ton personnage, ici et sur ton profil.', 'Your character’s pose, here and on your profile.'));
    grille(Object.keys(ATTITUDES).map(k => ({ v: k, nom: ATTITUDES[k].nom, dessin: pied3D(c => { c.attitude = k; }) })),
      () => cfg.attitude, (c, v) => { c.attitude = v; });
  },
};
/* Changer de sexe garde tout ce qui est réglé, sauf ce qui n'avait été choisi
   que par défaut : la coupe, le haut, les chaussures, les sourcils de l'autre. */
function changerSexe(c, v){
  const def = (s) => normaliser({ sexe: s });
  const a = def(c.sexe), b = def(v);
  if (c.cheveux.style === a.cheveux.style) c.cheveux.style = b.cheveux.style;
  if (c.sourcils.style === a.sourcils.style) c.sourcils.style = b.sourcils.style;
  if (!c.tenue.pieds || c.tenue.pieds === (c.sexe === 'f' ? 'basket' : 'retro')) c.tenue.pieds = v === 'f' ? 'basket' : 'retro';
  if ((c.maquillage.liner || 0) === (c.sexe === 'f' ? 0.35 : 0)) c.maquillage.liner = v === 'f' ? 0.35 : 0;
  c.sexe = v;
}
const titreParDefaut = () => ecran.creation ? tr('Nouveau personnage', 'New character') : tr('Ton personnage', 'Your character');
function montrerOnglet(id){
  ecran.onglet = id;
  ecran.controles = []; fileV.length = 0;
  ecran.contenu.innerHTML = ''; ecran.contenu.scrollTop = 0;
  (PANNEAUX[id] || PANNEAUX.identite)();
  [...ecran.onglets.children].forEach(b => { const on = b.dataset.id === id; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
  const o = ONGLETS.find(o => o.id === id);
  if (o) cadrer(o.vue);
}
ecran.refleter = () => ecran.controles.forEach(f => f());
function cadrer(vue){
  ecran.zoomCible = vue === 'visage' ? 1 : 0;
  [...ecran.vues.children].forEach(b => b.classList.toggle('on', b.dataset.vue === (ecran.zoomCible > 0.5 ? 'visage' : 'pied')));
  eveiller();
}

/* ---- la caméra de la plage ----
   Le personnage au milieu de la partie VISIBLE du cadre — la colonne de
   droite en couvre près de la moitié —, en pied ou le visage de près, et
   tout ce qu'il y a entre les deux à la molette. */
function camAtelier(w, h, P){
  const k = lisse(0, 1, ecran.zoom), H = P.m.H;
  const cote = ecran.cote ? ecran.cote.getBoundingClientRect() : null, sc = ecran.scene.getBoundingClientRect();
  const libre = cote && sc.width ? clamp((cote.left - sc.left) / sc.width, 0.35, 1) : 1;
  const centre = libre / 2;                                   // en fraction de la largeur
  const fov = mix(30, 24, k), asp = w / h;
  const dist = mix(Math.max(4.1, H * 2.35), 1.42, k);
  const cy = mix(H * 0.5, P.yeuxY() - 0.02, k);
  const tanX = Math.tan(fov * DEG / 2) * asp;
  const dx = (0.5 - centre) * 2 * dist * tanX;                // décale l'œil pour que le personnage tombe au centre du libre
  return camera(w, h, [dx, cy + mix(0.08, 0.035, k), dist], [dx, cy, 0], fov);
}
function eveiller(){
  ecran.eveil = performance.now();
  if (ecran.ouvert && !ecran.raf) ecran.raf = requestAnimationFrame(boucle);
}
function boucle(t){
  ecran.raf = 0;
  if (!ecran.ouvert) return;
  if (document.hidden){ ecran.raf = requestAnimationFrame(boucle); return; }
  // au repos depuis une minute : la plage s'arrête sur sa dernière image
  if (t - ecran.eveil > 60000) return;
  ecran.raf = requestAnimationFrame(boucle);
  if (t - ecran.dernier < 15.5) return;               // soixante images par seconde, au plus
  const dt = Math.min(64, ecran.dernier ? t - ecran.dernier : 16);
  ecran.dernier = t;
  majDiff();
  const P = personnage(); if (!P) return;
  // l'élan de la main qui a lancé le personnage, et le zoom qui glisse vers sa cible
  if (!ecran.saisie && ecran.elan){ ecran.angle += ecran.elan * dt; ecran.elan *= Math.pow(0.9, dt / 16); if (Math.abs(ecran.elan) < 2e-5) ecran.elan = 0; }
  ecran.zoom += (ecran.zoomCible - ecran.zoom) * (1 - Math.pow(0.86, dt / 16));
  const sc = ecran.scene, k = Math.min(1.5, window.devicePixelRatio || 1);
  const w = Math.max(2, Math.round(sc.clientWidth * k)), h = Math.max(2, Math.round(sc.clientHeight * k));
  if (cvGL.parentNode !== sc){ sc.appendChild(cvGL); }
  P.anim.poser(P, t / 1000);
  cadre(w, h, true);
  const cam = camAtelier(w, h, P);
  dessinerCiel(cam, t / 1000);
  if (decor){ dessinerMer(decor.mer, cam, LUMIERE, t / 1000); dessinerDecor(decor.objets, cam, LUMIERE, t / 1000); }
  dessinerOmbre(cam, 0.04, -0.1, 0.44, 0.32, 0.55);
  // le personnage se tourne un peu vers l'œil, qui n'est pas en face de lui
  const face = Math.atan2(cam.oeil[0], cam.oeil[2]);
  dessinerPerso(P, cam, m4.qt(q4.axe([0, 1, 0], ecran.angle + face * 0.6), [0, 0, 0]), LUMIERE);
  ecran.camera = cam;
  vignettes();
}
/* Le portrait, pour la photo du profil : le visage de près, la plage derrière. */
function portrait(N){
  if (!initGL()) return null;
  const P = personnage(); if (!P) return null;
  if (!decor) monterDecor();
  const W = N || 256;
  tampon(W);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.viewport(0, 0, W, W);
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE);
  const y = P.yeuxY() - 0.03, cam = camera(W, W, [0.12, y + 0.05, 0.95], [0, y, 0], 26);
  dessinerCiel(cam, 0);
  dessinerMer(decor.mer, cam, LUMIERE, 0); dessinerDecor(decor.objets, cam, LUMIERE, 0);
  dessinerPerso(P, cam, m4.qt(q4.axe([0, 1, 0], 14 * DEG), [0, 0, 0]), LUMIERE);
  const px = new Uint8Array(W * W * 4);
  gl.readPixels(0, 0, W, W, gl.RGBA, gl.UNSIGNED_BYTE, px);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const c = toile(W), g = c.getContext('2d'), im = g.createImageData(W, W);
  for (let yy = 0; yy < W; yy++) im.data.set(px.subarray((W - 1 - yy) * W * 4, (W - yy) * W * 4), yy * W * 4);
  for (let i = 3; i < im.data.length; i += 4) im.data[i] = 255;
  g.putImageData(im, 0, 0);
  return c;
}

/* ---- ouvrir, fermer ---- */
function construireEcran(){
  if (ecran.overlay) return;
  ecran.overlay = $('dressOverlay'); ecran.scene = $('atelierScene'); ecran.cote = $('atelierCote');
  ecran.onglets = $('atelierOnglets'); ecran.contenu = $('atelierContenu'); ecran.titre = $('atelierTitre');
  ecran.etape = $('atelierEtape'); ecran.fini = $('atelierFini'); ecran.hasard = $('atelierHasard'); ecran.vues = $('atelierVues');
  ONGLETS.forEach(o => {
    const b = el('button', 'atelier-onglet', o.icone + '<span></span>'); b.type = 'button'; b.dataset.id = o.id; b.setAttribute('role', 'tab');
    b.addEventListener('click', () => { if (ecran.onglet !== o.id){ montrerOnglet(o.id); son('select'); } });
    ecran.onglets.appendChild(b);
  });
  [['pied', { fr: 'En pied', en: 'Full body' }], ['visage', { fr: 'Visage', en: 'Face' }]].forEach(([v, n]) => {
    const b = el('button', 'atelier-vue'); b.type = 'button'; b.dataset.vue = v; b.dataset.nom = JSON.stringify(n);
    b.addEventListener('click', () => { cadrer(v); son('tick'); });
    ecran.vues.appendChild(b);
  });
  ecran.hasard.addEventListener('click', auHasard);
  ecran.fini.addEventListener('click', terminer);
  $('dressClose').addEventListener('click', fermer);
  // on attrape le personnage pour le tourner ; la molette rapproche et éloigne
  const sc = ecran.scene;
  sc.addEventListener('pointerdown', (e) => {
    ecran.saisie = { id: e.pointerId, x: e.clientX, a: ecran.angle, t: e.timeStamp, v: 0 };
    ecran.elan = 0; sc.classList.add('tourne');
    try { sc.setPointerCapture(e.pointerId); } catch (err) {}
    eveiller();
  });
  sc.addEventListener('pointermove', (e) => {
    const P = perso;
    if (P && ecran.camera){
      // les yeux suivent le pointeur : sa place par rapport au visage, à l'écran
      const r = sc.getBoundingClientRect(), mx = (e.clientX - r.left) / r.width, my = (e.clientY - r.top) / r.height;
      const cam = ecran.camera, pv = cam.PV, y = P.yeuxY();
      const X = pv[0] * 0 + pv[4] * y + pv[12], Y = pv[1] * 0 + pv[5] * y + pv[13], W = pv[3] * 0 + pv[7] * y + pv[15];
      const ex = (X / W + 1) / 2, ey = (1 - Y / W) / 2;
      P.anim.regardCible = [clamp((mx - ex) * 3.2, -1, 1), clamp(-(my - ey) * 3.2, -1, 1)];
    }
    if (!ecran.saisie || e.pointerId !== ecran.saisie.id) return;
    const avant = ecran.angle;
    ecran.angle = ecran.saisie.a + (e.clientX - ecran.saisie.x) * TAU / 480;
    const dt = e.timeStamp - ecran.saisie.t;
    if (dt > 0){ ecran.saisie.v = (ecran.angle - avant) / dt; ecran.saisie.t = e.timeStamp; }
    eveiller();
  });
  const lacher = (e) => { if (!ecran.saisie || e.pointerId !== ecran.saisie.id) return; ecran.elan = ecran.saisie.v; ecran.saisie = null; sc.classList.remove('tourne'); };
  sc.addEventListener('pointerup', lacher); sc.addEventListener('pointercancel', lacher);
  sc.addEventListener('pointerleave', () => { if (perso) perso.anim.regardCible = null; });
  sc.addEventListener('wheel', (e) => {
    e.preventDefault();
    ecran.zoomCible = clamp(ecran.zoomCible - Math.sign(e.deltaY) * 0.25, 0, 1);
    [...ecran.vues.children].forEach(b => b.classList.toggle('on', b.dataset.vue === (ecran.zoomCible > 0.5 ? 'visage' : 'pied')));
    eveiller();
  }, { passive: false });
  ['pointermove', 'pointerdown', 'keydown', 'wheel'].forEach(n => ecran.overlay.addEventListener(n, eveiller, { capture: true, passive: true }));
  ecran.contenu.addEventListener('scroll', eveiller, { passive: true });
}
function libelles(){
  [...ecran.onglets.children].forEach(b => { const o = ONGLETS.find(x => x.id === b.dataset.id); b.querySelector('span').textContent = nomDe(o.nom); b.title = nomDe(o.nom); });
  [...ecran.vues.children].forEach(b => { b.textContent = nomDe(JSON.parse(b.dataset.nom)); });
  ecran.hasard.innerHTML = HASARD + '<span></span>'; ecran.hasard.querySelector('span').textContent = tr('Hasard', 'Random');
  ecran.fini.textContent = ecran.creation ? tr('Créer mon profil', 'Create my profile') : tr('Terminer', 'Done');
  ecran.etape.hidden = !ecran.creation;
  ecran.etape.textContent = tr('Création du profil', 'Profile creation');
  const moi = typeof profil !== 'undefined' && profil.existe() ? profil.lire() : null;
  ecran.titre.textContent = (moi && moi.nom) || ecran.brouillon.nom || titreParDefaut();
}
function ouvrir(opts){
  if (ecran.ouvert){ if (opts && opts.onglet) montrerOnglet(opts.onglet); return; }
  const gl2 = initGL();
  construireEcran();
  configuration();
  /* SANS WEBGL 2 (un vieux navigateur, un pilote en panne), l'atelier s'ouvre
     quand même, réduit à l'onglet Identité : on doit toujours pouvoir créer
     son profil. La scène le dit à la place du personnage. */
  ecran.overlay.classList.toggle('sans-3d', !gl2);
  if (!gl2){
    const moi2 = typeof profil !== 'undefined' && profil.existe();
    ecran.creation = !!(opts && opts.creation) && !moi2;
    ecran.brouillon.photoTouchee = false;
    ecran.ouvert = true;
    libelles();
    montrerOnglet('identite');
    ecran.scene.textContent = tr('Ce navigateur ne sait pas afficher le personnage en 3D.', 'This browser cannot display the 3D character.');
    ecran.overlay.classList.add('open');
    const ch2 = $('atelierCharge'); if (ch2) ch2.hidden = true;
    return;
  }
  const moi = typeof profil !== 'undefined' && profil.existe();
  ecran.creation = !!(opts && opts.creation) && !moi;
  ecran.brouillon.photoTouchee = false;
  if (!decor) monterDecor();
  const P = personnage();
  if (!P) return;
  ecran.ouvert = true;
  ecran.angle = 0; ecran.elan = 0; ecran.zoom = 0; ecran.dernier = 0;
  libelles();
  montrerOnglet((opts && opts.onglet) || (ecran.creation ? 'identite' : 'tenue'));
  ecran.overlay.classList.add('open');
  const ch = $('atelierCharge'); if (ch) ch.hidden = true;
  P.anim.gesticuler('coucou', P.anim.tDernier || 0);
  if (typeof sfx !== 'undefined'){ sfx.sansFond(true); sfx.salon(); }
  eveiller();
}
function enregistrerIdentite(){
  if (typeof profil === 'undefined' || !profil.existe()) return;
  const moi = profil.lire(), champ = ecran.champNom;
  const nom = champ ? champ.value.trim() : moi.nom;
  const valide = /^[\p{L}\p{N} ._-]{2,16}$/u.test(nom);
  const photo = ecran.brouillon.photoTouchee ? ecran.brouillon.photo : moi.photo;
  if ((valide && nom !== moi.nom) || photo !== moi.photo) profil.modifier(valide ? nom : moi.nom, photo);
}
function fermer(){
  if (!ecran.ouvert) return;
  if (!ecran.creation) enregistrerIdentite();
  ecran.ouvert = false;
  cancelAnimationFrame(ecran.raf); ecran.raf = 0;
  ecran.overlay.classList.remove('open');
  if (cvGL && cvGL.parentNode) cvGL.parentNode.removeChild(cvGL);
  fileV.length = 0;
  if (typeof sfx !== 'undefined') sfx.sansFond(false);
  majDiff(true);
  try { STOCK.ecrire('fp.tenue', cfg); } catch (e) {}
  if (typeof profil !== 'undefined') profil.rafraichir();
}
function terminer(){
  if (!ecran.creation){ son('add'); fermer(); return; }
  // la création : un nom valable, sinon on y retourne
  const nom = (ecran.brouillon.nom || '').trim();
  if (!/^[\p{L}\p{N} ._-]{2,16}$/u.test(nom)){
    if (ecran.onglet !== 'identite') montrerOnglet('identite');
    const c = ecran.champNom;
    if (c){ c.classList.remove('refus'); void c.offsetWidth; c.classList.add('refus'); c.focus(); }
    son('refus');
    return;
  }
  const photo = ecran.brouillon.photo || null;
  profil.creer(nom, photo);
  ecran.creation = false;
  const P = perso; if (P) P.anim.gesticuler('victoire', P.anim.tDernier || 0);
  son('win');
  libelles();
  setTimeout(() => { fermer(); profil.fini(); }, 1100);
}
/* ---- le clavier ----
   L'atelier prend toutes les touches tant qu'il est ouvert : Échap ferme,
   les flèches passent d'une commande à la plus proche dans leur direction
   (on lit la mise en page, on ne compte pas les colonnes), Page ↑ / Page ↓
   changent d'onglet. Un curseur garde ←/→. */
function touche(e){
  if (!ecran.ouvert) return false;
  eveiller();
  if (e.key === 'Escape'){ fermer(); return true; }
  const a = document.activeElement;
  if (a && a.tagName === 'INPUT' && a.type === 'text'){
    if (e.key === 'Enter'){ e.preventDefault(); a.blur(); }
    return true;                                          // on tape son nom : le reste va au champ
  }
  if (e.key === 'PageDown' || e.key === 'PageUp'){
    e.preventDefault();
    const i = ONGLETS.findIndex(o => o.id === ecran.onglet), n = ONGLETS.length;
    montrerOnglet(ONGLETS[(i + (e.key === 'PageDown' ? 1 : n - 1)) % n].id); son('select');
    return true;
  }
  const surCurseur = a && a.type === 'range';
  if (surCurseur && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return true;
  const F = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (F){
    e.preventDefault();
    const tout = [...ecran.overlay.querySelectorAll('button, input')].filter(x => x.offsetParent !== null && !x.hidden);
    const i = tout.indexOf(a);
    if (i < 0){ const p = ecran.contenu.querySelector('button, input'); if (p) p.focus(); return true; }
    const r0 = a.getBoundingClientRect(), ax = r0.left + r0.width / 2, ay = r0.top + r0.height / 2;
    let best = null, cout = Infinity;
    tout.forEach(x => {
      if (x === a) return;
      const r = x.getBoundingClientRect(), bx = r.left + r.width / 2, by = r.top + r.height / 2;
      const av = (bx - ax) * F[0] + (by - ay) * F[1];
      if (av <= 1) return;
      const c = av + Math.abs((bx - ax) * F[1] - (by - ay) * F[0]) * 2;
      if (c < cout){ cout = c; best = x; }
    });
    if (best){ best.focus(); best.scrollIntoView({ block: 'nearest' }); }
    return true;
  }
  return true;
}

/* ---------------------------------------------------------------------------
   L'ENTRÉE
   --------------------------------------------------------------------------- */
const api = {
  pret: () => initGL(),
  ouvrir, fermer, touche, dessinerProfil, image, portrait,
  ouvert: () => ecran.ouvert,
  config: () => configuration(),
  // contrôle : un personnage au repos, dans une toile 2D qu'on peut regarder
  apercu(w, h, cfg, vue){
    if (!initGL()) return null;
    vue = vue || {};
    const P = new Personnage(cfg);
    if (vue.plat) P.pieces.forEach(p => { if (!p.oeil) p.plat = 1; });
    if (vue.pose) vue.pose(P);
    P.anim.att = P.cfg.attitude || 'cool'; P.anim.avant = null;
    if (vue.repos) poser(P.R, P.rot, P.depl, P.pose); else P.anim.poser(P, vue.t || 0);
    cadre(w, h, true);
    const ang = (vue.angle || 0) * DEG;
    const modele = m4.qt(q4.axe([0, 1, 0], ang), [0, 0, 0]);
    const yc = vue.visage ? P.yeuxY() - 0.03 : P.m.H * (vue.y || 0.52);
    const dist = vue.visage ? 0.75 : vue.dist || 4.2;
    const cam = vue.oeil ? camera(w, h, vue.oeil, vue.cible, vue.fov || 30) : camera(w, h, [0, yc + (vue.visage ? 0.02 : 0.1), dist], [0, yc, 0], vue.fov || (vue.visage ? 24 : 30));
    if (vue.ciel !== false) dessinerCiel(cam, 0);
    dessinerPerso(P, cam, modele, LUMIERE);
    const c = toile(w, h); c.getContext('2d').drawImage(cvGL, 0, 0);
    P.liberer();
    return c;
  },
  /* contrôle : la scène entière. `o.construire` : un autre bâtisseur de décor
     (pour le mettre au point sans recharger ce fichier) ; `o.refaire` : le
     reconstruire ; `o.perso` : une configuration de personnage à poser au
     milieu ; `o.oeil`, `o.cible`, `o.fov`, `o.t` : la caméra et l'heure. */
  _scene(w, h, o){
    if (!initGL()) return null;
    o = o || {};
    if (!decor || o.refaire || o.construire) monterDecor(o.construire);
    const t = o.t || 0;
    cadre(w, h, true);
    const cam = camera(w, h, o.oeil || [0.9, 1.0, 4.2], o.cible || [0.9, 0.95, 0], o.fov || 30);
    dessinerCiel(cam, t);
    dessinerMer(decor.mer, cam, LUMIERE, t);
    dessinerDecor(decor.objets, cam, LUMIERE, t);
    if (o.perso){
      const P = new Personnage(o.perso);
      poser(P.R, P.rot, P.depl, P.pose);
      dessinerOmbre(cam, 0.05, -0.12, 0.42, 0.3, 0.55);
      dessinerPerso(P, cam, m4.qt(q4.axe([0, 1, 0], (o.angle || 0) * DEG), [0, 0, 0]), LUMIERE);
      P.liberer();
    }
    const c = toile(w, h); c.getContext('2d').drawImage(cvGL, 0, 0);
    return c;
  },
  _: { mesures, squelette, construireCorps, construireTete, Personnage, OS_NOMS, O, q4, v3, m4, peindreVisage, surfaceTete, normaliser, photosArticle, lirePhoto, coupeDe,
    construireCheveux, contexteCheveux, construireHaut, construireBas, construireChaussures, construireDessous, construireCouvre, peindreHaut, peindreMotif, tranchesHabit, versGPU, texture },
};
window.Atelier = api;
})();
