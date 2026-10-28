// LAPPEV — Carte IGN : recherche d'adresse, rectangle de chantier, capture géoréférencée
import { h, toast, confirmDialog, debounce, uuid, formatMeters } from '../util.js';
import { db } from '../db.js';
import { saveClient } from '../model.js';
import { Viewport, drawScaleBar } from '../viewport.js';
import { isMobileUi } from '../uimode.js';
import {
    IGN, TILE, lngLatToWorld, worldToLngLat, metersPerWorldUnit, searchAddress,
    estimateCapture, captureArea, reprojectViewContent, viewWorldRect
} from '../geo.js';

const FRANCE = { lng: 2.4, lat: 46.6 };

export async function mapScreen({ clientId, viewId }) {
    const client = await db.getClient(clientId);
    if (!client) { toast('Client introuvable', 'error'); location.hash = '#/clients'; return null; }
    const view = viewId ? client.views.find(v => v.id === viewId && v.geo) : null;

    let layerId = view?.geo?.layer || 'ortho';
    let rect = view ? viewWorldRect(view.geo) : null; // en unités "monde" (zoom 0)
    let mode = rect ? 'edit' : 'idle';                // idle | draw | drawing | edit
    let drag = null;
    let busy = false;
    let corsWarned = false;
    const tiles = new Map();

    // ------------------------------------------------------------
    // Carte
    // ------------------------------------------------------------
    const canvas = h('canvas', { 'aria-label': 'Carte IGN' });
    const vp = new Viewport(canvas, {
        minScale: 2 ** 5,
        maxScale: 2 ** 21,
        onRender: render,
        onChange: () => updateInfo(),
        handler: makeHandler(),
        onResize: first => { if (first) initialView(); }
    });

    function initialView() {
        if (rect) { vp.fit(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0, 0.7); return; }
        if (client.location) { goTo(client.location.lng, client.location.lat, 18); return; }
        goTo(FRANCE.lng, FRANCE.lat, 6);
        const q = [client.address, client.city].filter(Boolean).join(' ');
        if (q.trim().length >= 3) {
            searchAddress(q).then(res => {
                if (res[0] && !rect) { goTo(res[0].lng, res[0].lat, 18); toast(`📍 ${res[0].label}`, 'info'); }
            }).catch(() => { /* hors ligne : on reste sur la France */ });
        }
    }

    function goTo(lng, lat, zoom) {
        const w = lngLatToWorld(lng, lat);
        vp.centerOn(w.x, w.y, 2 ** zoom);
    }

    function centerLat() {
        const c = vp.toContent({ x: vp.w / 2, y: vp.h / 2 });
        return worldToLngLat(c.x, c.y).lat;
    }

    function getTile(z, x, y) {
        const url = IGN.tileUrl(layerId, z, x, y);
        let t = tiles.get(url);
        if (!t) {
            const img = new Image();
            t = { img, ok: false, cors: true };
            img.crossOrigin = 'anonymous';
            img.onload = () => { t.ok = true; vp.render(); };
            img.onerror = () => {
                // Repli sans CORS : la carte reste visible, mais la capture risque d'échouer
                if (t.cors) {
                    t.cors = false;
                    if (!corsWarned) { corsWarned = true; console.warn('Tuiles IGN chargées sans CORS'); }
                    img.removeAttribute('crossorigin');
                    img.src = url + '&_r=1';
                } else t.err = true;
            };
            img.src = url;
            tiles.set(url, t);
            if (tiles.size > 900) tiles.delete(tiles.keys().next().value);
        }
        return t;
    }

    function drawFallback(ctx, z, x, y, sx, sy, w, hh) {
        for (let up = 1; up <= 5 && z - up >= 0; up++) {
            const f = 2 ** up;
            const px = Math.floor(x / f), py = Math.floor(y / f);
            const t = tiles.get(IGN.tileUrl(layerId, z - up, px, py));
            if (t && t.ok) {
                const sub = TILE / f;
                ctx.drawImage(t.img, (x - px * f) * sub, (y - py * f) * sub, sub, sub, sx, sy, w, hh);
                return;
            }
        }
    }

    function render(ctx) {
        const L = IGN.layers[layerId];
        const z = Math.max(0, Math.min(L.maxNative, Math.round(Math.log2(vp.scale))));
        const n = 2 ** z;
        const tw = TILE / n;
        const v = vp.visibleRect();
        const x0 = Math.max(0, Math.floor(v.x0 / tw)), x1 = Math.min(n - 1, Math.floor(v.x1 / tw));
        const y0 = Math.max(0, Math.floor(v.y0 / tw)), y1 = Math.min(n - 1, Math.floor(v.y1 / tw));
        ctx.fillStyle = '#1b2236';
        ctx.fillRect(0, 0, vp.w, vp.h);
        if ((x1 - x0 + 1) * (y1 - y0 + 1) <= 600) {
            for (let ty = y0; ty <= y1; ty++) {
                for (let tx = x0; tx <= x1; tx++) {
                    const sx = Math.floor(tx * tw * vp.scale + vp.tx);
                    const sy = Math.floor(ty * tw * vp.scale + vp.ty);
                    const ex = Math.floor((tx + 1) * tw * vp.scale + vp.tx);
                    const ey = Math.floor((ty + 1) * tw * vp.scale + vp.ty);
                    const t = getTile(z, tx, ty);
                    if (t.ok) ctx.drawImage(t.img, sx, sy, ex - sx + 0.5, ey - sy + 0.5);
                    else drawFallback(ctx, z, tx, ty, sx, sy, ex - sx + 0.5, ey - sy + 0.5);
                }
            }
        }
        drawRect(ctx);
        drawScaleBar(ctx, vp, metersPerWorldUnit(centerLat()), { bottom: isMobileUi() ? 170 : 16 });
    }

    // ------------------------------------------------------------
    // Rectangle du chantier
    // ------------------------------------------------------------
    const handleR = () => (isMobileUi() ? 14 : 9);
    const norm = r => ({ x0: Math.min(r.x0, r.x1), y0: Math.min(r.y0, r.y1), x1: Math.max(r.x0, r.x1), y1: Math.max(r.y0, r.y1) });

    function rectScreen() {
        const r = norm(rect);
        const a = vp.toScreen({ x: r.x0, y: r.y0 }), b = vp.toScreen({ x: r.x1, y: r.y1 });
        return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
    }

    function rectMeters() {
        const r = norm(rect);
        const lat = worldToLngLat((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2).lat;
        const m = metersPerWorldUnit(lat);
        return { w: (r.x1 - r.x0) * m, h: (r.y1 - r.y0) * m };
    }

    function drawRect(ctx) {
        if (!rect) return;
        const r = rectScreen();
        const w = r.x1 - r.x0, hh = r.y1 - r.y0;
        ctx.save();
        ctx.fillStyle = 'rgba(8,10,25,0.45)';
        ctx.beginPath();
        ctx.rect(0, 0, vp.w, vp.h);
        ctx.rect(r.x0, r.y0, w, hh);
        ctx.fill('evenodd');

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4;
        ctx.strokeRect(r.x0, r.y0, w, hh);
        ctx.strokeStyle = '#e94560';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([10, 6]);
        ctx.strokeRect(r.x0, r.y0, w, hh);
        ctx.setLineDash([]);

        if (mode !== 'drawing') {
            const R = handleR();
            for (const [x, y] of [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]]) {
                ctx.beginPath();
                ctx.arc(x, y, R, 0, Math.PI * 2);
                ctx.fillStyle = '#ffffff';
                ctx.fill();
                ctx.lineWidth = 3;
                ctx.strokeStyle = '#e94560';
                ctx.stroke();
            }
            // poignée centrale de déplacement
            const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
            if (w > R * 5 && hh > R * 5) {
                ctx.beginPath();
                ctx.arc(cx, cy, R + 5, 0, Math.PI * 2);
                ctx.fillStyle = '#e94560';
                ctx.fill();
                ctx.lineWidth = 2;
                ctx.strokeStyle = '#ffffff';
                ctx.stroke();
                ctx.fillStyle = '#ffffff';
                ctx.font = `bold ${R + 6}px system-ui, sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('✥', cx, cy + 1);
            }
        }
        // dimensions
        const m = rectMeters();
        const label = `≈ ${formatMeters(m.w)} × ${formatMeters(m.h)}`;
        ctx.font = '700 13px system-ui, sans-serif';
        const tw = ctx.measureText(label).width;
        const lx = Math.max(6, Math.min(vp.w - tw - 22, r.x0));
        const ly = r.y0 - 34 > 4 ? r.y0 - 34 : r.y0 + 8;
        ctx.fillStyle = 'rgba(233,69,96,0.95)';
        if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(lx, ly, tw + 16, 24, 12); ctx.fill(); }
        else ctx.fillRect(lx, ly, tw + 16, 24);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, lx + 8, ly + 12);
        ctx.restore();
    }

    function makeHandler() {
        return {
            down(cp, sp) {
                if (busy) return false;
                if (mode === 'draw') {
                    rect = { x0: cp.x, y0: cp.y, x1: cp.x, y1: cp.y };
                    drag = { type: 'new' };
                    mode = 'drawing';
                    return true;
                }
                if (!rect) return false;
                const r = rectScreen();
                const tol = handleR() + (isMobileUi() ? 12 : 7);
                const corners = [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]];
                for (let i = 0; i < 4; i++) {
                    if (Math.hypot(sp.x - corners[i][0], sp.y - corners[i][1]) <= tol) {
                        rect = norm(rect);
                        drag = { type: 'corner', i };
                        return true;
                    }
                }
                const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
                if (Math.hypot(sp.x - cx, sp.y - cy) <= tol + 5) {
                    drag = { type: 'move', start: cp, orig: norm(rect) };
                    return true;
                }
                return false;
            },
            move(cp) {
                if (!drag) return;
                if (drag.type === 'new') { rect.x1 = cp.x; rect.y1 = cp.y; }
                else if (drag.type === 'corner') {
                    const i = drag.i;
                    if (i === 0 || i === 3) rect.x0 = cp.x; else rect.x1 = cp.x;
                    if (i === 0 || i === 1) rect.y0 = cp.y; else rect.y1 = cp.y;
                } else if (drag.type === 'move') {
                    const dx = cp.x - drag.start.x, dy = cp.y - drag.start.y;
                    rect = { x0: drag.orig.x0 + dx, y0: drag.orig.y0 + dy, x1: drag.orig.x1 + dx, y1: drag.orig.y1 + dy };
                }
                vp.render();
                updateInfo();
            },
            up() {
                if (!drag) return;
                const wasNew = drag.type === 'new';
                drag = null;
                rect = norm(rect);
                const r = rectScreen();
                if (r.x1 - r.x0 < 16 || r.y1 - r.y0 < 16) {
                    if (wasNew) {
                        rect = null;
                        mode = 'draw';
                        toast('Rectangle trop petit : faites glisser votre doigt ou la souris sur la carte.', 'info');
                    }
                } else mode = 'edit';
                vp.render();
                updateUi();
            },
            cancel() {
                if (mode === 'drawing') { rect = null; mode = 'draw'; }
                drag = null;
                if (rect) rect = norm(rect);
                vp.render();
                updateUi();
            },
            hover(cp, sp) {
                if (mode === 'draw') { canvas.style.cursor = 'crosshair'; return; }
                if (!rect) { canvas.style.cursor = ''; return; }
                const r = rectScreen();
                const tol = handleR() + 7;
                const near = [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]].some(([x, y]) => Math.hypot(sp.x - x, sp.y - y) <= tol);
                const center = Math.hypot(sp.x - (r.x0 + r.x1) / 2, sp.y - (r.y0 + r.y1) / 2) <= tol + 5;
                canvas.style.cursor = near ? 'nwse-resize' : center ? 'move' : '';
            }
        };
    }

    // ------------------------------------------------------------
    // Interface
    // ------------------------------------------------------------
    const searchInput = h('input', {
        type: 'search', class: 'input', placeholder: 'Rechercher une adresse…', autocomplete: 'off',
        value: [client.address, client.city].filter(Boolean).join(' ')
    });
    const suggestions = h('div', { class: 'suggestions glass', hidden: true });
    let lastResults = [];
    let abort = null;

    const runSearch = debounce(async () => {
        const q = searchInput.value.trim();
        if (q.length < 3) { suggestions.hidden = true; return; }
        abort?.abort();
        abort = new AbortController();
        try {
            lastResults = await searchAddress(q, abort.signal);
            renderSuggestions();
        } catch (e) {
            if (e.name === 'AbortError') return;
            suggestions.innerHTML = '';
            suggestions.appendChild(h('div', { class: 'suggestion muted' }, navigator.onLine ? "Recherche d'adresse indisponible." : 'Hors ligne : recherche impossible.'));
            suggestions.hidden = false;
        }
    }, 300);

    function renderSuggestions() {
        suggestions.innerHTML = '';
        if (!lastResults.length) {
            suggestions.appendChild(h('div', { class: 'suggestion muted' }, 'Aucune adresse trouvée.'));
        } else {
            for (const r of lastResults) {
                suggestions.appendChild(h('button', { class: 'suggestion', type: 'button', onClick: () => pick(r) }, '📍 ', r.label));
            }
        }
        suggestions.hidden = false;
    }

    function pick(r) {
        suggestions.hidden = true;
        searchInput.value = r.label;
        searchInput.blur();
        goTo(r.lng, r.lat, 18.5);
    }

    searchInput.addEventListener('input', runSearch);
    searchInput.addEventListener('focus', () => { if (lastResults.length) suggestions.hidden = false; });
    searchInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            runSearch.flush();
            setTimeout(() => { if (lastResults[0]) pick(lastResults[0]); }, 600);
        }
        if (e.key === 'Escape') suggestions.hidden = true;
    });
    canvas.addEventListener('pointerdown', () => { suggestions.hidden = true; searchInput.blur(); });

    const layerBtns = Object.values(IGN.layers).map(l => h('button', {
        type: 'button', class: l.id === layerId ? 'on' : '',
        onClick: () => {
            layerId = l.id;
            layerBtns.forEach(b => b.classList.toggle('on', b.dataset.id === layerId));
            vp.render();
        },
        'data-id': l.id
    }, l.label));

    const hint = h('div', { class: 'overlay hint-bubble', hidden: true }, '✏️ Faites glisser sur la carte pour tracer le rectangle du chantier.');
    const infoChip = h('div', { class: 'glass info-chip map-info', hidden: true });
    const offline = h('div', { class: 'overlay offline-chip', hidden: navigator.onLine }, '📡 Hors ligne : la carte IGN nécessite internet.');

    const btnDraw = h('button', { class: 'btn glass', type: 'button', onClick: startDraw }, '▭ ', h('span', null, 'Tracer'));
    const btnClear = h('button', { class: 'btn glass', type: 'button', onClick: clearRect, title: 'Effacer le rectangle' }, '✕ ', h('span', null, 'Effacer'));
    const btnFit = h('button', { class: 'btn glass icon', type: 'button', title: 'Centrer sur le rectangle', onClick: fitRect }, '⌖');
    const btnCapture = h('button', { class: 'btn primary', type: 'button', onClick: doCapture }, '📸 ', h('span', null, view ? 'Recapturer' : 'Capturer'));

    const progressBar = h('i');
    const progressText = h('div', { class: 'muted small' }, '');
    const progress = h('div', { class: 'progress-overlay', hidden: true },
        h('div', { class: 'glass progress-box' },
            h('strong', null, '📸 Capture en cours…'),
            h('div', { class: 'bar' }, progressBar),
            progressText));

    function startDraw() {
        mode = 'draw';
        rect = null;
        vp.render();
        updateUi();
    }

    function clearRect() {
        rect = null;
        mode = 'idle';
        vp.render();
        updateUi();
    }

    function fitRect() {
        if (!rect) return;
        vp.fit(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0, 0.7);
    }

    function updateUi() {
        hint.hidden = mode !== 'draw';
        btnDraw.classList.toggle('active', mode === 'draw');
        btnClear.hidden = !rect;
        btnFit.hidden = !rect;
        btnCapture.disabled = !rect || mode === 'drawing';
        updateInfo();
    }

    let infoKey = '';
    function updateInfo() {
        const key = rect && mode !== 'draw' ? JSON.stringify(estimateCapture(norm(rect))) : `${mode}-${!!rect}`;
        if (key === infoKey) return;
        infoKey = key;
        if (!rect && mode === 'idle') {
            infoChip.innerHTML = '';
            infoChip.append(h('div', null, '1. Cherchez l’adresse et zoomez sur le chantier.'), h('div', null, '2. Touchez « Tracer » et dessinez le rectangle.'));
            infoChip.hidden = false;
            return;
        }
        if (!rect || mode === 'draw') { infoChip.hidden = true; return; }
        const est = estimateCapture(norm(rect));
        const cm = Math.round(est.mPerPx * 100);
        infoChip.innerHTML = '';
        infoChip.append(
            h('div', null, h('strong', null, `Image : ${est.width} × ${est.height} px`), ` · ${cm} cm/pixel`),
            est.reduced
                ? h('div', { class: 'warn small' }, `Grand chantier : résolution réduite à ${cm} cm/pixel. Pensez à découper en plusieurs vues.`)
                : h('div', { class: 'muted small' }, 'Résolution maximale IGN.')
        );
        infoChip.hidden = false;
    }

    async function doCapture() {
        if (!rect || busy) return;
        if (!navigator.onLine) { toast('Pas de connexion internet : capture impossible.', 'error'); return; }
        const r = norm(rect);
        if (view) {
            const nz = view.zones?.length || 0;
            const ok = await confirmDialog({
                title: 'Recapturer cette vue ?',
                message: `La nouvelle image remplacera celle de « ${view.name} ».${nz ? `\nLes ${nz} zone(s) seront repositionnées automatiquement grâce aux coordonnées GPS.` : ''}`,
                okLabel: 'Recapturer'
            });
            if (!ok) return;
        }
        busy = true;
        progress.hidden = false;
        progressBar.style.width = '0%';
        progressText.textContent = 'Préparation…';
        try {
            const res = await captureArea(r, layerId, (done, total) => {
                progressBar.style.width = `${Math.round(done / total * 100)}%`;
                progressText.textContent = `${done} / ${total} morceaux de carte`;
            });
            if (res.missing) {
                const ok = await confirmDialog({
                    title: 'Capture incomplète',
                    message: `${res.missing} morceau(x) de carte sur ${res.total} n'ont pas pu être chargés (zones grises).\nEnregistrer quand même ?`,
                    okLabel: 'Enregistrer quand même'
                });
                if (!ok) return;
            }
            let target = view;
            if (view) {
                const outside = reprojectViewContent(client, view, res.geo);
                Object.assign(view, { image: res.blob, width: res.width, height: res.height, geo: res.geo, capturedAt: Date.now() });
                if (outside) toast(`⚠️ ${outside} point(s) de zone se trouvent hors du nouveau cadrage.`, 'info', 5000);
            } else {
                target = {
                    id: uuid(),
                    name: client.views.length ? `Vue ${client.views.length + 1}` : 'Vue principale',
                    source: 'ign',
                    image: res.blob, width: res.width, height: res.height, geo: res.geo,
                    capturedAt: Date.now(),
                    zones: []
                };
                client.views.push(target);
            }
            if (!client.location) {
                const c = worldToLngLat((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2);
                client.location = { lat: c.lat, lng: c.lng };
            }
            await saveClient(client);
            toast(view ? '📸 Vue recapturée' : '📸 Vue enregistrée');
            location.hash = `#/client/${client.id}/vue/${target.id}`;
        } catch (e) {
            console.error(e);
            toast(e.userMessage || `Échec de la capture : ${e.message}`, 'error', 6000);
        } finally {
            busy = false;
            progress.hidden = true;
        }
    }

    const back = () => {
        location.hash = view ? `#/client/${client.id}/vue/${view.id}` : `#/client/${client.id}?tab=vues`;
    };

    const onOnline = () => { offline.hidden = navigator.onLine; vp.render(); };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOnline);
    const onKey = e => {
        if (e.key === 'Escape' && mode === 'draw') { mode = rect ? 'edit' : 'idle'; updateUi(); }
    };
    document.addEventListener('keydown', onKey);

    const el = h('div', { class: 'stage map-stage' },
        canvas,
        h('div', { class: 'overlay ov-top' },
            h('button', { class: 'btn glass icon', type: 'button', title: 'Retour', 'aria-label': 'Retour', onClick: back }, '←'),
            h('div', { class: 'search' }, searchInput, suggestions),
            h('div', { class: 'seg glass' }, layerBtns)
        ),
        hint,
        offline,
        h('div', { class: 'overlay ov-right' },
            h('button', { class: 'btn glass icon', type: 'button', title: 'Zoom avant', onClick: () => vp.zoomBy(2) }, '+'),
            h('button', { class: 'btn glass icon', type: 'button', title: 'Zoom arrière', onClick: () => vp.zoomBy(0.5) }, '−'),
            btnFit
        ),
        h('div', { class: 'overlay ov-bottom map-bottom' },
            infoChip,
            h('div', { class: 'map-actions' }, btnDraw, btnClear, btnCapture)
        ),
        h('div', { class: 'attribution' }, IGN.attribution),
        progress
    );

    updateUi();

    return {
        el,
        destroy() {
            vp.destroy();
            abort?.abort();
            runSearch.cancel();
            window.removeEventListener('online', onOnline);
            window.removeEventListener('offline', onOnline);
            document.removeEventListener('keydown', onKey);
        }
    };
}
