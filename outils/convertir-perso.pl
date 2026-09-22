#!/usr/bin/perl
# ---------------------------------------------------------------------------
#  convertir-perso.pl — du pack Quaternius au format du site
#
#  Le site ne lit ni glTF ni FBX : il lit des maillages déjà mâchés, en JSON
#  (voir models/accessoires.json, converti une fois de la même façon). Ce
#  script fait la conversion, et il est dans le dépôt pour qu'on puisse la
#  refaire — ajouter un vêtement, changer une couleur, revoir la sélection —
#  sans redemander à personne.
#
#  Il lit « Ultimate Modular Men » (Quaternius, CC0), qui vit hors du dépôt
#  dans 3Dmodels/ parce qu'il pèse 300 Mo, et il écrit models/perso.json.
#
#  CE QU'IL FAIT, ET POURQUOI :
#
#  1. LE SQUELETTE PASSE DE 62 OS À 22. Le pack en a soixante-deux, dont une
#     trentaine pour les doigts : à la taille où le salon dessine une main,
#     une phalange fait un pixel. Chaque os de doigt est donc rendu à son
#     POIGNET — la main garde exactement sa forme de repos, elle ne se plie
#     simplement plus. Rien d'autre n'est touché.
#
#  2. QUATRE INFLUENCES PAR SOMMET, ET PAS MOINS. Mesuré sur le t-shirt :
#     794 sommets sur 1490 dépendent de trois os, 384 de quatre. Se contenter
#     du plus fort déplacerait certains sommets de 69 % de leur course, deux
#     os de 39 %. C'est l'épaule et l'emmanchure qui le demandent.
#
#  3. LES NORMALES NE SONT PAS ÉCRITES. Elles se recalculent au chargement en
#     une passe, et elles pèsent le quart du fichier.
#
#  4. UNE PIÈCE PEUT AVOIR PLUSIEURS COULEURS (une basket blanche à semelle
#     rouge, une tête avec ses yeux et ses sourcils). Les triangles sont donc
#     groupés par couleur, comme dans accessoires.json.
#
#  Usage :  perl outils/convertir-perso.pl        (depuis la racine du dépôt)
# ---------------------------------------------------------------------------
use strict;
use warnings;
use JSON::PP;
use MIME::Base64 qw(decode_base64);

my $PACK = '3Dmodels/Ultimate Modular Men- Feb 2022/Individual Characters/glTF';
my $SORTIE = 'models/perso.json';

# ---- LA SÉLECTION ----------------------------------------------------------
# Une ligne par pièce : le nom qu'elle portera dans le site, le personnage du
# pack où la prendre, le maillage, et les matériaux à garder (dans l'ordre de
# dessin). Tout le reste du pack est ignoré.
my @PIECES = (
  # ---- le corps ----
  # bras, mains et cou. LE TORSE N'EXISTE PAS dans le pack — rien n'est
  # modélisé sous les vêtements —, d'où la règle du site : le personnage porte
  # toujours un haut et un bas (voir la tenue de base).
  { id => 'corps',   perso => 'Casual_2',      maille => 'Casual2_Body', mats => ['Skin'] },

  # ---- les visages ----
  # TROIS, ET PAS ONZE. Relevé sur les onze têtes du pack : Adventurer, Beach,
  # Casual_2, Casual_Hoodie et Suit ont EXACTEMENT le même visage, à 982
  # sommets près ; Farmer et Worker sont ce visage plus une moustache, King ce
  # visage plus une barbe. Ne restent que trois vrais visages, choisis pour
  # leurs yeux et leurs sourcils — et comme les coiffures ne tiennent qu'à l'os
  # de la tête, elles se montent indifféremment sur les trois.
  { id => 'visage1', perso => 'Casual_Hoodie', maille => 'Casual_Head',     mats => ['Skin', 'Eyebrows', 'Eye'] },
  { id => 'visage2', perso => 'Adventurer',    maille => 'Adventurer_Head', mats => ['Skin', 'Eyebrows', 'Eye'] },
  { id => 'visage3', perso => 'King',          maille => 'King_Head',       mats => ['Skin', 'Eye'] },

  # ---- la tenue de base (demandée le 22 sept. 2026) ----
  # Un t-shirt blanc tout bête et un pantalon bleu. Les couleurs du pack ne
  # conviennent pas — son t-shirt est grège et son jean gris ardoise —, on les
  # remplace ici plutôt que dans le site : c'est une propriété de la pièce,
  # pas de son affichage.
  { id => 'tshirt',  perso => 'Casual_2',      maille => 'Casual2_Body', mats => ['LightBrown'], couleurs => ['#f0efe9'] },
  { id => 'jean',    perso => 'Casual_2',      maille => 'Casual2_Legs', mats => ['LightBlue'],  couleurs => ['#3d5a80'] },
  { id => 'baskets', perso => 'Casual_2',      maille => 'Casual2_Feet', mats => ['White', 'Red_Dark'] },
  { id => 'sweat',   perso => 'Casual_Hoodie', maille => 'Casual_Body',  mats => ['Purple'] },

  # ---- les coiffures ----
  # Toutes celles du pack. Plusieurs portent leur barbe dans le même matériau
  # que les cheveux : on ne les sépare pas, c'est une tête entière qui se
  # choisit. La crête et la barbichette du punk, elles, sont un SEUL matériau
  # séparé par un vide franc (rien entre 1,62 et 1,64) : on coupe.
  { id => 'cheveux1', perso => 'Casual_2',      maille => 'Casual2_Head',    mats => ['Hair'] },
  { id => 'cheveux2', perso => 'Casual_Hoodie', maille => 'Casual_Head',     mats => ['Hair'] },
  { id => 'cheveux3', perso => 'Suit',          maille => 'Suit_Head',       mats => ['Hair'] },
  { id => 'cheveux4', perso => 'Beach',         maille => 'Beach_Head',      mats => ['Hair'] },
  { id => 'cheveux5', perso => 'Adventurer',    maille => 'Adventurer_Head', mats => ['Hair'] },       # cheveux et barbe
  { id => 'cheveux6', perso => 'King',          maille => 'King_Head',       mats => ['Hair_White'] }, # cheveux et barbe blanche
  { id => 'crete',    perso => 'Punk',          maille => 'Punk_Head',       mats => ['Red'], sur   => 1.63 },
  { id => 'barbiche', perso => 'Punk',          maille => 'Punk_Head',       mats => ['Red'], sous  => 1.63 },
  { id => 'moustache',perso => 'Worker',        maille => 'Worker_Head',     mats => ['Moustache'] },

  # ---- les accessoires de tête, tous à gagner ----
  { id => 'couronne',  perso => 'King',      maille => 'King_Head',      mats => ['Gold'] },
  { id => 'chapeau',   perso => 'Farmer',    maille => 'Farmer_Head',    mats => ['Beige', 'Red'] },
  { id => 'chantier',  perso => 'Worker',    maille => 'Worker_Head',    mats => ['Worker_Yellow'] },
  # Ces deux-là sont des casques FERMÉS : ils remplacent le visage, ils ne se
  # posent pas dessus. Le site devra donc cacher la tête quand on les porte.
  { id => 'swat',      perso => 'Swat',      maille => 'Swat_Head',      mats => ['Swat_Black', 'Swat', 'Visor'] },
  { id => 'spatial',   perso => 'Spacesuit', maille => 'SpaceSuit_Head', mats => ['SciFi_Light', 'SciFi_Light_Accent', 'Grey'] },
);

# ---- lecture d'un glTF -----------------------------------------------------
my %cache;
sub gltf {
  my ($nom) = @_;
  return $cache{$nom} if $cache{$nom};
  my $chemin = "$PACK/$nom.gltf";
  open(my $fh, '<:raw', $chemin) or die "ouvre $chemin : $!";
  local $/; my $txt = <$fh>; close $fh;
  my $g = JSON::PP->new->decode($txt);
  my $uri = $g->{buffers}[0]{uri} or die "$nom : pas de tampon";
  $uri =~ s/^data:[^,]*,// or die "$nom : tampon externe, non géré";
  $g->{__bin} = decode_base64($uri);
  return $cache{$nom} = $g;
}

# ---- lecture d'un accesseur ------------------------------------------------
my %PACKE = (5120 => ['c', 1], 5121 => ['C', 1], 5122 => ['s<', 2], 5123 => ['v', 2], 5125 => ['V', 4], 5126 => ['f<', 4]);
my %COMP  = (SCALAR => 1, VEC2 => 2, VEC3 => 3, VEC4 => 4, MAT4 => 16);
sub lire {
  my ($g, $i) = @_;
  my $a = $g->{accessors}[$i];
  my $v = $g->{bufferViews}[$a->{bufferView}];
  die "entrelacé, non géré" if ($v->{byteStride} || 0);
  my ($code, $taille) = @{ $PACKE{ $a->{componentType} } or die "type $a->{componentType}" };
  my $n = $a->{count} * $COMP{ $a->{type} };
  my $off = ($v->{byteOffset} || 0) + ($a->{byteOffset} || 0);
  return [ unpack("$code$n", substr($g->{__bin}, $off, $n * $taille)) ];
}

# ---- la couleur d'un matériau, en sRGB -------------------------------------
sub couleur {
  my ($g, $i) = @_;
  my $c = $g->{materials}[$i]{pbrMetallicRoughness}{baseColorFactor} || [0.8, 0.8, 0.8, 1];
  return sprintf('#%02x%02x%02x', map { my $v = $_ ** (1 / 2.2); int(255 * ($v > 1 ? 1 : $v) + 0.5) } @$c[0 .. 2]);
}

# ---- LE SQUELETTE ----------------------------------------------------------
# Pris sur le premier personnage : il est le même partout (vérifié sur six
# tenues, noms et ordre identiques).
my $ref = gltf($PIECES[0]{perso});
my $skin = $ref->{skins}[0] or die 'pas de peau';
my @joints = @{ $skin->{joints} };
my @noms = map { $ref->{nodes}[$_]{name} } @joints;
my $ibm = lire($ref, $skin->{inverseBindMatrices});

# parent de chaque noeud
my %parent;
for my $i (0 .. $#{ $ref->{nodes} }) {
  for my $c (@{ $ref->{nodes}[$i]{children} || [] }) { $parent{$c} = $i; }
}
# index dans la liste des joints
my %rang; $rang{ $joints[$_] } = $_ for 0 .. $#joints;

# un os de doigt ? on le rend à son poignet (voir l'en-tête)
my $DOIGT = qr/^(Index|Middle|Ring|Pinky|Thumb)\d/;
my @garde = grep { $noms[$_] !~ $DOIGT } 0 .. $#noms;
my %vers;                      # ancien rang -> nouveau rang
my $k = 0;
$vers{$_} = $k++ for @garde;
for my $i (0 .. $#noms) {
  next if exists $vers{$i};
  my $n = $joints[$i];         # remonter jusqu'au premier ancêtre gardé
  $n = $parent{$n} while defined $n && !(defined $rang{$n} && exists $vers{ $rang{$n} });
  die "doigt orphelin : $noms[$i]" unless defined $n;
  $vers{$i} = $vers{ $rang{$n} };
}

my @os;
for my $i (@garde) {
  my $nd = $ref->{nodes}[ $joints[$i] ];
  my $p  = $parent{ $joints[$i] };
  my $pr = (defined $p && defined $rang{$p}) ? $vers{ $rang{$p} } : -1;
  push @os, {
    n => $noms[$i],
    p => $pr,
    t => [ map { 0 + sprintf('%.5f', $_) } @{ $nd->{translation} || [0, 0, 0] } ],
    r => [ map { 0 + sprintf('%.6f', $_) } @{ $nd->{rotation}    || [0, 0, 0, 1] } ],
    s => [ map { 0 + sprintf('%.5f', $_) } @{ $nd->{scale}       || [1, 1, 1] } ],
    m => [ map { 0 + sprintf('%.6f', $_) } @{$ibm}[ $i * 16 .. $i * 16 + 15 ] ],
  };
}
printf "squelette : %d os sur %d (les doigts sont rendus aux poignets)\n", scalar(@os), scalar(@noms);

# ---- LES PIÈCES ------------------------------------------------------------
my %sortie;
for my $P (@PIECES) {
  my $g = gltf($P->{perso});
  # retrouver le maillage par le nom de son noeud
  my ($mi) = grep { defined $g->{nodes}[$_]{mesh} && $g->{nodes}[$_]{name} eq $P->{maille} } 0 .. $#{ $g->{nodes} };
  die "$P->{id} : maillage $P->{maille} introuvable" unless defined $mi;
  my $maille = $g->{meshes}[ $g->{nodes}[$mi]{mesh} ];

  my (@xyz, @jj, @ww, @tri, @groupes);
  my %osPiece; my @osPiece;    # les os que cette pièce utilise vraiment
  for my $mat (@{ $P->{mats} }) {
    my ($pr) = grep { $g->{materials}[ $_->{material} ]{name} eq $mat } @{ $maille->{primitives} };
    die "$P->{id} : matériau $mat introuvable" unless $pr;
    my $pos = lire($g, $pr->{attributes}{POSITION});
    my $jo  = lire($g, $pr->{attributes}{JOINTS_0});
    my $we  = lire($g, $pr->{attributes}{WEIGHTS_0});
    my $idx = lire($g, $pr->{indices});

    # COUPER À UNE HAUTEUR : deux morceaux d'un même matériau qui n'ont rien à
    # voir (la crête du punk et sa barbichette). On garde les triangles dont le
    # milieu est du bon côté, puis on ne recopie que les sommets qui restent.
    if (defined $P->{sur} || defined $P->{sous}) {
      my (@garde, %vu, @neuf);
      for (my $t = 0; $t < @$idx; $t += 3) {
        my $y = ($pos->[$idx->[$t] * 3 + 1] + $pos->[$idx->[$t+1] * 3 + 1] + $pos->[$idx->[$t+2] * 3 + 1]) / 3;
        next if defined $P->{sur}  && $y < $P->{sur};
        next if defined $P->{sous} && $y > $P->{sous};
        push @garde, @{$idx}[$t .. $t+2];
      }
      for my $i (@garde) { next if exists $vu{$i}; $vu{$i} = scalar(@neuf); push @neuf, $i; }
      my (@p2, @j2, @w2);
      for my $i (@neuf) {
        push @p2, @{$pos}[ $i*3 .. $i*3+2 ];
        push @j2, @{$jo} [ $i*4 .. $i*4+3 ];
        push @w2, @{$we} [ $i*4 .. $i*4+3 ];
      }
      ($pos, $jo, $we, $idx) = (\@p2, \@j2, \@w2, [ map { $vu{$_} } @garde ]);
    }
    my $base = @xyz / 3;
    my $debut = @tri;

    for my $v (0 .. @$pos / 3 - 1) {
      # TROIS DÉCIMALES, c'est-à-dire le millimètre : invisible sur un
      # personnage d'un mètre quatre-vingts, et un bon quart du fichier en moins.
      push @xyz, map { 0 + sprintf('%.3f', $pos->[$v * 3 + $_]) } 0 .. 2;
      # quatre influences, ramenées aux os gardés puis renormalisées
      my %w;
      for my $c (0 .. 3) {
        my $p = $we->[$v * 4 + $c] or next;
        my $o = $vers{ $jo->[$v * 4 + $c] };
        $w{$o} += $p;
      }
      my @o = sort { $w{$b} <=> $w{$a} } keys %w;
      @o = @o[0 .. 3] if @o > 4;
      my $s = 0; $s += $w{$_} for @o;
      $s ||= 1;
      for my $c (0 .. 3) {
        my $o = $c < @o ? $o[$c] : $o[0];
        $osPiece{$o} //= do { push @osPiece, $o; $#osPiece };
        push @jj, $osPiece{$o};
        push @ww, $c < @o ? int(255 * $w{$o} / $s + 0.5) : 0;
      }
      # l'arrondi doit retomber sur 255 pile : le reste va au plus fort
      my $t = 0; $t += $ww[-4 + $_] for 0 .. 3;
      $ww[-4] += 255 - $t;
    }
    push @tri, map { $_ + $base } @$idx;
    my $col = $P->{couleurs} && $P->{couleurs}[ scalar(@groupes) ];
    # LE RÔLE, quatrième valeur du groupe : la peau doit pouvoir changer de
    # teinte sans toucher au reste (voir le rayon « peau » de la penderie).
    # Il se lit sur le nom du matériau du pack, on ne le déclare nulle part.
    my $role = $mat eq 'Skin' ? 'peau' : $mat eq 'Skin_Darker' ? 'peau2' : undef;
    push @groupes, [ $debut, scalar(@tri) - $debut, $col || couleur($g, $pr->{material}), $role ];
  }
  # UN SEUL OS : on n'écrit ni les index ni les poids. Une coiffure, un
  # chapeau, un casque ne tiennent qu'à l'os de la tête — quatre index et
  # quatre poids par sommet, tous identiques, pesaient la moitié du fichier
  # pour ne rien dire. Le site le lit : pas de `j`, tout tient au premier os.
  my $piece = { os => \@osPiece, xyz => \@xyz, tri => \@tri, groupes => \@groupes };
  if (@osPiece > 1) { $piece->{j} = \@jj; $piece->{w} = \@ww; }
  $sortie{ $P->{id} } = $piece;
  printf "%-10s %5d sommets  %5d triangles  %2d os%s  %s\n",
    $P->{id}, scalar(@xyz) / 3, scalar(@tri) / 3, scalar(@osPiece),
    (@osPiece > 1 ? '' : ' (sans poids)'), join(' ', map { $_->[2] } @groupes);
}

# ---- écriture --------------------------------------------------------------
my $doc = {
  _ => "Personnage du salon, converti une fois depuis le pack « Ultimate Modular Men » (Quaternius, CC0) par outils/convertir-perso.pl. Reperes : metres, Y en haut, +Z devant, pieds a y=0, pose de liaison en T. os : n nom, p parent (-1 = racine), t/r/s la transformation locale de repos (translation, quaternion, echelle), m la matrice inverse de liaison. pieces : os = les os utilises, xyz = positions, j = 4 index dans cette liste par sommet, w = 4 poids sur 255, tri = triangles, groupes = [premier index, nombre, couleur]. Les normales ne sont pas ecrites : elles se recalculent au chargement.",
  os => \@os,
  pieces => \%sortie,
};
my $json = JSON::PP->new->canonical->encode($doc);
open(my $o, '>:raw', $SORTIE) or die "ecrire $SORTIE : $!";
print $o $json; close $o;
printf "\n%s : %.0f Ko\n", $SORTIE, length($json) / 1024;
