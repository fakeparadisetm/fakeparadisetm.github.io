# FakeParadise™

Site vitrine de la marque, dans l'esprit de l'interface XMB de la PlayStation 3 :
barre d'icônes horizontale, listes verticales, panneaux de verre, ruban animé.

**Version de test.** Le paiement n'est pas branché et les mentions légales
contiennent encore des champs à compléter.

## Contenu

| | |
|---|---|
| `index.html` | tout le site : mise en page, scripts, rendu 3D, sons |
| `atelier.js` | l'atelier du personnage (le créateur du profil) : son moteur 3D, le personnage, sa garde-robe, la plage — chargé seulement quand on va sur le profil |
| `catalogue.json` | les produits affichés, modifiables sans toucher au code |
| `products/` | photos produit, 800 × 800 |
| `icons/` | icônes du menu et écran de démarrage |
| `affiches/` | les affiches animées des mini-jeux, en SVG (refaites par `outils/affiches.py`) |
| `models/` | les modèles convertis une fois : les lunettes et la cigarette de l'atelier (`accessoires.json`) ; `perso.json`, le mannequin du salon d'avant, ne sert plus |
| `fonts/` | Inter, police variable sous licence SIL OFL 1.1 (licence incluse) |

## Particularités

- **Aperçus 3D générés à la volée** : le modèle de chaque vêtement est construit
  dans le navigateur à partir de sa photo, par détourage puis mise en volume.
  Aucun fichier 3D, aucune bibliothèque externe.
- **Le personnage du profil est taillé par le script** : homme ou femme, sa
  silhouette, son visage, sa coupe et ses vêtements sont des fonctions de ses
  réglages, et il s'anime (attitudes, respiration, regard). Les t-shirts et
  hoodies de la boutique s'y portent, leur photo projetée sur le vêtement.
- **Sons synthétisés** en Web Audio, sans fichier audio.
- **Ni cookie ni traceur**, et rien qui parte vers un serveur. Le stockage local
  du navigateur tient cinq clés, toutes déclarées dans la rubrique Cookies des
  textes légaux : `fp.debloque` (les épreuves passées, sans quoi un rechargement
  reprendrait une pièce gagnée), `fp.jumper` (le record du mini-jeu),
  `fp.reglages` (langue, devise, musique, bruitages), `fp.profil` (le compte
  local : gamertag, photo, dépense et statistiques de visite) et `fp.tenue` (le
  personnage de l'atelier). Rien ne quitte l'appareil ; le profil est
  un compte LOCAL, en attendant un vrai compte client avec la boutique.
- **Aucune dépendance externe** : tout est servi depuis ce dépôt.

Le site doit être servi en `http://` ou `https://`. Ouvert par double-clic
(`file://`), le navigateur interdit la lecture des pixels des photos et les
aperçus 3D laissent place aux photos à plat.
