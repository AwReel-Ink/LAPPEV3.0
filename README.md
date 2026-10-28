# LAPPEV 3.0.x1

Guides visuels de chantiers d'espaces verts pour les moniteurs d'atelier.
Application web installable (PWA), hébergée sur GitHub Pages : https://awreel-ink.github.io/LAPPEV3.0/

## Mettre en ligne une nouvelle version

1. Remplacer les fichiers du dépôt par ceux de ce dossier (garder la même arborescence).
2. Dans `version.js`, changer `LAPPEV_BUILD` (ex. `20261028b`). C'est ce qui déclenche la mise à jour sur les appareils.
3. Pousser sur GitHub. Au prochain lancement, l'appli se met à jour et propose « Recharger ».

## Organisation des fichiers

| Fichier | Rôle |
| --- | --- |
| `index.html` | Coquille de l'application |
| `version.js` | Numéro de version (seul endroit à modifier) |
| `sw.js` | Service worker : réseau d'abord, cache en secours hors ligne |
| `css/app.css` | Styles, interfaces PC (`ui-pc`) et tablette/smartphone (`ui-mobile`) |
| `js/app.js` | Démarrage, navigation, mises à jour |
| `js/db.js` | Stockage IndexedDB (base `lappev31`) et stockage persistant |
| `js/model.js` | Modèle de données, catalogue d'interventions et de matériel par défaut |
| `js/geo.js` | Carte IGN : tuiles, recherche d'adresse, capture géoréférencée |
| `js/viewport.js` | Zoom / déplacement souris et tactile, barre d'échelle |
| `js/uimode.js` | Bascule PC / Tablette-Smartphone |
| `js/symbols.js` | Symboles simples des interventions (écran et impression) |
| `js/render.js` | Géométrie et dessin des zones, marqueurs et mesures |
| `js/editkit.js` | Tracé et modification des formes, annulation (200 actions) |
| `js/exchange.js` | Fichier unique : export, import, doublons, fusion, copie de sécurité |
| `js/print.js` | Fiche moniteur et fiche travailleurs (A4 paysage) |
| `js/screens/*.js` | Écrans : bibliothèque, fiche client, carte, zones, lecture, métré, interventions, partage, réglages, aide |

## Données

- Tout est stocké dans le navigateur de chaque appareil (IndexedDB), même hors ligne.
- Cartographie : © IGN – Géoplateforme, Licence Ouverte (orthophotographies et Plan IGN).

## Avancement

- [x] Étape 1 — Socle (stockage, bibliothèque, interfaces, mises à jour)
- [x] Étape 2 — Carte IGN, capture, vues, photos de repérage
- [x] Étape 3 — Interventions et zones
- [x] Étape 4 — Lecture sur chantier
- [x] Étape 5 — Métré
- [x] Étape 6 — Fichier unique, partage, fusion
- [x] Étape 7 — Impressions
