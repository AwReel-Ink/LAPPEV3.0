// LAPPEV — modèle de données, catalogue par défaut, réglages locaux.
import { db, requestPersistence } from './db.js';
import { uuid } from './util.js';

export const FORMAT_VERSION = 1;

// ------------------------------------------------------------
// Palette fixe : 12 couleurs bien distinctes, à l'écran comme à l'impression
// ------------------------------------------------------------
export const PALETTE = [
    { id: 'vert', name: 'Vert', hex: '#43A047' },
    { id: 'violet', name: 'Violet', hex: '#8E24AA' },
    { id: 'cyan', name: 'Cyan', hex: '#00ACC1' },
    { id: 'rouge', name: 'Rouge', hex: '#E53935' },
    { id: 'orange', name: 'Orange', hex: '#FB8C00' },
    { id: 'marron', name: 'Marron', hex: '#795548' },
    { id: 'bleu', name: 'Bleu', hex: '#1E88E5' },
    { id: 'jaune', name: 'Jaune', hex: '#FDD835' },
    { id: 'rose', name: 'Rose', hex: '#EC407A' },
    { id: 'lime', name: 'Vert clair', hex: '#C0CA33' },
    { id: 'indigo', name: 'Indigo', hex: '#3949AB' },
    { id: 'gris', name: 'Gris', hex: '#607D8B' }
];

// Symboles simples (dessinés par l'appli à l'étape 3)
export const SYMBOLS = ['aucun', 'rond', 'carre', 'triangle', 'losange', 'etoile', 'goutte', 'feuille', 'flamme', 'ciseaux', 'arbre', 'main', 'vague', 'lettre'];

// ------------------------------------------------------------
// Matériel par défaut (liste V3 + tondeuse ramasseuse + élagueuse)
// Identifiants fixes : indispensables pour fusionner les fichiers entre collègues.
// ------------------------------------------------------------
export const TOOL_CATEGORIES = [
    { id: 'machines', label: 'Machines principales' },
    { id: 'nettoyage', label: 'Nettoyage / Manutention' },
    { id: 'consommables', label: 'Consommables / Transport' },
    { id: 'petit', label: 'Petit outillage' },
    { id: 'plantation', label: 'Plantation / Sol' },
    { id: 'bois', label: 'Tronçonneuse / Bois' },
    { id: 'perso', label: 'Matériel ajouté' }
];

const T = (id, name, cat, motorise = false) => ({ id, name, cat, motorise, custom: false });

export const DEFAULT_TOOLS = [
    T('tondeuse-autoportee', 'Tondeuse autoportée (tracteur)', 'machines', true),
    T('tondeuse-autotractee', 'Tondeuse autotractée', 'machines', true),
    T('tondeuse-mulching', 'Tondeuse mulching', 'machines', true),
    T('tondeuse-ramasseuse', 'Tondeuse ramasseuse', 'machines', true),
    T('tondeuse-electrique', 'Tondeuse électrique', 'machines', true),
    T('debroussailleuse-thermique', 'Débroussailleuse thermique', 'machines', true),
    T('debroussailleuse-electrique', 'Débroussailleuse électrique', 'machines', true),
    T('souffleur-thermique', 'Souffleur thermique', 'machines', true),
    T('souffleur-electrique', 'Souffleur électrique', 'machines', true),
    T('taille-haie-thermique', 'Taille-haie thermique', 'machines', true),
    T('taille-haie-electrique', 'Taille-haie électrique', 'machines', true),
    T('taille-haie-perche', 'Taille-haie sur perche', 'machines', true),
    T('desherbeur-thermique', 'Désherbeur thermique', 'machines', true),

    T('balai-cantonnier', 'Balai cantonnier', 'nettoyage'),
    T('balai-gazon', 'Balai à gazon', 'nettoyage'),
    T('pelle', 'Pelle', 'nettoyage'),
    T('fourche', 'Fourche', 'nettoyage'),
    T('fourche-cailloux', 'Fourche à cailloux', 'nettoyage'),
    T('bac-dechets', 'Bac à déchets verts', 'nettoyage'),

    T('fil-debroussailleuse', 'Fil de débroussailleuse', 'consommables'),
    T('harnais', 'Harnais débroussailleuse', 'consommables'),
    T('lame-desherbage', 'Lame (désherbage)', 'consommables'),
    T('bidon-essence', "Bidon d'essence", 'consommables'),
    T('jerrican-2t', 'Jerrican mixte 2T', 'consommables'),
    T('remorque', 'Remorque', 'consommables'),
    T('bache', 'Bâche', 'consommables'),
    T('corde-sangle', 'Corde / Sangle', 'consommables'),
    T('panneau', 'Panneau de signalisation', 'consommables'),

    T('secateur', 'Sécateur', 'petit'),
    T('ebrancheur', 'Sécateur de force (ébrancheur)', 'petit'),
    T('couteau-desherbeur', 'Couteau désherbeur', 'petit'),
    T('escabeau', 'Escabeau / Échelle', 'petit'),

    T('beche', 'Bêche', 'plantation'),
    T('fourche-beche', 'Fourche-bêche', 'plantation'),
    T('transplantoir', 'Transplantoir', 'plantation'),
    T('plantoir', 'Plantoir', 'plantation'),
    T('griffe', 'Griffe de jardin', 'plantation'),
    T('motobineuse', 'Motobineuse', 'plantation', true),
    T('rouleau-gazon', 'Rouleau à gazon', 'plantation'),
    T('epandeur', 'Épandeur', 'plantation'),

    T('tronconneuse', 'Tronçonneuse', 'bois', true),
    T('elagueuse-perche', 'Élagueuse sur perche', 'bois', true),
    T('broyeur', 'Broyeur de végétaux', 'bois', true),
    T('fendeuse', 'Fendeuse de bûches', 'bois', true),
    T('merlin', 'Merlin', 'bois'),
    T('hache', 'Hache', 'bois')
];

// ------------------------------------------------------------
// Interventions par défaut (identifiants fixes, voir plus haut)
// "tools" = outils suggérés, sans quantités : les quantités se règlent par chantier.
// ------------------------------------------------------------
export const DEFAULT_INTERVENTIONS = [
    { id: 'tonte', name: 'Tonte', color: '#43A047', symbol: 'feuille', order: 1,
      tools: ['tondeuse-autoportee', 'tondeuse-autotractee', 'tondeuse-mulching', 'tondeuse-ramasseuse', 'souffleur-thermique', 'bidon-essence'] },
    { id: 'debroussaillage', name: 'Débroussaillage', color: '#8E24AA', symbol: 'triangle', order: 2,
      tools: ['debroussailleuse-thermique', 'fil-debroussailleuse', 'harnais', 'jerrican-2t'] },
    { id: 'taille-haie', name: 'Taille de haie', color: '#00ACC1', symbol: 'ciseaux', order: 3,
      tools: ['taille-haie-thermique', 'taille-haie-perche', 'escabeau', 'bache', 'balai-gazon', 'bac-dechets'] },
    { id: 'desherbage-manuel', name: 'Désherbage manuel', color: '#E53935', symbol: 'main', order: 4,
      tools: ['couteau-desherbeur', 'griffe', 'bac-dechets', 'balai-cantonnier'] },
    { id: 'desherbage-thermique', name: 'Désherbage thermique', color: '#FB8C00', symbol: 'flamme', order: 5,
      tools: ['desherbeur-thermique', 'balai-cantonnier'] },
    { id: 'elagage', name: 'Élagage', color: '#795548', symbol: 'arbre', order: 6,
      tools: ['tronconneuse', 'elagueuse-perche', 'ebrancheur', 'escabeau', 'corde-sangle', 'broyeur', 'panneau'] }
];

export async function getCatalog() {
    let c = await db.getMeta('catalog');
    if (!c) {
        c = {
            formatVersion: FORMAT_VERSION,
            interventions: structuredClone(DEFAULT_INTERVENTIONS),
            combos: [],
            tools: structuredClone(DEFAULT_TOOLS),
            updatedAt: Date.now()
        };
        await db.setMeta('catalog', c);
    }
    return c;
}

export async function saveCatalog(c) {
    c.updatedAt = Date.now();
    await db.setMeta('catalog', c);
}

// ------------------------------------------------------------
// Clients
// ------------------------------------------------------------
export function newClient({ name, address = '', city = '' }) {
    const now = Date.now();
    return {
        id: uuid(),
        createdAt: now,
        updatedAt: now,
        name: name.trim(),
        phone: '',
        email: '',
        address: address.trim(),
        city: city.trim(),
        accessCode: '',
        notes: '',
        location: null,     // { lat, lng } du chantier, définie à la première capture
        views: [],          // { id, name, source:'ign'|'import', image:Blob, width, height, geo, capturedAt, zones:[] }
        photos: [],         // { id, image:Blob, caption, addedAt }
        materials: {},      // { [interventionId]: { [toolId]: quantité } }
        measures: []        // métré (étape 5) : { id, viewId, name, color, note, shapes:[] }
    };
}

export async function saveClient(client) {
    client.updatedAt = Date.now();
    await db.putClient(client);
}

export async function createClient(fields) {
    const c = newClient(fields);
    await db.putClient(c);
    requestPersistence(); // demande discrète de stockage persistant
    return c;
}

export function duplicateClient(src) {
    const d = structuredClone(src);
    const now = Date.now();
    d.id = uuid();
    d.createdAt = now;
    d.updatedAt = now;
    d.name = `${src.name} (copie)`;
    const viewIds = {};
    for (const v of d.views) {
        const nid = uuid();
        viewIds[v.id] = nid;
        v.id = nid;
        for (const z of v.zones || []) z.id = uuid();
    }
    for (const p of d.photos) p.id = uuid();
    for (const m of d.measures || []) { m.id = uuid(); m.viewId = viewIds[m.viewId] || m.viewId; }
    return d;
}

// ------------------------------------------------------------
// Réglages propres à l'appareil (jamais exportés)
// ------------------------------------------------------------
export const local = {
    get(key, def) {
        try {
            const v = localStorage.getItem(`lappev31.${key}`);
            return v == null ? def : JSON.parse(v);
        } catch { return def; }
    },
    set(key, value) {
        try { localStorage.setItem(`lappev31.${key}`, JSON.stringify(value)); } catch { /* stockage indisponible */ }
    }
};
