// LAPPEV — Mode d'emploi
import { h } from '../util.js';

export function helpScreen() {
    const section = (title, ...content) => h('section', { class: 'card help-card' }, h('h2', null, title), ...content);
    const list = items => h('ul', null, items.map(i => h('li', null, i)));

    const el = h('div', { class: 'page narrow help' },
        h('h1', { class: 'page-title' }, "Mode d'emploi"),
        h('p', { class: 'page-sub' }, `LAPPEV ${self.LAPPEV_VERSION} — guides visuels de chantiers d’espaces verts.`),

        section('En bref',
            h('ol', null,
                h('li', null, 'Créer le client (nom, adresse).'),
                h('li', null, 'Capturer la vue satellite IGN du chantier (internet requis).'),
                h('li', null, 'Dessiner les zones de chaque intervention, placer parkings et entrées.'),
                h('li', null, 'Préparer le matériel du chantier.'),
                h('li', null, 'Sur place : mode Lecture, hors ligne.'),
                h('li', null, 'Imprimer la fiche des travailleurs, partager le fichier avec les collègues.'))),

        section('1. Clients',
            list([
                'Écran « Clients » → « + Nouveau client ». La fiche (téléphone, email, code d’accès, notes) s’enregistre toute seule.',
                'Le menu « ⋯ » d’un client : lecture, impression, nouvelle vue, dupliquer, supprimer.',
                'Onglet « Photos de repérage » : ajoutez une capture Street View de la porte ou du portail, avec une légende.'
            ])),

        section('2. Vue satellite (internet requis)',
            list([
                'Onglet « Vues » → « Nouvelle vue satellite ». La carte s’ouvre sur l’adresse du client.',
                'Zoomez sur le chantier, touchez « Tracer », puis faites glisser pour dessiner le rectangle.',
                'Ajustez avec les poignées (coins) et la poignée rouge du centre, puis « Capturer ».',
                'L’image est enregistrée en haute définition (environ 20 cm par pixel) avec son échelle : elle se consulte ensuite hors ligne.',
                '« Recadrer » refait la capture : les zones déjà dessinées sont repositionnées automatiquement.'
            ]),
            h('p', { class: 'hint' }, 'Au-delà d’environ 800 × 800 m, la résolution est réduite : découpez en plusieurs vues.')),

        section('3. Interventions',
            list([
                'Menu « Interventions » : Tonte, Débroussaillage, Taille de haie, Désherbage manuel, Désherbage thermique, Élagage… et les vôtres.',
                'Chaque intervention a une couleur (palette fixe de 12 couleurs bien distinctes), un symbole simple et du matériel suggéré.',
                'Les combos (ex. « Tonte + Débroussaillage ») sélectionnent plusieurs interventions d’un coup en lecture et à l’impression.',
                'Section « Matériel » : ajoutez vos propres outils.'
            ])),

        section('4. Dessiner les zones',
            list([
                'Fiche client → onglet « Interventions & matériel » → « Dessiner les zones » (ou ouvrez une vue).',
                'Choisissez l’intervention dans la liste, puis « Dessiner » : posez les points un par un.',
                'Pour fermer : touchez le premier point, double-cliquez, appuyez sur Entrée ou « Terminer ».',
                'Touchez une zone pour la sélectionner : changer d’intervention, supprimer, modifier ses points.',
                'Modifier : faites glisser un point · poignée du milieu d’un côté = nouveau point · clic droit (PC) ou « Suppr. point » = supprimer un point.',
                '🅿️ Parking (plusieurs possibles, avec une note) et 🚪 Entrée se placent d’un simple toucher.',
                'Les zones sont numérotées par intervention : Tonte 1, 2, 3… Taille 1, 2…',
                '↩️ ou Ctrl+Z : annuler (jusqu’à 200 actions).'
            ])),

        section('5. Matériel du chantier',
            h('p', null, 'Onglet « Interventions & matériel » : indiquez les quantités habituelles pour ce client, intervention par intervention (par exemple pour 12 travailleurs : 6 débroussailleuses, 4 tondeuses mulching, 2 ramasseuses). Les outils suggérés apparaissent d’office ; « + Ajouter un outil » pour les autres.')),

        section('6. Lecture sur chantier (hors ligne)',
            list([
                'Cochez les interventions du jour (ou un combo) : seules leurs zones s’affichent.',
                'Mode « Déplacer / cocher » : touchez une zone pour la marquer faite.',
                'Mode « Colorier » : peignez ce qui a été fait si la zone n’est pas finie ; le pourcentage se calcule tout seul. « Gomme » pour corriger.',
                'L’avancement reste sur l’appareil (il n’est pas exporté). « Réinitialiser » le remet à zéro.',
                '« Partager l’avancement » crée une image à envoyer au collègue qui termine le chantier.',
                '🧭 « Itinéraire » ouvre Waze, Google Maps ou Plans vers le parking choisi. 📞 appelle le client.'
            ])),

        section('7. Métré',
            list([
                'Fiche client → « Métré ». Créez une mesure (ex. « Pelouse principale ») puis tracez des surfaces ou des lignes.',
                '« Retirer une partie » enlève un massif ou un bâtiment d’une surface.',
                'Les surfaces (m²) et longueurs (m) se calculent pendant le tracé ; le récapitulatif donne les totaux.',
                '« Exporter en image » : la vue et le tableau, prêts à envoyer pour un devis.'
            ])),

        section('8. Impression',
            list([
                'Fiche client → « Imprimer » : choisissez les interventions (ou un combo).',
                'Fiche moniteur : une page par vue avec les infos client, la légende numérotée, les photos, puis la page matériel.',
                'Fiche travailleurs (A4 paysage) : une page par intervention, en couleur, avec numéros en grand, cases à cocher et photo de repérage, sans coordonnées du client.',
                'Astuce : « Enregistrer en PDF » dans la fenêtre d’impression.'
            ])),

        section('9. Partage entre collègues',
            list([
                'Menu « Partage » → « Préparer le fichier » : toute la bibliothèque dans un seul fichier (LAPPEV-23clients-28-10-2026.json).',
                '« Partager » ouvre le menu de l’appareil (Quick Share…). Sinon « Télécharger » puis PairDrop (pairdrop.net), clé USB…',
                'Le collègue choisit le fichier dans « Recevoir » puis « Fusionner » : les doublons (même fiche, même adresse, nom proche, chantiers à moins de 30 m) sont présentés un par un.',
                'Une copie de sécurité est faite avant chaque fusion : « Annuler la dernière fusion » si besoin.',
                'Un rappel propose d’exporter régulièrement (délai réglable dans Réglages).'
            ])),

        section('10. PC ou tablette / smartphone',
            list([
                'Le bouton en haut à droite bascule entre l’interface PC et l’interface tactile ; le choix est mémorisé sur chaque appareil.',
                'PC : molette = zoom, glisser = déplacer, raccourcis Ctrl+Z, Entrée, Échap, Suppr.',
                'Tactile : un doigt = déplacer, deux doigts = zoomer.'
            ])),

        section('11. Données et mises à jour',
            list([
                'Tout est enregistré dans le navigateur de chaque appareil, même hors ligne. Installez l’appli sur l’écran d’accueil pour protéger les données.',
                'Les mises à jour arrivent toutes seules : un bandeau propose « Recharger ».',
                'Cartographie : © IGN – Géoplateforme, Licence Ouverte.'
            ]))
    );
    return { el };
}
