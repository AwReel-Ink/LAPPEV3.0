// LAPPEV — Lecture sur chantier : filtres, cases à cocher, coloriage, partage de l'avancement, itinéraire
import { h, toast, blobToImage, blobUrl, debounce, actionSheet, confirmDialog, openModal, canvasToBlob, shareOrDownload, safeFileName } from '../util.js';
import { db } from '../db.js';
import { getCatalog, local } from '../model.js';
import { Viewport, drawScaleBar } from '../viewport.js';
import { IGN, viewPxToLngLat } from '../geo.js';
import { drawZones, zoneNumbers, hitZone, interventionOf, bbox, renderViewCanvas, pointInPolygon } from '../render.js';
import { badgeSvg } from '../symbols.js';
import { isMobileUi } from '../uimode.js';

export async function readingScreen({ clientId, viewId }) {
    const client = await db.getClient(clientId);
    if (!client) { toast('Client introuvable', 'error'); location.hash = '#/clients'; return null; }
    const catalog = await getCatalog();
    const interventions = new Map(catalog.interventions.map(i => [i.id, i]));
    const ordered = [...catalog.interventions].sort((a, b) => a.order - b.order);
    const toolsById = new Map(catalog.tools.map(t => [t.id, t]));

    let view = client.views.find(v => v.id === viewId) || client.views.find(v => (v.zones || []).length) || client.views[0] || null;
    let img = view ? await blobToImage(view.image) : null;

    // Interventions présentes chez ce client
    const presentIds = new Set();
    for (const v of client.views) for (const z of v.zones || []) if (z.kind === 'polygon') presentIds.add(z.interventionId);
    const present = ordered.filter(i => presentIds.has(i.id));
    const selKey = `lecture.sel.${client.id}`;
    const selected = new Set((local.get(selKey, null) || present.map(i => i.id)).filter(id => presentIds.has(id)));
    if (!selected.size) present.forEach(i => selected.add(i.id));

    // Avancement (local à l'appareil)
    const progress = (await db.getProgress(client.id)) || { clientId: client.id, zones: {}, updatedAt: Date.now() };
    const zp = id => (progress.zones[id] = progress.zones[id] || { checked: false, strokes: [], pct: 0 });
    const saveProgress = debounce(() => { progress.updatedAt = Date.now(); db.putProgress(progress).catch(console.error); }, 400);

    let mode = 'move';           // move | paint | erase
    let brush = local.get('brush', 22);
    const layers = new Map();
    let stroke = null;

    const visible = z => z.kind !== 'polygon' || selected.has(z.interventionId);
    const checkedSet = () => new Set(Object.entries(progress.zones).filter(([, p]) => p.checked).map(([id]) => id));

    // ------------------------------------------------------------
    // Couches de coloriage (une par zone)
    // ------------------------------------------------------------
    function tracePoly(ctx, pts) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
        ctx.closePath();
    }

    function strokeSeg(ctx, s, a, b) {
        ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
        ctx.lineWidth = s.r * 2;
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
    }

    function setupLayerCtx(L, zone) {
        const ctx = L.canvas.getContext('2d');
        ctx.setTransform(L.f, 0, 0, L.f, -L.bx * L.f, -L.by * L.f);
        ctx.save();
        tracePoly(ctx, zone.points);
        ctx.clip();
        ctx.strokeStyle = interventionOf(zone, interventions).color;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        L.ctx = ctx;
    }

    function buildLayer(zone, maxSide = 1024) {
        const p = progress.zones[zone.id];
        if (!p || !p.strokes.length) { layers.delete(zone.id); return null; }
        const b = bbox(zone.points);
        const f = Math.min(1, maxSide / Math.max(b.w, b.h, 1));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.ceil(b.w * f));
        canvas.height = Math.max(1, Math.ceil(b.h * f));
        const L = { canvas, f, bx: b.x0, by: b.y0, w: b.w, h: b.h };
        setupLayerCtx(L, zone);
        for (const s of p.strokes) {
            const pts = s.pts.length === 1 ? [s.pts[0], s.pts[0]] : s.pts;
            for (let i = 1; i < pts.length; i++) strokeSeg(L.ctx, s, pts[i - 1], pts[i]);
        }
        layers.set(zone.id, L);
        return L;
    }

    function getLayer(zone) { return layers.get(zone.id) || buildLayer(zone); }

    function coverage(zone) {
        const p = progress.zones[zone.id];
        if (!p || !p.strokes.length) return 0;
        const b = bbox(zone.points);
        const f = Math.min(1, 160 / Math.max(b.w, b.h, 1));
        const w = Math.max(1, Math.ceil(b.w * f)), hh = Math.max(1, Math.ceil(b.h * f));
        const mk = () => { const c = document.createElement('canvas'); c.width = w; c.height = hh; const x = c.getContext('2d', { willReadFrequently: true }); x.setTransform(f, 0, 0, f, -b.x0 * f, -b.y0 * f); return x; };
        const mask = mk();
        tracePoly(mask, zone.points);
        mask.fillStyle = '#000';
        mask.fill();
        const paint = mk();
        paint.save();
        tracePoly(paint, zone.points);
        paint.clip();
        paint.strokeStyle = '#000';
        paint.lineCap = 'round';
        for (const s of p.strokes) {
            const pts = s.pts.length === 1 ? [s.pts[0], s.pts[0]] : s.pts;
            for (let i = 1; i < pts.length; i++) strokeSeg(paint, s, pts[i - 1], pts[i]);
        }
        paint.restore();
        const a = mask.getImageData(0, 0, w, hh).data, c = paint.getImageData(0, 0, w, hh).data;
        let total = 0, done = 0;
        for (let i = 3; i < a.length; i += 4) if (a[i] > 128) { total++; if (c[i] > 128) done++; }
        return total ? Math.min(100, Math.round(done / total * 100)) : 0;
    }

    // ------------------------------------------------------------
    // Carte
    // ------------------------------------------------------------
    const canvas = h('canvas', { 'aria-label': 'Vue du chantier' });
    const vp = new Viewport(canvas, {
        minScale: 0.02, maxScale: 30,
        onRender: render,
        onResize: first => { if (first) fitImage(); }
    });

    function fitImage() {
        if (!img) return;
        vp.minScale = 0.02;
        vp.fit(0, 0, img.naturalWidth, img.naturalHeight, 0.96);
        vp.minScale = vp.scale * 0.5;
    }

    function drawPaint(ctx) {
        for (const z of view.zones || []) {
            if (z.kind !== 'polygon' || !visible(z)) continue;
            const L = getLayer(z);
            if (!L) continue;
            ctx.save();
            ctx.globalAlpha = 0.82;
            ctx.drawImage(L.canvas, L.bx, L.by, L.canvas.width / L.f, L.canvas.height / L.f);
            ctx.restore();
        }
    }

    function render(ctx) {
        if (!img) return;
        ctx.save();
        ctx.translate(vp.tx, vp.ty);
        ctx.scale(vp.scale, vp.scale);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0);
        drawPaint(ctx);
        drawZones(ctx, view.zones || [], { interventions, unit: 1 / vp.scale, visible, checked: checkedSet(), fillAlpha: 0.28, numberScale: isMobileUi() ? 1.25 : 1.1 });
        ctx.restore();
        if (stroke == null && mode !== 'move' && lastPointer) {
            ctx.beginPath();
            ctx.arc(lastPointer.x, lastPointer.y, brush, 0, Math.PI * 2);
            ctx.lineWidth = 2;
            ctx.strokeStyle = mode === 'erase' ? '#ffffff' : '#ffeb3b';
            ctx.stroke();
        }
        if (view.geo) drawScaleBar(ctx, vp, view.geo.mPerPx, { bottom: isMobileUi() ? 84 : 16 });
    }

    let lastPointer = null;
    vp.handler = {
        tap: (cp) => {
            if (mode !== 'move') return;
            const z = hitZone(view.zones || [], cp, 1 / vp.scale, visible);
            if (!z) return;
            if (z.kind === 'polygon') toggleCheck(z);
            else {
                const n = zoneNumbers(view.zones).get(z.id);
                toast(z.kind === 'parking' ? `🅿️ Parking ${n}${z.note ? ` : ${z.note}` : ''}` : `🚪 Entrée ${n}`, 'info', 3500);
            }
        },
        down: (cp, sp) => {
            if (mode === 'move') return false;
            const z = (view.zones || []).slice().reverse().find(x => x.kind === 'polygon' && visible(x) && pointInPolygon(cp, x.points));
            if (!z) { toast('Commencez à colorier à l’intérieur d’une zone affichée.', 'info', 2000); return true; }
            const p = zp(z.id);
            stroke = { zone: z, s: { r: brush / vp.scale, erase: mode === 'erase', pts: [[cp.x, cp.y]] } };
            p.strokes.push(stroke.s);
            const L = layers.get(z.id) || buildLayer(z);
            if (L) strokeSeg(L.ctx, stroke.s, [cp.x, cp.y], [cp.x, cp.y]);
            lastPointer = sp;
            vp.render();
            return true;
        },
        move: (cp, sp) => {
            lastPointer = sp;
            if (!stroke) return;
            const pts = stroke.s.pts;
            const last = pts[pts.length - 1];
            if (Math.hypot(cp.x - last[0], cp.y - last[1]) * vp.scale < 2) return;
            pts.push([cp.x, cp.y]);
            const L = layers.get(stroke.zone.id);
            if (L) strokeSeg(L.ctx, stroke.s, last, [cp.x, cp.y]);
            vp.render();
        },
        up: () => {
            if (!stroke) return;
            const z = stroke.zone;
            stroke = null;
            const p = zp(z.id);
            p.pct = coverage(z);
            saveProgress();
            renderPanel();
            if (p.pct >= 95 && !p.checked) askCheck(z, p.pct);
        },
        cancel: () => {
            if (!stroke) return;
            const p = zp(stroke.zone.id);
            p.strokes.pop();
            buildLayer(stroke.zone);
            stroke = null;
            vp.render();
        },
        hover: (cp, sp) => { lastPointer = sp; if (mode !== 'move') vp.render(); }
    };

    function toggleCheck(z, value) {
        const p = zp(z.id);
        p.checked = value ?? !p.checked;
        saveProgress();
        const n = zoneNumbers(view.zones).get(z.id);
        toast(`${p.checked ? '✅' : '↩️'} ${interventionOf(z, interventions).name} ${n} ${p.checked ? 'faite' : 'à faire'}`, p.checked ? 'ok' : 'info', 1500);
        renderPanel();
        vp.render();
    }

    const askBar = h('div', { class: 'overlay ask-bar glass', hidden: true });
    function askCheck(z, pct) {
        const n = zoneNumbers(view.zones).get(z.id);
        askBar.innerHTML = '';
        askBar.append(h('span', null, `${interventionOf(z, interventions).name} ${n} coloriée à ${pct} % — la marquer comme faite ?`),
            h('button', { class: 'btn primary', type: 'button', onClick: () => { askBar.hidden = true; toggleCheck(z, true); } }, '✅ Oui'),
            h('button', { class: 'btn', type: 'button', onClick: () => { askBar.hidden = true; } }, 'Non'));
        askBar.hidden = false;
        clearTimeout(askBar._t);
        askBar._t = setTimeout(() => { askBar.hidden = true; }, 9000);
    }

    // ------------------------------------------------------------
    // Panneau
    // ------------------------------------------------------------
    const panel = h('aside', { class: 'lec-panel' });

    function zonesOf(v, itId) { return (v.zones || []).filter(z => z.kind === 'polygon' && z.interventionId === itId); }

    function progressOf(itId) {
        let n = 0, done = 0;
        for (const v of client.views) for (const z of zonesOf(v, itId)) { n++; if (progress.zones[z.id]?.checked) done++; }
        return { n, done };
    }

    function renderPanel() {
        panel.innerHTML = '';
        const addr = [client.address, client.city].filter(Boolean).join(', ');
        panel.appendChild(h('div', { class: 'lec-head' },
            h('button', { class: 'btn ghost icon', type: 'button', title: 'Retour', 'aria-label': 'Retour', onClick: () => { location.hash = `#/client/${client.id}`; } }, '←'),
            h('div', { class: 'lec-title' }, h('h1', null, client.name), addr ? h('div', { class: 'muted' }, addr) : null)));
        panel.appendChild(h('div', { class: 'lec-buttons' },
            client.phone ? h('a', { class: 'btn', href: `tel:${client.phone.replace(/[^\d+]/g, '')}` }, '📞 Appeler') : null,
            h('button', { class: 'btn', type: 'button', onClick: itinerary }, '🧭 Itinéraire'),
            h('button', { class: 'btn ghost', type: 'button', onClick: () => { location.hash = `#/client/${client.id}`; } }, '✏️ Fiche')));
        if (client.accessCode) panel.appendChild(h('div', { class: 'code-box' }, h('span', { class: 'muted small' }, 'Code d’accès'), h('strong', null, client.accessCode)));
        if (client.notes) panel.appendChild(h('div', { class: 'notes-box' }, client.notes));

        if (client.photos.length) {
            panel.appendChild(h('div', { class: 'lec-photos' }, client.photos.map(p => {
                const url = blobUrl(p.image);
                return h('button', { class: 'lec-photo', type: 'button', onClick: () => openModal({ title: p.caption || 'Photo de repérage', wide: true, body: h('img', { src: url, class: 'photo-full', alt: '' }), actions: [{ label: 'Fermer', value: null, class: 'ghost' }] }) },
                    h('img', { src: url, alt: p.caption || 'Photo de repérage' }), p.caption ? h('span', null, p.caption) : null);
            })));
        }

        // Interventions
        const sec = h('section', { class: 'lec-section' }, h('h2', null, 'Je fais aujourd’hui'));
        if (!present.length) sec.appendChild(h('p', { class: 'muted' }, 'Aucune zone dessinée pour ce chantier.'));
        const combos = catalog.combos.filter(cb => cb.interventionIds.some(id => presentIds.has(id)));
        if (combos.length) sec.appendChild(h('div', { class: 'combo-chips' }, combos.map(cb => h('button', {
            class: 'btn small-btn', type: 'button',
            onClick: () => { selected.clear(); cb.interventionIds.filter(id => presentIds.has(id)).forEach(id => selected.add(id)); afterSelect(); }
        }, cb.name))));
        for (const it of present) {
            const pr = progressOf(it.id);
            sec.appendChild(h('label', { class: `lec-it${selected.has(it.id) ? ' on' : ''}` },
                h('input', { type: 'checkbox', checked: selected.has(it.id), onChange: e => { e.target.checked ? selected.add(it.id) : selected.delete(it.id); afterSelect(); } }),
                badgeSvg(it, 26), h('span', { class: 'lec-it-name' }, it.name),
                h('span', { class: `lec-it-count${pr.done === pr.n ? ' done' : ''}` }, `${pr.done}/${pr.n}`)));
        }
        panel.appendChild(sec);

        // Zones de la vue
        if (view) {
            const numbers = zoneNumbers(view.zones || []);
            const zs = h('section', { class: 'lec-section' }, h('h2', null, client.views.length > 1 ? `Zones — ${view.name}` : 'Zones'));
            let any = false;
            for (const it of present.filter(i => selected.has(i.id))) {
                for (const z of zonesOf(view, it.id)) {
                    any = true;
                    const p = progress.zones[z.id];
                    zs.appendChild(h('label', { class: `zone-line${p?.checked ? ' done' : ''}` },
                        h('input', { type: 'checkbox', checked: !!p?.checked, onChange: e => toggleCheck(z, e.target.checked) }),
                        badgeSvg(it, 20),
                        h('span', { class: 'zl-name' }, `${it.name} ${numbers.get(z.id)}`),
                        p && !p.checked && p.pct ? h('span', { class: 'zl-pct' }, h('i', { style: { width: `${p.pct}%`, background: it.color } }), h('b', null, `${p.pct} %`)) : null));
                }
            }
            for (const z of (view.zones || []).filter(x => x.kind === 'parking')) {
                any = true;
                zs.appendChild(h('div', { class: 'zone-line marker' }, '🅿️ ', h('span', { class: 'zl-name' }, `Parking ${numbers.get(z.id)}`), z.note ? h('span', { class: 'muted small' }, ` — ${z.note}`) : null));
            }
            if (!any) zs.appendChild(h('p', { class: 'muted' }, 'Aucune zone pour les interventions choisies sur cette vue.'));
            panel.appendChild(zs);
        }

        // Matériel
        const ms = h('section', { class: 'lec-section' }, h('h2', null, 'Matériel'));
        let anyMat = false;
        for (const it of present.filter(i => selected.has(i.id))) {
            const entries = Object.entries(client.materials?.[it.id] || {}).filter(([, q]) => q > 0);
            if (!entries.length) continue;
            anyMat = true;
            ms.appendChild(h('div', { class: 'lec-mat' },
                h('div', { class: 'lec-mat-head' }, badgeSvg(it, 18), h('strong', null, it.name)),
                h('ul', null, entries.map(([tid, q]) => h('li', null, h('b', null, `${q} ×`), ` ${toolsById.get(tid)?.name || 'Outil'}`)))));
        }
        if (!anyMat) ms.appendChild(h('p', { class: 'muted' }, 'Aucun matériel renseigné pour ces interventions (onglet « Interventions & matériel » de la fiche).'));
        ms.appendChild(h('div', { class: 'epi-note' }, '⚠️ Portez les EPI adaptés aux outils sélectionnés.'));
        panel.appendChild(ms);

        panel.appendChild(h('div', { class: 'lec-buttons end' },
            h('button', { class: 'btn primary', type: 'button', onClick: shareProgress, disabled: !view }, '📤 Partager l’avancement'),
            h('button', { class: 'btn danger', type: 'button', onClick: resetProgress }, '🔄 Réinitialiser')));
    }

    function afterSelect() {
        local.set(selKey, [...selected]);
        renderPanel();
        vp.render();
    }

    // ------------------------------------------------------------
    // Itinéraire vers un parking
    // ------------------------------------------------------------
    async function itinerary() {
        const targets = [];
        for (const v of client.views) {
            if (!v.geo) continue;
            const numbers = zoneNumbers(v.zones || []);
            for (const z of (v.zones || []).filter(x => x.kind === 'parking')) {
                const ll = viewPxToLngLat(v.geo, z.points[0].x, z.points[0].y);
                targets.push({ label: `Parking ${numbers.get(z.id)}${client.views.length > 1 ? ` (${v.name})` : ''}${z.note ? ` — ${z.note}` : ''}`, ...ll });
            }
        }
        let dest = null;
        if (targets.length === 1) dest = targets[0];
        else if (targets.length > 1) {
            const i = await actionSheet({ title: 'Aller à quel parking ?', actions: targets.map((t, idx) => ({ label: t.label, value: String(idx), icon: '🅿️' })) });
            if (i == null) return;
            dest = targets[+i];
        } else if (client.location) dest = { lat: client.location.lat, lng: client.location.lng };
        const q = encodeURIComponent([client.address, client.city].filter(Boolean).join(' '));
        if (!dest && !q) { toast('Aucune position ni adresse pour ce chantier.', 'info'); return; }
        const app = await actionSheet({
            title: 'Ouvrir avec…',
            actions: [{ label: 'Waze', value: 'waze', icon: '🚗' }, { label: 'Google Maps', value: 'google', icon: '🗺️' }, { label: 'Plans (Apple)', value: 'apple', icon: '🍎' }]
        });
        if (!app) return;
        const ll = dest ? `${dest.lat.toFixed(6)},${dest.lng.toFixed(6)}` : null;
        const url = {
            waze: ll ? `https://waze.com/ul?ll=${ll}&navigate=yes` : `https://waze.com/ul?q=${q}&navigate=yes`,
            google: `https://www.google.com/maps/dir/?api=1&destination=${ll || q}`,
            apple: `https://maps.apple.com/?daddr=${ll || q}`
        }[app];
        window.open(url, '_blank', 'noopener');
    }

    // ------------------------------------------------------------
    async function resetProgress() {
        const ok = await confirmDialog({ title: 'Réinitialiser l’avancement ?', message: 'Toutes les cases cochées et le coloriage de ce chantier seront effacés sur cet appareil.', okLabel: 'Réinitialiser', danger: true });
        if (!ok) return;
        progress.zones = {};
        layers.clear();
        await db.putProgress(progress);
        toast('🔄 Avancement remis à zéro');
        renderPanel();
        vp.render();
    }

    async function shareProgress() {
        if (!view || !img) return;
        const zones = view.zones || [];
        const base = renderViewCanvas(img, {
            maxSide: 2400,
            draw: (ctx, unit) => {
                for (const z of zones) {
                    if (z.kind !== 'polygon' || !visible(z)) continue;
                    const L = getLayer(z);
                    if (!L) continue;
                    ctx.save(); ctx.globalAlpha = 0.82;
                    ctx.drawImage(L.canvas, L.bx, L.by, L.canvas.width / L.f, L.canvas.height / L.f);
                    ctx.restore();
                }
                drawZones(ctx, zones, { interventions, unit, visible, checked: checkedSet(), fillAlpha: 0.28, numberScale: 1.3 });
            }
        });
        const lines = present.filter(i => selected.has(i.id)).map(i => { const p = progressOf(i.id); return `${i.name} : ${p.done}/${p.n}`; });
        const head = 96;
        const out = document.createElement('canvas');
        out.width = base.width;
        out.height = base.height + head;
        const ctx = out.getContext('2d');
        ctx.fillStyle = '#16213e';
        ctx.fillRect(0, 0, out.width, head);
        ctx.fillStyle = '#ffffff';
        ctx.font = '800 30px Arial, sans-serif';
        ctx.textBaseline = 'top';
        ctx.fillText(`${client.name} — avancement`, 20, 14);
        ctx.font = '500 20px Arial, sans-serif';
        ctx.fillStyle = '#c9d1e6';
        ctx.fillText(`${new Date().toLocaleDateString('fr-FR')} · ${view.name} · ${lines.join(' · ')}`, 20, 56);
        ctx.drawImage(base, 0, head);
        if (view.geo) { ctx.font = '12px Arial'; ctx.fillStyle = '#fff'; ctx.fillText(IGN.attribution, 10, out.height - 18); }
        const blob = await canvasToBlob(out, 'image/jpeg', 0.86);
        const name = `Avancement-${safeFileName(client.name)}-${new Date().toISOString().slice(0, 10)}.jpg`;
        const res = await shareOrDownload(blob, name, `Avancement — ${client.name}`);
        if (res === 'downloaded') toast('📥 Image de l’avancement téléchargée');
    }

    // ------------------------------------------------------------
    // Barre d'outils de la carte
    // ------------------------------------------------------------
    const modeSeg = h('div', { class: 'seg glass mode-seg' });
    const brushRow = h('label', { class: 'glass brush-row' });
    function renderModes() {
        modeSeg.innerHTML = '';
        for (const [id, label] of [['move', '✋ Déplacer / cocher'], ['paint', '🖌️ Colorier'], ['erase', '🧽 Gomme']]) {
            modeSeg.appendChild(h('button', { type: 'button', class: mode === id ? 'on' : '', onClick: () => { mode = id; renderModes(); vp.render(); } }, label));
        }
        brushRow.hidden = mode === 'move';
        brushRow.innerHTML = '';
        brushRow.append(h('span', { class: 'small' }, 'Pinceau'), h('input', {
            type: 'range', min: 8, max: 60, value: brush,
            onInput: e => { brush = +e.target.value; local.set('brush', brush); }
        }));
    }

    const viewSeg = client.views.length > 1 ? h('div', { class: 'seg glass view-seg' }, client.views.map(v => h('button', {
        type: 'button', class: v === view ? 'on' : '', 'data-id': v.id,
        onClick: async () => {
            if (v === view) return;
            view = v;
            img = await blobToImage(v.image);
            layers.clear();
            viewSeg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.id === v.id));
            fitImage();
            renderPanel();
        }
    }, v.name))) : null;

    const stage = h('div', { class: 'stage lec-stage' },
        canvas,
        view ? null : h('div', { class: 'empty' }, h('p', null, 'Aucune vue pour ce chantier.')),
        h('div', { class: 'overlay ov-top' }, viewSeg, h('div', { class: 'ov-spacer' }),
            h('button', { class: 'btn glass', type: 'button', title: 'Modifier les zones', onClick: () => { if (view) location.hash = `#/client/${client.id}/vue/${view.id}`; } }, '✏️', h('span', { class: 'hide-xs' }, ' Zones'))),
        h('div', { class: 'overlay ov-right' },
            h('button', { class: 'btn glass icon', type: 'button', title: 'Zoom avant', onClick: () => vp.zoomBy(1.4) }, '+'),
            h('button', { class: 'btn glass icon', type: 'button', title: 'Zoom arrière', onClick: () => vp.zoomBy(1 / 1.4) }, '−'),
            h('button', { class: 'btn glass icon', type: 'button', title: 'Recentrer', onClick: fitImage }, '⤢')),
        askBar,
        h('div', { class: 'overlay ov-bottom' }, brushRow, modeSeg),
        view?.geo ? h('div', { class: 'attribution' }, IGN.attribution) : null
    );

    const el = h('div', { class: 'lecture' }, panel, stage);
    renderModes();
    renderPanel();

    return {
        el,
        async destroy() {
            vp.destroy();
            await saveProgress.flush();
        }
    };
}
