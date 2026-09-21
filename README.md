# FakeParadise™

Site vitrine de la marque, dans l'esprit de l'interface XMB de la PlayStation 3 :
barre d'icônes horizontale, listes verticales, panneaux de verre, ruban animé.

**Version de test.** Le paiement n'est pas branché et les mentions légales
contiennent encore des champs à compléter.

## Contenu

| | |
|---|---|
| `index.html` | tout le site : mise en page, scripts, rendu 3D, sons |
| `catalogue.json` | les produits affichés, modifiables sans toucher au code |
| `products/` | photos produit, 800 × 800 |
| `icons/` | icônes du menu et écran de démarrage |
| `fonts/` | Inter, police variable sous licence SIL OFL 1.1 (licence incluse) |

## Particularités

- **Aperçus 3D générés à la volée** : le modèle de chaque vêtement est construit
  dans le navigateur à partir de sa photo, par détourage puis mise en volume.
  Aucun fichier 3D, aucune bibliothèque externe.
- **Sons synthétisés** en Web Audio, sans fichier audio.
- **Ni cookie ni traceur**, et rien qui parte vers un serveur. Le stockage local
  du navigateur tient deux clés, et deux seulement : `fp.debloque` (les épreuves
  passées, sans quoi un rechargement reprendrait une pièce gagnée) et
  `fp.jumper` (le record du mini-jeu). Aucune donnée personnelle, aucun suivi.
  Les deux sont déclarées dans la rubrique Cookies des textes légaux.
- **Aucune dépendance externe** : tout est servi depuis ce dépôt.

Le site doit être servi en `http://` ou `https://`. Ouvert par double-clic
(`file://`), le navigateur interdit la lecture des pixels des photos et les
aperçus 3D laissent place aux photos à plat.
