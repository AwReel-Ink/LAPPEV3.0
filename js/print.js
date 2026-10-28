// LAPPEV — impressions : fiche moniteur et fiche travailleurs (A4 paysage)
import { h, blobToImage, blobUrl, toast } from './util.js';
import { IGN } from './geo.js';
import { drawZones, zoneNumbers, renderViewCanvas } from './render.js';
import { badgeSvg, textOn } from './symbols.js';

function printRoot() {
    let root = document.getElementById('print-root');
    if (!root) {
        root = h('div', { id: 'print-root' });
        document.body.appendChild(root);
    }
    root.innerHTML = '';
    let style = document.getElementById('print-page-style');
    if (!style) {
        style = h('style', { id: 'print-page-style' });
        document.head.appendChild(style);
    }
    style.textContent = '@page { size: A4 landscape; margin: 7mm; }';
    return root;
}

async function viewImage(view, interventions, visibleIds, numberScale, lineScale = 1.5, fillAlpha = 0.45) {
    const img = await blobToImage(view.image);
    const canvas = renderViewCanvas(img, {
        maxSide: 2000,
        draw: (ctx, unit) => drawZones(ctx, view.zones || [], {
            interventions, unit, numberScale, fillAlpha, lineScale,
            visible: z => z.kind !== 'polygon' || visibleIds.has(z.interventionId)
        })
    });
    const url = canvas.toDataURL('image/jpeg', 0.88);
    canvas.width = canvas.height = 0;
    return url;
}

async function waitImages(root) {
    await Promise.all([...root.querySelectorAll('img')].map(i => (i.complete ? Promise.resolve() : i.decode().catch(() => {}))));
}

function launch(root) {
    const cleanup = () => { root.innerHTML = ''; window.removeEventListener('afterprint', cleanup); };
    window.addEventListener('afterprint', cleanup);
    setTimeout(() => window.print(), 150);
}

const today = () => new Date().toLocaleDateString('fr-FR');

// ------------------------------------------------------------
// Fiche moniteur
// ------------------------------------------------------------
export async function printMonitorSheet(client, catalog, ids) {
    toast('🖨️ Préparation de l’impression…', 'info', 2000);
    const interventions = new Map(catalog.interventions.map(i => [i.id, i]));
    const toolsById = new Map(catalog.tools.map(t => [t.id, t]));
    const chosen = new Set(ids);
    const root = printRoot();
    const views = client.views.filter(v => (v.zones || []).some(z => z.kind !== 'polygon' || chosen.has(z.interventionId)));
    const pages = [];

    const infoRows = [
        ['Nom', client.name], ['Téléphone', client.phone], ['Email', client.email],
        ['Adresse', client.address], ['Ville', client.city], ['Code d’accès', client.accessCode], ['Notes', client.notes]
    ].filter(([, v]) => v);

    for (const v of views) {
        const src = await viewImage(v, interventions, chosen, 1.5, 1.6, 0.45);
        const numbers = zoneNumbers(v.zones || []);
        const legend = h('div', { class: 'pp-legend' }, h('div', { class: 'pp-sub' }, 'Zones'));
        for (const id of ids) {
            const zs = (v.zones || []).filter(z => z.kind === 'polygon' && z.interventionId === id);
            if (!zs.length) continue;
            const it = interventions.get(id);
            legend.appendChild(h('div', { class: 'pp-leg-row' },
                badgeSvg(it, 20), h('strong', null, it.name),
                h('span', { class: 'pp-nums' }, zs.map(z => h('span', { class: 'pp-num', style: { background: it.color, color: textOn(it.color) } }, numbers.get(z.id))))));
        }
        for (const z of (v.zones || []).filter(x => x.kind !== 'polygon')) {
            legend.appendChild(h('div', { class: 'pp-leg-row' },
                h('span', { class: `pp-marker ${z.kind}` }, z.kind === 'parking' ? 'P' : ''),
                h('strong', null, `${z.kind === 'parking' ? 'Parking' : 'Entrée'} ${numbers.get(z.id)}`),
                z.note ? h('span', { class: 'pp-note' }, z.note) : null));
        }
        pages.push(h('div', { class: 'pp page' },
            h('div', { class: 'pp-head' },
                h('div', null, h('b', null, 'LAPPEV'), ' · Fiche moniteur'),
                h('div', { class: 'pp-title' }, client.name, views.length > 1 ? ` — ${v.name}` : ''),
                h('div', null, today())),
            h('div', { class: 'pp-body' },
                h('div', { class: 'pp-img' }, h('img', { src, alt: '' })),
                h('div', { class: 'pp-side' },
                    h('table', { class: 'pp-client' }, h('tbody', null, infoRows.map(([k, val]) => h('tr', null, h('th', null, k), h('td', null, val))))),
                    legend,
                    client.photos.length ? h('div', { class: 'pp-photos' }, client.photos.slice(0, 2).map(p => h('figure', null, h('img', { src: blobUrl(p.image), alt: '' }), p.caption ? h('figcaption', null, p.caption) : null))) : null)),
            v.geo ? h('div', { class: 'pp-foot' }, `Source : ${IGN.attribution}`) : null));
    }

    // Page matériel
    const blocks = [];
    for (const id of ids) {
        const it = interventions.get(id);
        const entries = Object.entries(client.materials?.[id] || {}).filter(([, q]) => q > 0);
        if (!entries.length) continue;
        const mot = entries.filter(([tid]) => toolsById.get(tid)?.motorise);
        const man = entries.filter(([tid]) => !toolsById.get(tid)?.motorise);
        const table = (title, rows) => rows.length ? h('table', { class: 'pp-mat' },
            h('thead', null, h('tr', null, h('th', null, title), h('th', { class: 'q' }, 'Qté'))),
            h('tbody', null, rows.map(([tid, q]) => h('tr', null, h('td', null, toolsById.get(tid)?.name || 'Outil'), h('td', { class: 'q' }, String(q)))))) : null;
        blocks.push(h('div', { class: 'pp-mat-block' },
            h('div', { class: 'pp-leg-row big' }, badgeSvg(it, 26), h('strong', null, it.name)),
            h('div', { class: 'pp-mat-cols' }, table('⛽ Matériel motorisé', mot), table('🧹 Matériel manuel', man))));
    }
    if (blocks.length) {
        pages.push(h('div', { class: 'pp page' },
            h('div', { class: 'pp-head' }, h('div', null, h('b', null, 'LAPPEV'), ' · Matériel'), h('div', { class: 'pp-title' }, client.name), h('div', null, today())),
            h('div', { class: 'pp-mat-wrap' }, blocks),
            h('div', { class: 'pp-epi' }, '⚠️ Portez les EPI adaptés aux outils sélectionnés.')));
    }

    if (!pages.length) { toast('Rien à imprimer pour ces interventions.', 'info'); return; }
    root.append(...pages);
    await waitImages(root);
    launch(root);
}

// ------------------------------------------------------------
// Fiche travailleurs : une page par intervention (et par vue), très visuelle
// ------------------------------------------------------------
export async function printWorkerSheet(client, catalog, ids) {
    toast('🖨️ Préparation de l’impression…', 'info', 2000);
    const interventions = new Map(catalog.interventions.map(i => [i.id, i]));
    const root = printRoot();
    const pages = [];
    const photo = client.photos[0];
    const photoUrl = photo ? blobUrl(photo.image) : null;
    const addr = [client.address, client.city].filter(Boolean).join(' — ');

    for (const id of ids) {
        const it = interventions.get(id);
        for (const v of client.views) {
            const zs = (v.zones || []).filter(z => z.kind === 'polygon' && z.interventionId === id);
            if (!zs.length) continue;
            const src = await viewImage(v, interventions, new Set([id]), 2.6, 2.2, 0.55);
            const numbers = zoneNumbers(v.zones || []);
            const fg = textOn(it.color);
            const markers = (v.zones || []).filter(z => z.kind !== 'polygon');
            pages.push(h('div', { class: 'pw page' },
                h('div', { class: 'pw-band', style: { background: it.color, color: fg } },
                    badgeSvg(it, 64), h('span', { class: 'pw-title' }, it.name),
                    client.views.length > 1 ? h('span', { class: 'pw-view' }, v.name) : null),
                h('div', { class: 'pw-body' },
                    h('div', { class: 'pw-img' }, h('img', { src, alt: '' })),
                    h('div', { class: 'pw-side' },
                        h('div', { class: 'pw-client' }, h('div', { class: 'pw-name' }, client.name), addr ? h('div', { class: 'pw-addr' }, addr) : null),
                        photoUrl ? h('figure', { class: 'pw-photo' }, h('img', { src: photoUrl, alt: '' }), photo.caption ? h('figcaption', null, photo.caption) : null) : null,
                        h('div', { class: 'pw-checks' }, zs.map(z => h('div', { class: 'pw-check' },
                            h('span', { class: 'pw-box' }),
                            h('span', { class: 'pw-num', style: { background: it.color, color: fg } }, numbers.get(z.id))))),
                        markers.length ? h('div', { class: 'pw-markers' },
                            markers.some(m => m.kind === 'parking') ? h('span', null, h('span', { class: 'pp-marker parking' }, 'P'), ' Parking') : null,
                            markers.some(m => m.kind === 'entree') ? h('span', null, h('span', { class: 'pp-marker entree' }), ' Entrée') : null) : null)),
                h('div', { class: 'pw-foot' }, `${today()}${v.geo ? ` · Source : ${IGN.attribution}` : ''}`)));
        }
    }
    if (!pages.length) { toast('Rien à imprimer pour ces interventions.', 'info'); return; }
    root.append(...pages);
    await waitImages(root);
    launch(root);
}
