// LAPPEV 3.0.x1 — point d'entrée : navigation, en-tête, mises à jour
import { h, $, toast, releaseBlobUrls } from './util.js';
import { getCatalog, local } from './model.js';
import { requestPersistence, db } from './db.js';
import { getUiMode, applyUiMode, setUiMode } from './uimode.js';
import { libraryScreen } from './screens/library.js';
import { clientScreen } from './screens/client.js';
import { editorScreen } from './screens/editor.js';
import { readingScreen } from './screens/reading.js';
import { metreScreen } from './screens/metre.js';
import { interventionsScreen } from './screens/interventions.js';
import { shareScreen } from './screens/share.js';
import { mapScreen } from './screens/map.js';
import { settingsScreen } from './screens/settings.js';
import { helpScreen } from './screens/help.js';

const NAV = [
    { id: 'clients', label: 'Clients', icon: '📋', href: '#/clients' },
    { id: 'interventions', label: 'Interventions', icon: '🎨', href: '#/interventions' },
    { id: 'partage', label: 'Partage', icon: '🔄', href: '#/partage' },
    { id: 'reglages', label: 'Réglages', icon: '⚙️', href: '#/reglages' },
    { id: 'aide', label: 'Aide', icon: '❓', href: '#/aide' }
];

const ROUTES = [
    { re: /^#?\/?(clients)?$/, nav: 'clients', screen: () => libraryScreen() },
    { re: /^#\/client\/([^/]+)\/vue\/([^/]+)$/, nav: 'clients', full: true, screen: m => editorScreen({ clientId: m[1], viewId: m[2] }) },
    { re: /^#\/client\/([^/]+)\/lecture$/, nav: 'clients', full: true, screen: (m, q) => readingScreen({ clientId: m[1], viewId: q.get('vue') }) },
    { re: /^#\/client\/([^/]+)\/metre$/, nav: 'clients', full: true, screen: (m, q) => metreScreen({ clientId: m[1], viewId: q.get('vue') }) },
    { re: /^#\/interventions$/, nav: 'interventions', screen: () => interventionsScreen() },
    { re: /^#\/partage$/, nav: 'partage', screen: () => shareScreen() },
    { re: /^#\/client\/([^/]+)\/carte$/, nav: 'clients', full: true, screen: (m, q) => mapScreen({ clientId: m[1], viewId: q.get('vue') }) },
    { re: /^#\/client\/([^/]+)$/, nav: 'clients', screen: (m, q) => clientScreen({ clientId: m[1], tab: q.get('tab') }) },
    { re: /^#\/reglages$/, nav: 'reglages', screen: () => settingsScreen() },
    { re: /^#\/aide$/, nav: 'aide', screen: () => helpScreen() }
];

let current = null;
let navToken = 0;

async function route() {
    const token = ++navToken;
    const [path, qs] = (location.hash || '#/clients').split('?');
    const q = new URLSearchParams(qs || '');
    const r = ROUTES.find(x => x.re.test(path));
    if (!r) { location.replace('#/clients'); return; }

    if (current?.destroy) {
        try { await current.destroy(); } catch (e) { console.error(e); }
    }
    current = null;
    if (token !== navToken) return;
    releaseBlobUrls();

    const main = $('#main');
    main.innerHTML = '';
    main.scrollTop = 0;
    document.body.classList.toggle('fullscreen', !!r.full);
    renderNav(r.nav);

    try {
        const screen = await r.screen(path.match(r.re), q);
        if (token !== navToken) { screen?.destroy?.(); return; }
        if (!screen) return;
        current = screen;
        main.appendChild(screen.el);
    } catch (e) {
        console.error(e);
        main.appendChild(h('div', { class: 'page' }, h('div', { class: 'empty' },
            h('div', { class: 'ico' }, '⚠️'),
            h('p', null, h('strong', null, 'Une erreur est survenue.')),
            h('p', { class: 'muted' }, String(e.message || e)),
            h('a', { class: 'btn', href: '#/clients' }, 'Retour aux clients'))));
    }
}

function renderNav(active) {
    for (const box of [$('#top-nav'), $('#bottom-nav')]) {
        box.innerHTML = '';
        for (const n of NAV) {
            const attrs = {
                class: `nav-item${n.id === active ? ' active' : ''}${n.soon ? ' soon' : ''}`,
                title: n.soon ? `${n.label} : disponible à l'étape ${n.soon}` : n.label
            };
            const content = [h('span', { class: 'ico' }, n.icon), h('span', { class: 'lbl' }, n.label)];
            box.appendChild(n.soon
                ? h('button', { ...attrs, type: 'button', onClick: () => toast(`${n.label} : disponible à l'étape ${n.soon}`, 'info') }, content)
                : h('a', { ...attrs, href: n.href }, content));
        }
    }
}

function renderUiToggle() {
    const mode = getUiMode();
    const btn = $('#ui-toggle');
    btn.innerHTML = '';
    btn.append(
        h('span', { class: 'ico' }, mode === 'mobile' ? '📱' : '🖥️'),
        h('span', { class: 'lbl' }, mode === 'mobile' ? 'Tablette / Smartphone' : 'PC')
    );
}

// ------------------------------------------------------------
// Mises à jour (service worker)
// ------------------------------------------------------------
function setupServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    const hadController = !!navigator.serviceWorker.controller;
    let shown = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || shown) return;
        shown = true;
        $('#update-banner').hidden = false;
    });
    $('#update-reload').addEventListener('click', () => location.reload());
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js', { scope: './' })
            .then(reg => {
                setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'visible') reg.update().catch(() => {});
                });
            })
            .catch(err => console.error('Service worker non enregistré :', err));
    });
}

// ------------------------------------------------------------
// Démarrage
// ------------------------------------------------------------
async function init() {
    applyUiMode(getUiMode());
    $('#brand-version').textContent = self.LAPPEV_VERSION;
    renderUiToggle();
    $('#ui-toggle').addEventListener('click', () => {
        const next = getUiMode() === 'mobile' ? 'pc' : 'mobile';
        setUiMode(next);
        toast(next === 'mobile' ? '📱 Interface tablette / smartphone' : '🖥️ Interface PC', 'info');
    });
    window.addEventListener('uimodechange', () => { renderUiToggle(); route(); });
    window.addEventListener('hashchange', route);

    setupServiceWorker();

    try {
        await getCatalog(); // crée le catalogue par défaut au premier lancement
        if (await db.countClients()) requestPersistence();
    } catch (e) {
        console.error(e);
        toast("⚠️ Stockage local indisponible : vérifiez que le navigateur n'est pas en navigation privée.", 'error', 8000);
    }
    local.set('lastLaunch', Date.now());
    route();
}

init();
