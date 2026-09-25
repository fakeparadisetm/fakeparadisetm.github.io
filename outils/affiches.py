# -*- coding: utf-8 -*-
"""Les affiches des mini-jeux (demande du 25 sept. 2026).

« Remplace les miniatures et fonds des mini-jeux par de vraies compositions en
SVG, animées en boucle, avec le titre dedans — et donc l'image plus grande. »

Chaque affiche est un tableau AU PIXEL, dans la grammaire de son jeu — les
mêmes palettes, les mêmes personnages, la même police de 3 × 5 pour les
enseignes —, écrit ici en primitives (rectangles, ellipses, polygones, dessins
en caractères) sur une grille de 192 × 144, puis exporté en SVG : chaque
couleur d'un calque devient UN chemin fait de ses segments de ligne, ce qui
garde les fichiers petits et le trait net à toutes les tailles
(`shape-rendering: crispEdges`). Ce qui bouge est posé sur des calques à part,
animés en CSS DANS le fichier — l'image se suffit à elle-même, le site n'a
qu'à la poser dans une balise <img>. Les mouvements se font par pas entiers
(`step-end`) : un pixel ne glisse pas, il saute.

Usage : python outils/affiches.py   (écrit affiches/*.svg à la racine du site)
"""
import math, os

W, H = 192, 144
NOIR = '#17121d'          # le cerne d'Age of Seum
ICI = os.path.dirname(os.path.abspath(__file__))
SORTIE = os.path.join(os.path.dirname(ICI), 'affiches')


# ---------------------------------------------------------------- calques
class Calque:
    """Une couche de pixels : {(x, y): couleur}. `cls` : la classe CSS qui
    l'anime (None : fixe)."""
    def __init__(self, cls=None, libre=False):
        self.px = {}
        self.cls = cls
        self.libre = libre      # libre : garde ce qui sort du cadre (un calque qui défile)

    def put(self, x, y, c):
        x, y = int(x), int(y)
        if self.libre or (0 <= x < W and 0 <= y < H):
            if c is None:
                self.px.pop((x, y), None)
            else:
                self.px[(x, y)] = c

    def rect(self, x, y, w, h, c):
        for j in range(int(round(y)), int(round(y + h))):
            for i in range(int(round(x)), int(round(x + w))):
                self.put(i, j, c)

    # les primitives d'Age of Seum, reprises telles quelles (voir index.html)
    def R(self, x, y, w, h, c):
        self.rect(x, y, w, h, c)

    def B(self, x, y, w, h, c):
        self.rect(x - 1, y - 1, w + 2, h + 2, NOIR)
        self.rect(x, y, w, h, c)

    def O(self, cx, cy, rx, ry, c):
        q = (ry + 0.5) * (ry + 0.5)
        for dy in range(-ry, ry + 1):
            hw = int(round(rx * math.sqrt(max(0, 1 - (dy * dy) / q))))
            self.rect(cx - hw, cy + dy, hw * 2 + 1, 1, c)

    def BO(self, cx, cy, rx, ry, c):
        self.O(cx, cy, rx + 1, ry + 1, NOIR)
        self.O(cx, cy, rx, ry, c)

    def POLY(self, p, c):
        ys = p[1::2]
        y0, y1 = min(ys), max(ys)
        n = len(p) // 2
        for y in range(int(math.floor(y0)), int(math.ceil(y1))):
            yc = y + 0.5
            a, b = math.inf, -math.inf
            for i in range(n):
                xa, ya = p[2 * i], p[2 * i + 1]
                xb, yb = p[(2 * i + 2) % len(p)], p[(2 * i + 3) % len(p)]
                if (ya <= yc < yb) or (yb <= yc < ya):
                    x = xa + (yc - ya) / (yb - ya) * (xb - xa)
                    a, b = min(a, x), max(b, x)
            if b > a:
                self.rect(round(a), y, max(1, round(b) - round(a)), 1, c)

    def BPOLY(self, p, c):
        n = len(p) // 2
        cx = sum(p[0::2]) / n
        cy = sum(p[1::2]) / n
        q = []
        for i in range(n):
            dx, dy = p[2 * i] - cx, p[2 * i + 1] - cy
            l = math.hypot(dx, dy) or 1
            q += [p[2 * i] + dx / l * 1.4, p[2 * i + 1] + dy / l * 1.4]
        self.POLY(q, NOIR)
        self.POLY(p, c)

    def dessin(self, x, y, lignes, pal, miroir=False, k=1):
        """Un dessin en caractères : une lettre par pixel, '.' ou ' ' vide."""
        larg = max(len(l) for l in lignes)
        for j, l in enumerate(lignes):
            for i, ch in enumerate(l):
                if ch in '. ':
                    continue
                ii = (larg - 1 - i) if miroir else i
                self.rect(x + ii * k, y + j * k, k, k, pal[ch])

    def masque(self):
        return set(self.px)

    def cerner(self, c, diag=True):
        """Un liseré d'un pixel autour de ce qui est déjà peint."""
        m = self.masque()
        vois = [(-1, 0), (1, 0), (0, -1), (0, 1)] + ([(-1, -1), (1, -1), (-1, 1), (1, 1)] if diag else [])
        for (x, y) in list(m):
            for dx, dy in vois:
                if (x + dx, y + dy) not in m:
                    self.put(x + dx, y + dy, c)

    def coller(self, autre, dx=0, dy=0):
        for (x, y), c in autre.px.items():
            self.put(x + dx, y + dy, c)


def decaler(cal, dx, dy, cls=None):
    n = Calque(cls if cls is not None else cal.cls, libre=True)
    n.coller(cal, dx, dy)
    return n


# ---------------------------------------------------------------- polices
# La police des enseignes et des bulles d'Age of Seum, reprise telle quelle.
GLYPHES = {
    'A': '.#.|#.#|###|#.#|#.#', 'B': '##.|#.#|##.|#.#|##.', 'C': '.##|#..|#..|#..|.##', 'D': '##.|#.#|#.#|#.#|##.',
    'E': '###|#..|##.|#..|###', 'F': '###|#..|##.|#..|#..', 'G': '.##|#..|#.#|#.#|.##', 'H': '#.#|#.#|###|#.#|#.#',
    'I': '###|.#.|.#.|.#.|###', 'J': '..#|..#|..#|#.#|.#.', 'K': '#.#|#.#|##.|#.#|#.#', 'L': '#..|#..|#..|#..|###',
    'M': '#...#|##.##|#.#.#|#...#|#...#', 'N': '#..#|##.#|#.##|#..#|#..#', 'O': '.#.|#.#|#.#|#.#|.#.',
    'P': '##.|#.#|##.|#..|#..', 'Q': '.#.|#.#|#.#|##.|.##', 'R': '##.|#.#|##.|#.#|#.#', 'S': '.##|#..|.#.|..#|##.',
    'T': '###|.#.|.#.|.#.|.#.', 'U': '#.#|#.#|#.#|#.#|###', 'V': '#.#|#.#|#.#|#.#|.#.', 'W': '#...#|#...#|#.#.#|##.##|#...#',
    'X': '#.#|#.#|.#.|#.#|#.#', 'Y': '#.#|#.#|.#.|.#.|.#.', 'Z': '###|..#|.#.|#..|###',
    '0': '###|#.#|#.#|#.#|###', '1': '.#.|##.|.#.|.#.|###', '2': '##.|..#|.#.|#..|###', '3': '##.|..#|.#.|..#|##.',
    '4': '#.#|#.#|###|..#|..#', '5': '###|#..|##.|..#|##.', '6': '.##|#..|###|#.#|###', '7': '###|..#|.#.|.#.|.#.',
    '8': '###|#.#|###|#.#|###', '9': '###|#.#|###|..#|##.',
    '!': '#|#|#|.|#', '?': '##.|..#|.#.|...|.#.', '.': '.|.|.|.|#', ',': '.|.|.|#|#', "'": '#|#|.|.|.',
    '-': '...|...|###|...|...', '+': '...|.#.|###|.#.|...', ':': '.|#|.|#|.', '/': '..#|..#|.#.|#..|#..',
    '&': '.#.|#.#|.#.|#.#|.##', '€': '.##|#..|###|#..|.##', '<': '.#.#.|#####|#####|.###.|..#..',
    '#': '.#.#.|#####|.#.#.|#####|.#.#.', '%': '#.#|..#|.#.|#..|#.#', ' ': '..|..|..|..|..',
}
# La police des titres : des fûts de deux pixels sur une grille de 6 × 7.
TITRE = {
    'A': ['.####.', '##..##', '##..##', '######', '##..##', '##..##', '##..##'],
    'E': ['######', '##....', '##....', '#####.', '##....', '##....', '######'],
    'F': ['######', '##....', '##....', '#####.', '##....', '##....', '##....'],
    'G': ['.####.', '##..##', '##....', '##.###', '##..##', '##..##', '.####.'],
    'I': ['######', '..##..', '..##..', '..##..', '..##..', '..##..', '######'],
    'J': ['....##', '....##', '....##', '....##', '##..##', '##..##', '.####.'],
    'M': ['##...##', '###.###', '#######', '##.#.##', '##...##', '##...##', '##...##'],
    'O': ['.####.', '##..##', '##..##', '##..##', '##..##', '##..##', '.####.'],
    'P': ['#####.', '##..##', '##..##', '#####.', '##....', '##....', '##....'],
    'R': ['#####.', '##..##', '##..##', '#####.', '##.##.', '##..##', '##..##'],
    'S': ['.#####', '##....', '##....', '.####.', '....##', '....##', '#####.'],
    'T': ['######', '..##..', '..##..', '..##..', '..##..', '..##..', '..##..'],
    'U': ['##..##', '##..##', '##..##', '##..##', '##..##', '##..##', '.####.'],
    'V': ['##..##', '##..##', '##..##', '##..##', '##..##', '.####.', '..##..'],
    ' ': ['...', '...', '...', '...', '...', '...', '...'],
}


def ecrire(cal, txt, x, y, c, k=1, contour=None):
    """Le texte des enseignes (police de 3 × 5) ; rend la largeur."""
    def plot(dx, dy, col):
        cx = 0
        for ch in txt:
            g = GLYPHES.get(ch, GLYPHES['?']).split('|')
            for j, l in enumerate(g):
                for i, v in enumerate(l):
                    if v == '#':
                        cal.rect(x + cx + i * k + dx, y + j * k + dy, k, k, col)
            cx += (len(g[0]) + 1) * k
        return cx - k
    if contour:
        for d in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            plot(d[0], d[1], contour)
    return plot(0, 0, c)


def largeur(txt, k=1):
    return sum((len(GLYPHES.get(ch, GLYPHES['?']).split('|')[0]) + 1) * k for ch in txt) - k


def masque_titre(txt, x, y, k, esp=1, italique=0):
    """Le masque d'un titre, lettre par lettre : {(x, y)} et la liste des
    boîtes de lettres (pour les dégradés par lettre). `italique` : décalage
    d'un pixel tous les `italique` rangs, vers la droite en montant."""
    m, cx = set(), x
    for ch in txt:
        g = TITRE[ch]
        for j, l in enumerate(g):
            for i, v in enumerate(l):
                if v == '#':
                    for a in range(k):
                        for b in range(k):
                            yy = y + j * k + b
                            dec = ((7 * k - 1 - (j * k + b)) // italique) if italique else 0
                            m.add((cx + i * k + a + dec, yy))
        cx += (len(g[0]) + esp) * k
    return m


def largeur_titre(txt, k, esp=1):
    return sum((len(TITRE[ch][0]) + esp) * k for ch in txt) - esp * k


def logo(cal, m, bandes, reflet=None, cerne=NOIR, relief=None, cerne2=None):
    """Un titre de jeu : un relief en escalier dessous (`relief` = (dx, dy,
    profondeur, couleur)), un cerne autour de l'ensemble, le remplissage en
    BANDES horizontales (du haut vers le bas du masque) et un reflet d'un
    pixel sur le haut de chaque fût."""
    ys = [p[1] for p in m]
    y0, y1 = min(ys), max(ys)
    tout = set(m)
    if relief:
        dx, dy, prof, col = relief
        for k in range(1, prof + 1):
            for (x, y) in m:
                p = (x + dx * k, y + dy * k)
                if p not in tout:
                    tout.add(p)
                    cal.put(p[0], p[1], col)
    # le cerne, autour du tout (lettres et relief)
    for (x, y) in list(tout):
        for ddx in (-1, 0, 1):
            for ddy in (-1, 0, 1):
                p = (x + ddx, y + ddy)
                if p not in tout:
                    cal.put(p[0], p[1], cerne)
    if cerne2:   # un second cerne, plus large, pour décoller le titre du fond
        c1 = set(p for p in cal.px if cal.px[p] == cerne) | tout
        for (x, y) in list(c1):
            for ddx, ddy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                p = (x + ddx, y + ddy)
                if p not in c1 and p not in cal.px:
                    cal.put(p[0], p[1], cerne2)
    n = len(bandes)
    for (x, y) in m:
        f = (y - y0) / max(1, (y1 - y0 + 1))
        cal.put(x, y, bandes[min(n - 1, int(f * n))])
    if reflet:
        for (x, y) in m:
            if (x, y - 1) not in m:
                cal.put(x, y, reflet)


# ---------------------------------------------------------------- export
def chemins(cal):
    """Une couleur, un chemin : les pixels d'une même ligne mis bout à bout."""
    par = {}
    for (x, y), c in cal.px.items():
        par.setdefault(c, set()).add((x, y))
    out = []
    for c, pts in sorted(par.items(), key=lambda kv: -len(kv[1])):
        d, lignes = [], {}
        for (x, y) in pts:
            lignes.setdefault(y, []).append(x)
        for y in sorted(lignes):
            xs = sorted(lignes[y])
            a = xs[0]
            prec = a
            for x in xs[1:] + [None]:
                if x is not None and x == prec + 1:
                    prec = x
                    continue
                d.append('M%d %dh%dv1h-%dz' % (a, y, prec - a + 1, prec - a + 1))
                if x is not None:
                    a = prec = x
        attr = ''
        if isinstance(c, tuple):          # (couleur, opacité)
            c, op = c
            attr = ' fill-opacity="%g"' % op
        out.append('<path fill="%s"%s d="%s"/>' % (c, attr, ''.join(d)))
    return out


def svg(titre, calques, css, desc=''):
    """Les calques dans l'ordre de peinture ; les fixes qui se suivent sont
    fondus en un seul."""
    fondus = []
    for c in calques:
        if c.cls is None and fondus and fondus[-1].cls is None:
            fondus[-1].coller(c)
        else:
            n = Calque(c.cls, libre=c.libre)
            n.coller(c)
            fondus.append(n)
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" shape-rendering="crispEdges">' % (W, H),
             '<title>%s</title>' % titre]
    if desc:
        parts.append('<desc>%s</desc>' % desc)
    parts.append('<style>' + css.strip() +
                 '@media (prefers-reduced-motion:reduce){*{animation:none!important}}</style>')
    for c in fondus:
        corps = ''.join(chemins(c))
        parts.append('<g class="%s">%s</g>' % (c.cls, corps) if c.cls else '<g>%s</g>' % corps)
    parts.append('</svg>')
    return '\n'.join(parts)


def images_cles(nom, pas, dur):
    """Des images clés à pas entiers : `pas` = [(fraction, déclarations CSS)].
    Tenue jusqu'à la suivante (step-end)."""
    corps = ''.join('%g%%{%s}' % (round(f * 100, 3), decl) for f, decl in pas)
    return '@keyframes %s{%s}' % (nom, corps)


def anim(cls, nom, dur, delai=0, fonction='step-end'):
    return '.%s{animation:%s %gs %s %gs infinite}' % (cls, nom, dur, fonction, delai)


def ecrire_fichier(nom, contenu):
    os.makedirs(SORTIE, exist_ok=True)
    chemin = os.path.join(SORTIE, nom)
    with open(chemin, 'w', encoding='utf-8', newline='\n') as f:
        f.write(contenu)
    print('%s : %d octets' % (nom, len(contenu.encode('utf-8'))))


# ---------------------------------------------------------------- outils de scène
def placer(dest, src, x, y, k=1, miroir=False):
    """Pose un calque dessiné en repère local (origine aux pieds) : agrandi
    k fois, retourné s'il le faut."""
    for (px, py), c in src.px.items():
        X = x + (-(px + 1) if miroir else px) * k
        dest.rect(X, y + py * k, k, k, c)


def bandes_ciel(cal, bandes, y0=0, tramer=True):
    """Un ciel en bandes, les jointures tramées en damier comme sur une
    machine à palette."""
    y = y0
    for i, (h, c) in enumerate(bandes):
        cal.rect(0, y, W, h, c)
        if tramer and i > 0:
            for x in range(0, W, 2):
                cal.put(x + (y % 2), y, bandes[i - 1][1])
        y += h
    return y


def cadres(css, calques, dur, prefixe):
    """Des images qui se succèdent : chacune visible sur sa part de la boucle."""
    n = len(calques)
    for i, c in enumerate(calques):
        c.cls = '%s%d' % (prefixe, i)
        a, b = i / n, (i + 1) / n
        pas = []
        if a > 0:
            pas.append((0, 'opacity:0'))
        pas.append((a, 'opacity:1'))
        if b < 1:
            pas.append((b, 'opacity:0'))
        pas.append((1, 'opacity:%d' % (1 if a == 0 else 0)))
        css.append(images_cles(c.cls, pas, dur))
        css.append(anim(c.cls, c.cls, dur))


def reflet_titre(css, m, prefixe, dur, larg=5, couleur='#ffffff', part=0.45):
    """Un éclat qui traverse le titre en diagonale, puis une longue pause :
    des images précalculées (la bande coupée par le masque des lettres)."""
    xs = [p[0] for p in m]
    ys = [p[1] for p in m]
    x0, x1, yb = min(xs) - 12, max(xs) + 12, min(ys)
    n = 14
    cals = []
    for k in range(n):
        c = Calque()
        pos = x0 + (x1 - x0) * k / (n - 1)
        for (x, y) in m:
            d = x + (y - yb) * 0.6 - pos
            if 0 <= d < larg:
                c.put(x, y, couleur)
        cals.append(c)
    # la bande ne passe que pendant `part` de la boucle
    for i, c in enumerate(cals):
        c.cls = '%s%d' % (prefixe, i)
        a, b = part * i / n, part * (i + 1) / n
        pas = [(0, 'opacity:%d' % (1 if i == 0 else 0))]
        if a > 0:
            pas.append((a, 'opacity:1'))
        pas.append((b, 'opacity:0'))
        pas.append((1, 'opacity:0'))
        css.append(images_cles(c.cls, pas, dur))
        css.append(anim(c.cls, c.cls, dur))
    return cals


# ============================================================== AGE OF SEUM
def seum():
    css = []
    fond = Calque()
    # le ciel d'Aubervilliers à la tombée du jour : violet en haut (le titre s'y détache), braise à l'horizon
    bandes_ciel(fond, [(14, '#1b1433'), (12, '#2a1b45'), (12, '#43225a'), (12, '#662a66'),
                       (10, '#8e3466'), (10, '#b8435e'), (9, '#dc5f52'), (9, '#f08a4c'), (56, '#f7b35a')])
    # des traînées de nuages, rosies par le couchant
    for x, y, w in [(118, 50, 34), (140, 54, 40), (4, 50, 30), (40, 56, 24)]:
        fond.rect(x, y, w, 1, '#d8687a')
        fond.rect(x + 4, y + 1, w - 8, 1, '#a8466e')

    # les tours, au loin, en ombres chinoises
    tours = Calque()
    for x, w, top in [(0, 22, 44), (24, 16, 56), (58, 14, 62), (100, 24, 38), (126, 18, 50), (168, 24, 46), (150, 14, 60)]:
        tours.rect(x, top, w, 106 - top, '#2d1d42')
        tours.rect(x, top, w, 1, '#46305e')
        tours.rect(x + w - 1, top, 1, 106 - top, '#3a2752')
        for yy in range(top + 4, 96, 5):
            for xx in range(x + 2, x + w - 2, 4):
                h_ = (xx * 131 + yy * 71) % 17
                if h_ < 3:
                    tours.rect(xx, yy, 2, 2, '#ffcf7a')
                elif h_ < 5:
                    tours.rect(xx, yy, 2, 2, '#4a3566')
        if x in (100, 168):     # une antenne
            tours.rect(x + w // 2, top - 7, 1, 7, '#46305e')
    # deux fenêtres qui s'allument et s'éteignent
    clign = [Calque(), Calque()]
    clign[0].rect(106, 50, 2, 2, '#ffcf7a'); clign[0].rect(174, 58, 2, 2, '#ffcf7a')
    clign[1].rect(114, 60, 2, 2, '#ffcf7a'); clign[1].rect(6, 60, 2, 2, '#ffcf7a')
    cadres(css, clign, 3.2, 'w')

    # la rangée d'immeubles et leurs boutiques
    rue = Calque()
    facades = [(0, 48, 58, '#6d4a5c', '#533848'), (48, 50, 64, '#5a3d57', '#452f47'),
               (98, 48, 57, '#74505e', '#5a3d4c'), (146, 46, 62, '#5e4050', '#48313e')]
    BOUT = 77                                          # le haut des boutiques
    for x, w, top, col, ombre in facades:
        rue.rect(x, top, w, 106 - top, col)
        rue.rect(x, top, w, 2, ombre)                 # la corniche
        rue.rect(x, top + 2, w, 1, '#8a6474')
        rue.rect(x + w - 1, top, 1, 106 - top, ombre)
        for r_ in range(2):
            for c_ in range(3):
                wx, wy = x + 5 + c_ * (w - 10) // 3, top + 4 + r_ * 9
                if wy + 8 > BOUT - 1:
                    continue
                allume = (wx * 7 + wy * 3) % 5 == 0
                rue.rect(wx, wy, 8, 7, '#f7c26a' if allume else '#2a1f35')
                if allume:
                    rue.rect(wx + 1, wy + 1, 6, 3, '#ffe2a0')
                else:
                    rue.rect(wx + 1, wy + 1, 3, 3, '#3b2c4a')
                rue.rect(wx - 1, wy + 7, 10, 1, '#3a2838')      # l'appui
        rue.rect(x + 1, BOUT, w - 2, 106 - BOUT, '#2b2233')   # la boutique
    enseignes = [(0, 48, 'KEBAB', '#c42020', '#ffd23a'), (48, 50, 'TAXIPHONE', '#1d56b3', '#ffffff'),
                 (98, 48, 'PRESSING', '#2e8f5e', '#ffffff'), (146, 46, 'TABAC', '#2a0f12', '#e8c35a')]
    for x, w, t, fondE, texte in enseignes:
        rue.rect(x + 2, BOUT, w - 4, 8, fondE)
        rue.rect(x + 2, BOUT, w - 4, 1, '#ffffff' if fondE != '#2a0f12' else '#5a2a2a')
        ecrire(rue, t, x + (w - largeur(t)) // 2, BOUT + 2, texte)
        rue.rect(x + 5, BOUT + 11, w // 2 - 4, 16, '#ffd98a')    # la vitrine
        rue.rect(x + 6, BOUT + 12, w // 2 - 6, 4, '#fff0c8')
        rue.rect(x + w // 2 + 5, BOUT + 10, 8, 106 - BOUT - 10, '#15101c')   # la porte
    # la broche du kebab, dans sa vitrine
    rue.POLY([10, 89, 18, 89, 16, 103, 12, 103], '#8a4b26')
    rue.rect(13, 88, 1, 16, '#c0c0c0')
    for k in range(4):
        rue.rect(11, 91 + k * 3, 6, 1, '#5a2a12')
    # la carotte du tabac, en drapeau sur la façade
    rue.BPOLY([188, 64, 191, 71, 188, 80, 185, 71], '#d8262c')
    ecrire(rue, 'T', 187, 69, '#ffffff')
    # le « 93 » tagué, rose, sur le mur du taxiphone
    tag = Calque()
    ecrire(tag, '93', 56, 66, '#ff4fb0', 2, NOIR)
    # le M du métro, sur son mât, entre deux boutiques
    rue.rect(97, 72, 2, 34, '#2e4a3a')
    rue.O(98, 69, 5, 5, NOIR); rue.O(98, 69, 4, 4, '#f2c230')
    ecrire(rue, 'M', 96, 67, NOIR)

    # le trottoir et la rue
    rue.rect(0, 106, W, 7, '#8a7a90')
    rue.rect(0, 106, W, 1, '#a898ad')
    for x in range(4, W, 12):
        rue.rect(x, 107, 1, 6, '#7a6a80')
    rue.rect(0, 113, W, 2, '#54465e')
    rue.rect(0, 115, W, H - 115, '#3b3448')
    for x in range(0, W, 3):
        for y in range(116, H, 4):
            if (x * 13 + y * 7) % 11 == 0:
                rue.put(x, y, '#443c52')
    for x in range(2, W, 14):
        rue.rect(x, 131, 7, 2, '#bdb3c8')
    # les potelets, bruns à tête dorée, le long du trottoir
    for x in list(range(6, 58, 14)) + list(range(136, 192, 14)):
        rue.B(x, 106, 2, 7, '#6b3b22')
        rue.R(x, 105, 2, 1, '#c9a34a')

    # le sanglier, sur son matelas, au milieu du champ de bataille (le dessin du jeu)
    sang = Calque()
    x, y = 64, 114
    sang.B(x, y - 8, 64, 4, '#f7c8da'); sang.B(x, y - 4, 64, 3, '#e79ab5')
    for k in range(4, 62, 7):
        sang.R(x + k, y - 6, 1, 1, '#d4769c')
    sang.O(x + 47, y - 6, 5, 1, '#e8d38a')
    sang.BO(x + 36, y - 13, 17, 6, '#5b4334')
    for i in range(8):
        sang.R(x + 24 + i * 4, y - 20 + (i & 1), 2, 2, '#3a2a20')
    sang.BO(x + 17, y - 12, 7, 5, '#5b4334')
    sang.B(x + 7, y - 12, 5, 4, '#5b4334'); sang.R(x + 5, y - 12, 2, 4, '#e0a0a0'); sang.R(x + 5, y - 11, 1, 1, '#6a2a2a')
    sang.R(x + 9, y - 9, 1, 2, '#fff8e8')
    sang.R(x + 14, y - 14, 3, 1, NOIR)
    sang.BPOLY([x + 17, y - 17, x + 20, y - 21, x + 22, y - 16], '#3a2a20')
    sang.R(x + 27, y - 8, 4, 2, '#3f2d24'); sang.R(x + 44, y - 8, 4, 2, '#3f2d24')
    sang.R(x + 53, y - 15, 2, 1, NOIR)
    # son souffle : le flanc qui se soulève (deux images)
    souffle = [Calque(), Calque()]
    souffle[1].O(x + 36, y - 19, 12, 1, '#5b4334')
    for i in range(1, 7):
        souffle[1].R(x + 24 + i * 4, y - 21 + (i & 1), 2, 2, '#3a2a20')
    cadres(css, souffle, 2.4, 's')
    # les Z, qui montent en s'effaçant, l'un après l'autre
    zz = []
    for k in range(3):
        c = Calque('z%d' % k)
        ecrire(c, 'Z', x + 18, y - 24, '#ffffff', 1 + (k == 1), NOIR)
        zz.append(c)
        pas = []
        n = 10
        for i in range(n + 1):
            f = i / n
            pas.append((f, 'transform:translate(%dpx,%dpx);opacity:%g' % (round(12 * f), -round(22 * f), round(1 - f * 0.9, 2))))
        css.append(images_cles('z%d' % k, pas, 2.7))
        css.append(anim('z%d' % k, 'z%d' % k, 2.7, delai=-0.9 * k))

    # ---- deux unités face à face : Doge à gauche, le contrôleur URSSAF à droite ----
    def pattes(cal, xs, h, col, ph):
        for i, x_ in enumerate(xs):
            a = 1 if ((i & 1) ^ ph) else 0
            cal.B(x_ + a, -h, 2, h - 1, col)
    def jambes(cal, cx, h, col, ph, ecart=4, pied=NOIR):
        a = 1 if ph else -1
        x1, x2 = cx - (ecart >> 1) + a, cx + (ecart >> 1) - 1 - a
        cal.R(x1, -h, 2, h - 1, col); cal.R(x2, -h, 2, h - 1, col)
        cal.R(x1 - 1, -1, 3, 1, pied); cal.R(x2, -1, 3, 1, pied)
    def doge(ph, tr):
        c = Calque(libre=True)
        o, cl = '#d99a4e', '#f4e1bf'
        c.BO(-18, -15, 2, 2, o); c.R(-18, -15, 1, 1, cl)
        c.B(-18, -13, 13, 7, o); c.R(-17, -8, 11, 2, cl)
        pattes(c, [-17, -14, -9, -6], 6, o, ph)
        c.BO(-3, -15, 5, 5, o)
        c.BPOLY([-8, -18, -6, -24, -4, -19], o); c.BPOLY([-2, -19, 0, -24, 2, -18], o)
        c.R(-6, -20, 1, 2, '#8a4f22'); c.R(0, -20, 1, 2, '#8a4f22')
        c.O(-3, -12, 4, 2, cl)
        c.R(-6, -16, 2, 1, '#ffffff'); c.R(-6, -16, 1, 1, NOIR)
        c.R(-1, -16, 2, 1, '#ffffff'); c.R(-1, -16, 1, 1, NOIR)
        c.R(-7, -18, 2, 1, '#8a4f22'); c.R(-1, -18, 2, 1, '#8a4f22')
        c.R(-4, -13, 2, 1, NOIR)
        if tr:
            c.R(-4, -11, 2, 1, '#8a2a2a')
        return c
    def urssaf(ph):
        c = Calque(libre=True)
        jambes(c, -10, 10, '#4a505c', ph, 4, '#111111')
        c.B(-16, -23, 12, 13, '#5b6272')
        c.R(-11, -23, 2, 9, '#ffffff'); c.R(-10, -22, 1, 7, '#2a3a8a')
        c.B(-4, -17, 2, 7, '#5b6272'); c.B(-6, -12, 8, 7, '#6b4428'); c.R(-3, -13, 2, 1, '#caa46a')
        c.BO(-10, -29, 4, 5, '#e8c6a8')
        c.R(-12, -30, 2, 1, '#333333'); c.R(-9, -30, 2, 1, '#333333'); c.R(-10, -30, 1, 1, '#333333')
        c.O(-10, -34, 4, 1, '#9aa0a8')
        c.R(-11, -26, 3, 1, '#9a6a5a')
        return c
    # l'ombre au sol sous chacun
    rue.rect(14, 140, 38, 2, '#2e2839')
    rue.rect(146, 140, 30, 2, '#2e2839')
    unites = []
    for ph in (0, 1):
        c = Calque()
        placer(c, doge(ph, ph == 1), 50, 141, k=2)
        placer(c, urssaf(ph), 150, 141, k=2, miroir=True)
        unites.append(c)
    cadres(css, unites, 0.8, 'u')
    # le « WOW » que Doge lance, en cloche, jusqu'au contrôleur
    wow = []
    cols = ['#ff4df0', '#4dfcff', '#ffe94d', '#6dff5a']
    n = 12
    for i in range(n):
        u = i / (n - 1)
        c = Calque()
        xx = round(52 + (128 - 52) * u)
        yy = round(112 + (86 - 112) * u - 30 * 4 * u * (1 - u))
        ecrire(c, 'WOW', xx, yy, cols[i % 4], 1, NOIR)
        wow.append(c)
    wow += [Calque() for _ in range(6)]       # une pause entre deux jets
    cadres(css, wow, 1.8, 'v')
    # la bulle du contrôleur, les deux tiers du temps
    bulle = Calque('b0')
    t = 'CONTROLE URSSAF'
    bw = largeur(t) + 6
    bx, by = W - bw - 3, 64
    bulle.rect(bx - 1, by - 1, bw + 2, 11, NOIR)
    bulle.rect(bx, by, bw, 9, '#ffffff')
    bulle.POLY([bx + bw - 14, by + 9, bx + bw - 8, by + 9, bx + bw - 12, by + 14], NOIR)
    bulle.POLY([bx + bw - 13, by + 8, bx + bw - 9, by + 8, bx + bw - 12, by + 12], '#ffffff')
    ecrire(bulle, t, bx + 3, by + 2, NOIR)
    css.append(images_cles('b0', [(0, 'opacity:1'), (0.66, 'opacity:0'), (1, 'opacity:1')], 3.6))
    css.append(anim('b0', 'b0', 3.6))

    # ---- le titre : AGE OF, puis SEUM en grand, en braise, en relief ----
    titre = Calque()
    k1 = 2
    l1 = largeur_titre('AGE OF', k1)
    m1 = masque_titre('AGE OF', (W - l1) // 2, 5, k1)
    logo(titre, m1, ['#ffffff', '#fff3d6', '#ffe0b0'], reflet=None, relief=(1, 1, 2, '#3a1433'))
    k2 = 5
    l2 = largeur_titre('SEUM', k2)
    m2 = masque_titre('SEUM', (W - l2) // 2 - 1, 23, k2)
    logo(titre, m2, ['#fff27a', '#ffd23a', '#ffa42a', '#ff6a2a', '#e8321e', '#b81e2a'], reflet='#fffbd0',
         relief=(1, 1, 4, '#5a0f1a'))
    eclat = reflet_titre(css, m2, 'r', 4.2, larg=4, couleur='#ffffff')

    calques = [fond, tours] + clign + [rue, tag, sang] + souffle + zz + unites + wow + [bulle, titre] + eclat
    return svg('Age of Seum', calques, ''.join(css), "Affiche du mini-jeu Age of Seum")


# ============================================================== ITEM VERSUS
def versus():
    css = []
    fond = Calque()
    # l'éclair qui fend l'image : une ligne brisée, du haut vers le bas
    fente = [(102, 0), (95, 16), (104, 30), (93, 48), (101, 62), (90, 80), (99, 96), (91, 112), (100, 128), (94, 144)]
    def x_fente(y):
        for (x0, y0), (x1, y1) in zip(fente, fente[1:]):
            if y0 <= y <= y1:
                return x0 + (x1 - x0) * (y - y0) / max(1, y1 - y0)
        return fente[-1][0]
    SOL = 126
    # ---- à gauche, la ruelle, la nuit ----
    ruelle = Calque()
    bandes_ciel(ruelle, [(10, '#0d0b12'), (8, '#161327'), (8, '#1d1830'), (118, '#241d38')])
    ruelle.O(30, 12, 5, 5, '#cfd6e8'); ruelle.O(32, 11, 4, 4, '#241d38')     # un croissant de lune
    ruelle.rect(8, 30, 84, SOL - 30, '#221c2a')                              # le mur du fond
    for y in range(33, SOL - 4, 6):
        ruelle.rect(8, y, 84, 1, '#1a1522')
        for x in range(8 + (y // 6 % 2) * 6, 92, 12):
            ruelle.rect(x, y - 5, 1, 5, '#1e1826')
    for i in range(4):
        for j in range(3):
            x, y = 14 + i * 20, 40 + j * 24
            on = (i * 3 + j) % 4 == 1
            ruelle.rect(x, y, 10, 14, '#f0c46a' if on else '#171223')
            if on:
                ruelle.rect(x + 1, y + 1, 8, 5, '#fce7b0')
                ruelle.rect(x, y + 7, 10, 1, '#0f0c17')
            else:
                ruelle.rect(x + 1, y + 1, 4, 6, '#211a2e')
    # l'escalier de secours, et la benne
    for y in range(36, SOL - 10, 22):
        ruelle.rect(2, y, 14, 2, '#2c2438'); ruelle.rect(2, y, 2, 22, '#2c2438'); ruelle.rect(14, y, 2, 22, '#241d30')
    ruelle.rect(0, SOL, 100, H - SOL, '#17161f'); ruelle.rect(0, SOL, 100, 2, '#262133')
    for i in range(30):
        ruelle.put((i * 53) % 96, SOL + 4 + (i * 17) % 14, '#221f2c')
    # ---- à droite, la plage au couchant ----
    plage = Calque()
    CIEL = ['#2b1b4a', '#5a2a6a', '#8f3570', '#c8456b', '#e86a55', '#f79a4e', '#ffc86a']
    MER = 100
    bandes_ciel(plage, [(MER // len(CIEL) + (1 if i < MER % len(CIEL) else 0), c) for i, c in enumerate(CIEL)] + [(H - MER, '#2f6f8f')])
    cx_, cy_, rad = 150, MER - 1, 16
    for r in range(rad, 0, -1):          # le soleil, strié comme il se doit
        dy = cy_ - r
        dx = math.sqrt(rad * rad - r * r)
        plage.rect(cx_ - dx, dy, dx * 2, 1, '#ffd88a' if (cy_ - dy) % 5 < 3 else '#ff9a5c')
    for i in range(6):                   # le front de mer art déco
        bw, x, bh = 10 + (i % 3) * 5, 104 + i * 15, 10 + (i % 3) * 5
        plage.rect(x, MER - bh, bw, bh, '#f0d4bc' if i % 2 else '#cfe6e0')
        plage.rect(x, MER - bh, bw, 1, '#ffffff')
        for k in range(2, bh - 2, 4):
            plage.rect(x + 2, MER - bh + k, bw - 4, 2, '#8fb4c4')
    for y in range(MER + 2, SOL, 4):
        plage.rect(96, y, 96, 1, '#3f89a8')
    plage.rect(96, SOL, 96, H - SOL, '#e0c48c'); plage.rect(96, SOL, 96, 2, '#f2dcae')
    for i in range(40):
        plage.put(100 + (i * 47) % 92, SOL + 4 + (i * 13) % 14, '#c9a870')
    def palmier(cal, x, y, h, pench, col='#1d1030'):
        # le tronc, qui penche de `pench` pixels en haut ; puis sept palmes qui retombent
        for k in range(h):
            xx = x + pench * (k / h) ** 2
            cal.rect(round(xx) - 1, y - k, 3, 1, col)
        hx, hy = round(x + pench), y - h
        for ang, L in [(-2.9, 15), (-2.4, 17), (-1.9, 12), (-1.1, 12), (-0.6, 17), (-0.15, 15), (-3.4, 13)]:
            for s_ in range(L):
                px = hx + math.cos(ang) * s_
                py = hy + math.sin(ang) * s_ * 0.55 + (s_ / L) ** 2 * 7
                ep = 3 if s_ < L * 0.6 else 2
                cal.rect(round(px), round(py), ep, ep - 1, col)
        cal.O(hx, hy + 1, 2, 2, col)
    palmier(plage, 184, SOL + 1, 50, -5)
    # la découpe : la plage à droite de la fente, la ruelle à gauche
    for (x, y), c in list(ruelle.px.items()):
        if x >= x_fente(y):
            del ruelle.px[(x, y)]
    for (x, y), c in list(plage.px.items()):
        if x < x_fente(y):
            del plage.px[(x, y)]
    fond.coller(ruelle); fond.coller(plage)
    # l'éclair : un halo, un trait, un cœur blanc ; il vacille
    def trait(cal, ep, col):
        for (x0, y0), (x1, y1) in zip(fente, fente[1:]):
            n = max(abs(x1 - x0), abs(y1 - y0)) * 2
            for s in range(int(n) + 1):
                x = x0 + (x1 - x0) * s / n
                y = y0 + (y1 - y0) * s / n
                cal.rect(round(x - ep / 2), round(y - ep / 2), ep, ep, col)
    eclairs = []
    for force in (1.0, 0.55, 1.0, 0.0, 1.0, 0.8):
        c = Calque()
        if force > 0:
            trait(c, 7, '#8a6a3a' if force < 1 else '#b8904a')
            trait(c, 4, '#ffe9a8')
            trait(c, 2, '#ffffff')
        eclairs.append(c)
    cadres(css, eclairs, 1.1, 'e')

    # ---- les deux combattants : le t-shirt bleu à l'arc, le hoodie rouge au pistolet ----
    def tshirt(cal, cx, y0):
        bleu, ombre, clair, dedans = '#3f7df6', '#2a5bc0', '#7aa8ff', '#1a3a80'
        forme = [cx - 6, y0, cx - 14, y0 + 2, cx - 26, y0 + 14, cx - 19, y0 + 20, cx - 14, y0 + 15,
                 cx - 14, y0 + 38, cx + 14, y0 + 38, cx + 14, y0 + 15, cx + 19, y0 + 20, cx + 26, y0 + 14,
                 cx + 14, y0 + 2, cx + 6, y0]
        cal.BPOLY(forme, bleu)
        cal.POLY([cx + 6, y0 + 1, cx + 14, y0 + 3, cx + 25, y0 + 14.5, cx + 19, y0 + 19, cx + 13, y0 + 14,
                  cx + 13, y0 + 38, cx + 7, y0 + 38, cx + 9, y0 + 12], ombre)
        cal.POLY([cx - 12, y0 + 5, cx - 22, y0 + 13, cx - 19, y0 + 16, cx - 12, y0 + 11], clair)
        cal.O(cx, y0 + 1, 5, 2, NOIR); cal.O(cx, y0 + 1, 4, 1, dedans)           # l'encolure
        cal.rect(cx - 13, y0 + 36, 26, 1, ombre)                                   # l'ourlet
        cal.rect(cx - 8, y0 + 22, 1, 10, ombre); cal.rect(cx + 3, y0 + 18, 1, 12, '#2f68d8')   # deux plis
        # le palmier de la marque, imprimé en blanc sur le cœur
        cal.rect(cx - 7, y0 + 13, 1, 7, '#ffffff')
        cal.rect(cx - 10, y0 + 12, 3, 1, '#ffffff'); cal.rect(cx - 6, y0 + 12, 3, 1, '#ffffff')
        cal.put(cx - 11, y0 + 13, '#ffffff'); cal.put(cx - 4, y0 + 13, '#ffffff')
    def arc(cal, x, y0, tendu):
        for k in range(37):
            yy = y0 + k
            b = round(7 * math.sin(math.pi * k / 36))
            cal.rect(x + b - 1, yy, 3, 1, NOIR)
        for k in range(1, 36):
            b = round(7 * math.sin(math.pi * k / 36))
            cal.put(x + b, y0 + k, '#b87838' if k % 6 else '#e0a050')
        corde = x - (4 if tendu else 0)
        cal.POLY([x, y0, corde + 0.5, y0 + 18, x, y0 + 36, x + 1, y0 + 36, corde + 1.5, y0 + 18, x + 1, y0], '#f4f0e6')
        # la flèche encochée
        cal.rect(corde, y0 + 17, 22, 3, NOIR); cal.rect(corde + 1, y0 + 18, 20, 1, '#d8c090')
        cal.POLY([corde + 21, y0 + 15, corde + 27, y0 + 18.5, corde + 21, y0 + 22], NOIR)
        cal.POLY([corde + 22, y0 + 16.5, corde + 25.5, y0 + 18.5, corde + 22, y0 + 20.5], '#c8ccd8')
        cal.rect(corde - 3, y0 + 16, 4, 1, '#e84a5f'); cal.rect(corde - 3, y0 + 20, 4, 1, '#e84a5f')   # l'empenne
    def hoodie(cal, cx, y0):
        rouge, ombre, clair, dedans = '#f03c3c', '#b82828', '#ff7a7a', '#5a1010'
        # la manche levée, qui tient le pistolet (vers la gauche)
        cal.BPOLY([cx - 14, y0 + 14, cx - 38, y0 + 20, cx - 38, y0 + 31, cx - 14, y0 + 29], rouge)
        cal.rect(cx - 37, y0 + 26, 22, 2, ombre)
        cal.rect(cx - 41, y0 + 20, 4, 11, ombre); cal.rect(cx - 41, y0 + 20, 1, 11, NOIR)
        # le corps, l'autre manche le long du flanc
        cal.BPOLY([cx - 16, y0 + 13, cx + 16, y0 + 13, cx + 26, y0 + 40, cx + 18, y0 + 42, cx + 16, y0 + 30,
                   cx + 16, y0 + 46, cx - 16, y0 + 46], rouge)
        cal.POLY([cx + 8, y0 + 14, cx + 16, y0 + 14, cx + 25, y0 + 39.5, cx + 19, y0 + 41, cx + 15, y0 + 29,
                  cx + 15, y0 + 46, cx + 8, y0 + 46], ombre)
        cal.rect(cx - 16, y0 + 42, 32, 4, ombre)                                  # la côte du bas
        for x in range(cx - 15, cx + 16, 3):
            cal.rect(x, y0 + 42, 1, 4, '#9a2020')
        cal.POLY([cx - 9, y0 + 30, cx + 9, y0 + 30, cx + 12, y0 + 41, cx - 12, y0 + 41], ombre)   # la poche kangourou
        cal.rect(cx - 9, y0 + 30, 18, 1, '#ff5a5a')
        # la capuche, relevée, et son ouverture sombre
        cal.BO(cx, y0 + 9, 13, 10, rouge)
        cal.O(cx - 4, y0 + 5, 6, 3, clair)
        cal.O(cx, y0 + 11, 8, 7, NOIR); cal.O(cx, y0 + 11, 7, 6, dedans)
        cal.O(cx, y0 + 12, 4, 4, '#2a0808')
        # deux yeux qui brillent dans l'ombre de la capuche
        cal.rect(cx - 4, y0 + 10, 2, 1, '#ffe07a'); cal.rect(cx + 2, y0 + 10, 2, 1, '#ffe07a')
        # les cordons
        cal.rect(cx - 3, y0 + 18, 1, 10, '#f4f0e6'); cal.rect(cx + 3, y0 + 18, 1, 10, '#f4f0e6')
        cal.rect(cx - 3, y0 + 28, 1, 2, '#c8ccd8'); cal.rect(cx + 3, y0 + 28, 1, 2, '#c8ccd8')
    def pistolet(cal, x, y, eclair):
        cal.rect(x - 14, y - 2, 14, 5, NOIR); cal.rect(x - 13, y - 1, 12, 3, '#5a5f6b')
        cal.rect(x - 13, y - 1, 12, 1, '#8a909c')
        cal.rect(x - 5, y + 2, 5, 7, NOIR); cal.rect(x - 4, y + 3, 3, 5, '#3a3f4b')
        if eclair:
            cal.POLY([x - 14, y - 5, x - 26, y + 0.5, x - 14, y + 6], '#ffd060')
            cal.POLY([x - 14, y - 2, x - 20, y + 0.5, x - 14, y + 3], '#ffffff')
    combat = []
    for i in range(4):
        c = Calque()
        d = 1 if i % 2 else 0                       # le souffle du combattant : un pixel
        tshirt(c, 44, 88 + d)
        arc(c, 72, 84 + d, tendu=(i % 2 == 0))
        hoodie(c, 150, 80 + (1 - d))
        pistolet(c, 109, 103 + (1 - d), eclair=(i == 3))
        # les ombres au sol
        c.rect(22, SOL + 1, 46, 2, '#0e0c14')
        c.rect(128, SOL + 1, 46, 2, '#c9a870')
        combat.append(c)
    cadres(css, combat, 1.6, 'c')
    # les pastilles P1 / P2
    pastilles = Calque()
    for x, y, t, col in [(38, 76, 'P1', '#3f7df6'), (144, 64, 'P2', '#f03c3c')]:
        pastilles.rect(x - 1, y - 1, 13, 9, NOIR); pastilles.rect(x, y, 11, 7, col)
        ecrire(pastilles, t, x + 2, y + 1, '#ffffff')
        pastilles.POLY([x + 3, y + 7, x + 8, y + 7, x + 5.5, y + 10], NOIR)

    # ---- le VS, au milieu, sur une étoile qui bat ----
    def etoile(cal, cx, cy, r1, r2, n, col, rot=0):
        p = []
        for k in range(n * 2):
            a = rot + math.pi * k / n
            r = r1 if k % 2 == 0 else r2
            p += [cx + math.cos(a) * r, cy + math.sin(a) * r * 0.8]
        cal.POLY(p, col)
    vs = []
    VX, VY = 97, 76            # entre les deux têtes : les armes restent en vue
    for i, (r1, r2) in enumerate([(19, 11), (22, 12)]):
        c = Calque()
        etoile(c, VX, VY, r1 + 2, r2 + 2, 10, NOIR, rot=0.15 * i)
        etoile(c, VX, VY, r1, r2, 10, '#d8262c', rot=0.15 * i)
        etoile(c, VX, VY, r1 - 5, r2 - 3, 10, '#ffa42a', rot=0.15 * i)
        m = masque_titre('VS', VX - largeur_titre('VS', 2) // 2 - 1, VY - 7, 2, italique=3)
        logo(c, m, ['#fff27a', '#ffd23a', '#ffa42a', '#ff6a2a'], reflet='#ffffff', relief=(1, 1, 2, '#5a0f1a'))
        vs.append(c)
    cadres(css, vs, 0.5, 'x')
    # des étincelles qui partent de l'étoile
    etincelles = []
    for f in range(6):
        c = Calque()
        for k in range(7):
            a = k * 0.9 + f * 0.35
            d = 20 + f * 5
            x, y = VX + math.cos(a) * d, VY + math.sin(a) * d * 0.7
            if f < 5:
                c.rect(round(x), round(y), 2 if f < 3 else 1, 2 if f < 3 else 1, '#fff6c0' if f < 2 else '#ffb050')
        etincelles.append(c)
    cadres(css, etincelles, 0.9, 't')

    # ---- le titre : ITEM, puis VERSUS en chrome, penché ----
    titre = Calque()
    l1 = largeur_titre('ITEM', 2)
    m1 = masque_titre('ITEM', (W - l1) // 2 + 4, 3, 2, italique=3)
    logo(titre, m1, ['#ffffff', '#ffe0e0', '#ffb0b0'], relief=(1, 1, 2, '#6a0f1a'))
    k = 4
    l2 = largeur_titre('VERSUS', k)
    m2 = masque_titre('VERSUS', (W - l2) // 2 - 3, 21, k, italique=4)
    logo(titre, m2, ['#ffffff', '#e8eeff', '#b8c8f0', '#7890d8', '#4a5ab0', '#ffffff', '#d0d8f0', '#9aa8d8'],
         reflet='#ffffff', relief=(1, 1, 3, '#8a1020'))
    eclat = reflet_titre(css, m2, 'r', 3.6, larg=4, couleur='#ffffff')

    calques = [fond] + eclairs + combat + [pastilles] + etincelles + vs + [titre] + eclat
    return svg('Item Versus', calques, ''.join(css), 'Affiche du mini-jeu Item Versus')


# =================================================================== JUMPER
def jumper():
    P = dict(ciel='#5c94fc', nuage='#ffffff', nuageBas='#c8dcff',
             colline='#00a844', collineOmbre='#007028', collineTrait='#00401a',
             brique='#c06028', briqueHaut='#e89848', briqueBas='#803010', joint='#000000',
             briqueFri='#b0765a', briqueFriHaut='#d0a488', briqueFriBas='#74463a',
             pic='#e02820', picOmbre='#a01010', fanion='#30c030',
             corps='#ffffff', corpsOmbre='#c8c8d8', trait='#000000', metal='#e8e8f0', mat='#f8d038')
    fond = Calque()
    fond.rect(0, 0, W, H, P['ciel'])
    css = []

    # les collines, au loin : des dômes cernés de vert sombre
    coll = Calque()
    for cx, r, h in [(18, 30, 30), (70, 22, 20), (132, 34, 36), (186, 24, 22)]:
        base = 128
        for x in range(cx - r - 2, cx + r + 3):
            u = (x - cx) / r
            if abs(u) <= 1:
                top = base - int(round(h * math.sqrt(1 - u * u)))
                coll.rect(x, top, 1, base - top, P['colline'])
        # l'ombre du flanc droit, puis le cerne
        for (x, y) in list(coll.px):
            if x > cx + r * 0.35 and abs(x - cx) <= r:
                coll.put(x, y, P['collineOmbre'])
    m = coll.masque()
    for (x, y) in list(m):
        for dx, dy in ((0, -1), (-1, 0), (1, 0)):
            if (x + dx, y + dy) not in m and y + dy < 128:
                coll.put(x + dx, y + dy, P['collineTrait'])
    # quelques taches de lumière sur les dômes
    for x, y in [(14, 108), (22, 103), (128, 101), (138, 97), (66, 115)]:
        coll.rect(x, y, 2, 2, '#30c060')

    # les nuages : trois, qui passent lentement (un calque chacun)
    def nuage(cal, x, y, s):
        forme = ['....####......',
                 '..########..#.',
                 '.############.',
                 '##############',
                 '##############',
                 '.############.']
        pal = {'#': P['nuage']}
        k = s
        cal.dessin(x, y, forme, pal, k=k)
        # le dessous bleuté, puis le cerne noir
        for (xx, yy) in list(cal.px):
            if (xx, yy + k) not in cal.px and yy >= y + 3 * k:
                cal.put(xx, yy, P['nuageBas'])
        cal.cerner(P['trait'], diag=False)
    nuages = []
    for i, (x, y, s, d) in enumerate([(8, 14, 2, 38), (104, 30, 1, 30), (150, 8, 2, 46)]):
        c = Calque('n%d' % i, libre=True)
        nuage(c, x, y, s)
        nuages.append(c)
        # ils dérivent vers la gauche et reviennent par la droite : on double le calque
        c2 = decaler(c, W, 0)
        c.coller(c2)
        n = 64
        pas = [(k / n, 'transform:translate(%dpx,0)' % (-round(W * k / n))) for k in range(n + 1)]
        css.append(images_cles('n%d' % i, pas, d))
        css.append(anim('n%d' % i, 'n%d' % i, d))

    # le sol de briques, avec un trou au milieu, et les plateformes
    sol = Calque()
    def briques(cal, x, y, w, h, fri=False):
        cal.rect(x, y, w, h, P['briqueFri'] if fri else P['brique'])
        Bk, Rk = 8, 4
        for jy in range(0, h - 1, Rk):
            cal.rect(x, y + jy + Rk - 1, w, 1, P['joint'])
            dec = Bk // 2 if (jy // Rk) % 2 else 0
            bx = x + dec
            while bx < x + w:
                if bx > x:
                    cal.rect(bx, y + jy, 1, min(Rk - 1, h - jy), P['joint'])
                bx += Bk
        cal.rect(x, y, w, 1, P['briqueFriHaut'] if fri else P['briqueHaut'])
        cal.rect(x, y + h - 1, w, 1, P['briqueFriBas'] if fri else P['briqueBas'])
        cal.rect(x, y, w, 1, P['trait']); cal.rect(x, y + h - 1, w, 1, P['trait'])
        cal.rect(x, y, 1, h, P['trait']); cal.rect(x + w - 1, y, 1, h, P['trait'])
    briques(sol, -1, 128, 82, 17)
    briques(sol, 120, 128, 73, 17)
    # les pics rouges au fond du trou
    for i in range(5):
        x0 = 83 + i * 7
        sol.POLY([x0, 144, x0 + 3.5, 136, x0 + 7, 144], P['trait'])
        sol.POLY([x0 + 1, 144, x0 + 3.5, 138, x0 + 6, 144], P['pic'])
        sol.POLY([x0 + 3.5, 144, x0 + 3.5, 138, x0 + 6, 144], P['picOmbre'])
    # une plateforme en hauteur, et une friable avec ses fissures en diagonale
    briques(sol, 92, 100, 24, 8)
    briques(sol, 40, 106, 20, 8, fri=True)
    for (a, b) in [((46, 107), (48, 112)), ((54, 107), (52, 112))]:
        for s in range(6):
            sol.put(round(a[0] + (b[0] - a[0]) * s / 5), round(a[1] + (b[1] - a[1]) * s / 5), P['trait'])

    # un point de passage, déjà allumé, au début du sol
    px_, py_ = 16, 128
    sol.rect(px_ - 1, py_ - 16, 2, 16, P['trait']); sol.rect(px_, py_ - 15, 1, 15, P['metal'])
    sol.POLY([px_ + 1, py_ - 17, px_ + 9, py_ - 13, px_ + 1, py_ - 9], P['trait'])
    sol.POLY([px_ + 1, py_ - 15.5, px_ + 7, py_ - 13, px_ + 1, py_ - 10.5], P['mat'])
    # l'arrivée : le mât, la boule dorée, le grand fanion vert qui claque
    mat = Calque()
    mx, my = 172, 128
    mat.rect(mx - 1, my - 58, 3, 58, P['trait'])
    mat.rect(mx, my - 57, 1, 57, P['metal'])
    mat.O(mx, my - 60, 3, 3, P['trait']); mat.O(mx, my - 60, 2, 2, P['mat'])
    fanions = []
    for i, flot in enumerate([0, 2, 3, 2]):
        f = Calque('f%d' % i)
        f.POLY([mx + 1, my - 57, mx + 22, my - 50 + flot, mx + 1, my - 42], P['trait'])
        f.POLY([mx + 2, my - 55, mx + 18, my - 50 + flot, mx + 2, my - 44], P['fanion'])
        fanions.append(f)
    for i in range(4):
        pas = [(0, 'opacity:%d' % (1 if i == 0 else 0))]
        for k in range(4):
            pas.append((k / 4, 'opacity:%d' % (1 if k == i else 0)))
        pas.append((1, 'opacity:%d' % (1 if i == 0 else 0)))
        css.append(images_cles('f%d' % i, pas, 0.8))
        css.append(anim('f%d' % i, 'f%d' % i, 0.8))

    # ---- le personnage : il charge son saut, s'envole au-dessus du trou, retombe ----
    def bete(cal, x, y, sx=1.0, sy=1.0, face=1, yeux=1.0):
        w0, h0 = 18, 16
        w, h = round(w0 * sx), round(h0 * sy)
        bx, by = round(x - w / 2), round(y - h)     # (x, y) : le milieu des pieds
        # pieds
        cal.rect(bx + 2, by + h - 1, 4, 3, P['trait']); cal.rect(bx + w - 6, by + h - 1, 4, 3, P['trait'])
        # oreilles pointues : un triangle noir, puis son dedans blanc
        cal.POLY([bx + 1, by + 6, bx + 3, by - 7, bx + 9, by + 2], P['trait'])
        cal.POLY([bx + w - 1, by + 6, bx + w - 3, by - 7, bx + w - 9, by + 2], P['trait'])
        cal.POLY([bx + 3, by + 3, bx + 3.8, by - 3, bx + 7, by + 2], P['corps'])
        cal.POLY([bx + w - 3, by + 3, bx + w - 3.8, by - 3, bx + w - 7, by + 2], P['corps'])
        # corps arrondi, cerné
        cal.rect(bx + 2, by, w - 4, h, P['trait']); cal.rect(bx, by + 2, w, h - 4, P['trait'])
        cal.rect(bx + 1, by + 1, w - 2, h - 2, P['trait'])
        cal.rect(bx + 2, by + 1, w - 4, h - 2, P['corps']); cal.rect(bx + 1, by + 2, w - 2, h - 4, P['corps'])
        cal.rect(bx + (1 if face > 0 else w - 4), by + h // 2, 3, h // 2 - 2, P['corpsOmbre'])
        # yeux et museau
        ox = 1 if face > 0 else -1
        ey = by + round(h * 0.36)
        eh = max(1, round(3 * yeux))
        cal.rect(bx + round(w * 0.28) + ox, ey, 2, eh, P['trait'])
        cal.rect(bx + round(w * 0.64) + ox, ey, 2, eh, P['trait'])
        cal.rect(bx + w // 2 - 2 + ox, by + round(h * 0.66), 4, 1, P['trait'])

    # la trajectoire : départ au bord gauche du trou (x 70), arrivée sur la plateforme (x 104, y 100)
    x0, y0, x1, y1 = 62, 128, 104, 100
    T = 3.2                      # secondes par boucle
    images = []                 # (début, fin, calque) en fractions de la boucle
    def ajout(t0, t1, cal):
        images.append((t0, t1, cal))
    # 0.00-0.28 : il charge (tassement croissant, jauge qui se remplit)
    for k, c in enumerate([0.0, 0.25, 0.5, 0.75, 1.0]):
        cal = Calque()
        bete(cal, x0, y0, sx=1 + c * 0.22, sy=1 - c * 0.3, yeux=1 - c * 0.6)
        L = 18
        jx, jy = x0 - L // 2 - 1, y0 - 27
        cal.rect(jx, jy, L + 2, 4, P['trait'])
        cal.rect(jx + 1, jy + 1, L, 2, '#404040')
        cal.rect(jx + 1, jy + 1, round(L * c), 2, P['mat'] if c > 0.97 else P['corps'])
        ajout(0.28 * k / 5, 0.28 * (k + 1) / 5, cal)
    # 0.28-0.62 : le vol (parabole), étiré à l'envol puis rond
    n = 12
    for k in range(n):
        u = (k + 0.5) / n
        x = x0 + (x1 - x0) * u
        y = y0 + (y1 - y0) * u - 44 * 4 * u * (1 - u)
        e = max(0.0, 1 - u * 2.2)
        cal = Calque()
        bete(cal, x, y, sx=1 - e * 0.16, sy=1 + e * 0.22)
        ajout(0.28 + 0.34 * k / n, 0.28 + 0.34 * (k + 1) / n, cal)
    # 0.62-0.70 : l'atterrissage, écrasé puis rond
    for k, (sx, sy) in enumerate([(1.22, 0.72), (1.1, 0.86), (1.0, 1.0)]):
        cal = Calque()
        bete(cal, x1, y1, sx=sx, sy=sy)
        ajout(0.62 + 0.08 * k / 3, 0.62 + 0.08 * (k + 1) / 3, cal)
    # 0.70-0.86 : il se retourne, content ; 0.86-1 : retour au départ (hors champ, on ne le voit pas : fondu)
    cal = Calque(); bete(cal, x1, y1, face=-1); ajout(0.70, 0.80, cal)
    cal = Calque(); bete(cal, x1, y1, face=1); ajout(0.80, 0.90, cal)
    cal = Calque(); bete(cal, x0, y0); ajout(0.90, 1.0, cal)
    perso = []
    for i, (a, b, cal) in enumerate(images):
        cal.cls = 'p%d' % i
        pas = []
        if a > 0:
            pas.append((0, 'opacity:0'))
        pas.append((a, 'opacity:1'))
        if b < 1:
            pas.append((b, 'opacity:0'))
        pas.append((1, 'opacity:%d' % (1 if a == 0 else 0)))
        css.append(images_cles('p%d' % i, pas, T))
        css.append(anim('p%d' % i, 'p%d' % i, T))
        perso.append(cal)

    # ---- le titre : JUMPER, doré, en relief, et chaque lettre qui sautille ----
    k, esp = 3, 1
    lt = largeur_titre('JUMPER', k, esp)
    tx, ty = (W - lt) // 2, 18
    lettres = []
    cx = tx
    for i, ch in enumerate('JUMPER'):
        m = masque_titre(ch, cx, ty, k, esp)
        c = Calque('l%d' % i)
        logo(c, m, ['#fff4b0', '#f8d038', '#f0b030', '#e89848', '#c06028'], reflet='#ffffff',
             relief=(1, 1, 3, '#803010'), cerne=P['trait'])
        lettres.append(c)
        cx += (len(TITRE[ch][0]) + esp) * k
        # le sautillement : chaque lettre à son tour, un saut de 3 pixels
        pas = [(0, 'transform:translate(0,0)')]
        d0 = 0.06 * i
        for (f, dy) in [(d0, 0), (d0 + 0.03, -2), (d0 + 0.06, -3), (d0 + 0.09, -2), (d0 + 0.12, 0)]:
            pas.append((f, 'transform:translate(0,%dpx)' % dy))
        pas.append((1, 'transform:translate(0,0)'))
        css.append(images_cles('l%d' % i, pas, 2.6))
        css.append(anim('l%d' % i, 'l%d' % i, 2.6))
    # la marque, discrète, sous le titre
    sous = Calque()
    ecrire(sous, 'A FAKEPARADISE GAME', (W - largeur('A FAKEPARADISE GAME')) // 2, ty + 28, '#ffffff', 1, P['trait'])

    calques = [fond] + nuages + [coll, sol, mat] + fanions + perso + lettres + [sous]
    return svg('Jumper', calques, ''.join(css), 'Affiche du mini-jeu Jumper')


if __name__ == '__main__':
    ecrire_fichier('jumper.svg', jumper())
    ecrire_fichier('age-of-seum.svg', seum())
    ecrire_fichier('item-versus.svg', versus())
