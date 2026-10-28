// LAPPEV — Métré : carnet de mesures libre (surfaces, exclusions, lignes) avec calcul automatique
import { h, toast, blobToImage, debounce, uuid, promptDialog, confirmDialog, openModal, canvasToBlob, shareOrDownload, safeFileName } from '../util.js';
import { db } from '../db.js';
import { saveClient, PALETTE } from '../model.js';
import { Viewport, drawScaleBar } from '../viewport.js';
import { IGN } from '../geo.js';
import { drawMeasures, measureTotals, shapeMeasure, formatArea, formatLength, pointInPolygon, distToSegment, polygonArea, polylineLength, renderViewCanvas } from '../render.js';
import { RingEditor, UndoStack } from '../editkit.js';
import { isMobileUi } from '../uimode.js';

export async function metreScreen({ clientId, viewId }) {
    const client = await db.getClient(clientId);
    if (!client) { toast('Client introuvable', 'error'); location.hash = '#/clients'; return null; }
    client.measures = client.measures || [];
    const geoViews = client.views.filter(v => v.geo);

    if (!geoViews.length) {
        const el = h('div', { class: 'page narrow' }, h('div', { class: 'empty' },
            h('div', { class: 'ico' }, '📏'),
            h('p', null, h('strong', null, 'Pas de vue avec échelle pour ce chantier.')),
            h('p', null, 'Le métré fonctionne sur les vues capturées depuis la carte IGN (les images importées n’ont pas d’échelle).'),
            h('div', { class: 'toolbar-row' },
                h('button', { class: 'btn primary', type: 'button', onClick: () => { location.hash = `#/client/${client.id}/carte`; } }, '🛰️ Nouvelle vue satellite'),
                h('button', { class: 'btn', type: 'button', onClick: () => { location.hash = `#/client/${client.id}`; } }, 'Retour à la fiche'))));
        return { el };
    }

    let view = geoViews.find(v => v.id === viewId) || geoViews[0];
    let img = await blobToImage(view.image);
    let measure = null;           // mesure sélectionnée
    let shape = null;             // forme sélectionnée
    let tool = null;              // surface | hole | line (pendant un tracé)
    const undo = new UndoStack();

    const viewMeasures = () => client.measures.filter(m => m.viewId === view.id);
    const save = debounce(() => saveClient(client).catch(e => { console.error(e); toast('⚠️ Enregistrement impossible', 'error'); }), 350);
    const snapshot = () => undo.push(JSON.stringify(client.measures));
    const changed = () => { save(); renderPanel(); refreshBar(); vp.render(); };

    // ------------------------------------------------------------
    const canvas = h('canvas', { 'aria-label': 'Vue pour le métré' });
    const vp = new Viewport(canvas, { minScale: 0.02, maxScale: 30, onRender: render, onResize: first => { if (first) fitImage(); } });
    const editor = new RingEditor({
        vp,
        getRings: () => {
            if (!shape || tool) return [];
            return [{ points: shape.points, closed: shape.type === 'surface' }, ...(shape.holes || []).map(hole => ({ points: hole, closed: true }))];
        },
        color: () => measure?.color || '#e94560',
        onBeforeChange: snapshot,
        onChange: only => { if (!only) save(); renderPanel(); refreshBar(); },
        onSelectAt: cp => selectAt(cp),
        onDraftChange: () => { refreshBar(); }
    });
    vp.handler = editor.handler();

    function fitImage() {
        vp.minScale = 0.02;
        vp.fit(0, 0, img.naturalWidth, img.naturalHeight, 0.95);
        vp.minScale = vp.scale * 0.5;
    }

    function render(ctx) {
        ctx.save();
        ctx.translate(vp.tx, vp.ty);
        ctx.scale(vp.scale, vp.scale);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0);
        drawMeasures(ctx, viewMeasures(), { unit: 1 / vp.scale, mPerPx: view.geo.mPerPx, selectedMeasureId: measure?.id, selectedShape: shape });
        ctx.restore();
        editor.draw(ctx);
        drawScaleBar(ctx, vp, view.geo.mPerPx, { bottom: isMobileUi() ? 84 : 16 });
    }

    function selectAt(cp) {
        const unit = 1 / vp.scale;
        const ms = viewMeasures();
        const order = measure ? [measure, ...ms.filter(m => m !== measure)] : ms;
        for (const m of order) {
            for (const sh of [...(m.shapes || [])].reverse()) {
                if (sh.type === 'line') {
                    for (let i = 1; i < sh.points.length; i++) {
                        if (distToSegment(cp, sh.points[i - 1], sh.points[i]) <= 12 * unit) { measure = m; shape = sh; return afterSelect(); }
                    }
                } else if (sh.points.length >= 3 && pointInPolygon(cp, sh.points) && !(sh.holes || []).some(hh => hh.length >= 3 && pointInPolygon(cp, hh))) {
                    measure = m; shape = sh; return afterSelect();
                }
            }
        }
        shape = null;
        afterSelect();
    }

    function afterSelect() { renderPanel(); refreshBar(); vp.render(); }

    function startTool(t) {
        if (!measure) { toast('Créez ou choisissez d’abord une mesure.', 'info'); return; }
        if (t === 'hole' && (!shape || shape.type !== 'surface')) { toast('Touchez d’abord la surface où retirer une partie.', 'info', 3500); return; }
        tool = t;
        const target = shape;
        if (t !== 'hole') shape = null;
        editor.startDraft({
            closed: t !== 'line', color: t === 'hole' ? '#ffffff' : measure.color,
            onFinish: points => {
                snapshot();
                const pts = points.map(p => ({ x: p.x, y: p.y }));
                if (t === 'hole') {
                    target.holes = target.holes || [];
                    target.holes.push(pts);
                    shape = target;
                    toast('✂️ Partie retirée de la surface');
                } else {
                    const sh = { id: uuid(), type: t === 'line' ? 'line' : 'surface', points: pts, holes: [] };
                    measure.shapes.push(sh);
                    shape = sh;
                    const v = shapeMeasure(sh, view.geo.mPerPx);
                    toast(`✅ ${sh.type === 'line' ? formatLength(v.length) : formatArea(v.area)} ajouté à « ${measure.name} »`);
                }
                tool = null;
                changed();
            }
        });
        refreshBar();
    }

    function cancelTool() { editor.cancelDraft(); tool = null; refreshBar(); }

    function doUndo() {
        if (editor.draft) { editor.undoDraftPoint(); return; }
        const s = undo.pop();
        if (!s) { toast('Rien à annuler', 'info'); return; }
        const ids = { m: measure?.id };
        client.measures = JSON.parse(s);
        measure = client.measures.find(m => m.id === ids.m) || null;
        shape = null;
        toast('↩️ Annulé', 'info', 1400);
        changed();
    }

    async function newMeasure() {
        const name = await promptDialog({ title: 'Nouvelle mesure', label: 'Ce que vous mesurez', placeholder: 'Ex : Pelouse principale, Haie route…', required: true, okLabel: 'Créer' });
        if (!name) return;
        snapshot();
        const used = new Set(viewMeasures().map(m => m.color));
        // couleurs bien visibles sur l'herbe en premier
        const pref = ['bleu', 'orange', 'rose', 'jaune', 'violet', 'cyan', 'rouge', 'indigo', 'lime', 'marron', 'gris', 'vert'].map(id => PALETTE.find(p => p.id === id));
        const color = (pref.find(p => !used.has(p.hex)) || pref[client.measures.length % pref.length]).hex;
        measure = { id: uuid(), viewId: view.id, name, color, note: '', shapes: [] };
        client.measures.push(measure);
        shape = null;
        changed();
        toast('Choisissez « Surface » ou « Ligne » pour mesurer.', 'info', 3500);
    }

    async function editMeasure(m) {
        const name = h('input', { type: 'text', value: m.name });
        const note = h('textarea', { rows: 3, placeholder: 'Note libre (ex : surface annoncée par le client : 1 500 m²)' });
        note.value = m.note || '';
        let color = m.color;
        const sw = h('div', { class: 'swatches' });
        const drawSw = () => { sw.innerHTML = ''; PALETTE.forEach(p => sw.appendChild(h('button', { type: 'button', class: `swatch${p.hex === color ? ' on' : ''}`, style: { background: p.hex }, title: p.name, onClick: () => { color = p.hex; drawSw(); } }))); };
        drawSw();
        const ok = await openModal({
            title: 'Modifier la mesure',
            body: h('div', null, h('div', { class: 'field' }, h('label', null, 'Nom'), name), h('div', { class: 'field' }, h('label', null, 'Couleur'), sw), h('div', { class: 'field' }, h('label', null, 'Note'), note)),
            actions: [{ label: 'Annuler', value: false, class: 'ghost' }, { label: 'Enregistrer', value: true, class: 'primary', primary: true }]
        });
        if (!ok) return;
        snapshot();
        Object.assign(m, { name: name.value.trim() || m.name, note: note.value, color });
        changed();
    }

    async function deleteMeasure(m) {
        if (!await confirmDialog({ title: `Supprimer « ${m.name} » ?`, message: 'La mesure et toutes ses formes seront supprimées.', okLabel: 'Supprimer', danger: true })) return;
        snapshot();
        client.measures = client.measures.filter(x => x !== m);
        if (measure === m) { measure = null; shape = null; }
        changed();
    }

    function deleteShape() {
        if (!shape || !measure) return;
        snapshot();
        measure.shapes = measure.shapes.filter(s => s !== shape);
        shape = null;
        changed();
    }

    function clearHoles() {
        if (!shape?.holes?.length) return;
        snapshot();
        shape.holes = [];
        changed();
    }

    // ------------------------------------------------------------
    // Panneau
    // ------------------------------------------------------------
    const panel = h('aside', { class: 'lec-panel metre-panel' });
    function renderPanel() {
        const mp = view.geo.mPerPx;
        panel.innerHTML = '';
        panel.appendChild(h('div', { class: 'lec-head' },
            h('button', { class: 'btn ghost icon', type: 'button', title: 'Retour', 'aria-label': 'Retour', onClick: () => { location.hash = `#/client/${client.id}`; } }, '←'),
            h('div', { class: 'lec-title' }, h('h1', null, 'Métré'), h('div', { class: 'muted' }, client.name))));
        if (geoViews.length > 1) {
            panel.appendChild(h('div', { class: 'seg view-seg-panel' }, geoViews.map(v => h('button', {
                type: 'button', class: v === view ? 'on' : '',
                onClick: async () => { if (v === view) return; if (editor.draft) cancelTool(); view = v; img = await blobToImage(v.image); measure = null; shape = null; fitImage(); renderPanel(); refreshBar(); }
            }, v.name))));
        }
        panel.appendChild(h('button', { class: 'btn primary wide', type: 'button', onClick: newMeasure }, '+ Nouvelle mesure'));

        const ms = viewMeasures();
        const list = h('div', { class: 'measure-list' });
        if (!ms.length) list.appendChild(h('p', { class: 'muted' }, 'Aucune mesure. Exemple : « Pelouse principale », puis tracez la surface.'));
        let tA = 0, tL = 0;
        for (const m of ms) {
            const t = measureTotals(m, mp);
            tA += t.area; tL += t.length;
            const parts = [t.area ? formatArea(t.area) : null, t.length ? formatLength(t.length) : null].filter(Boolean).join(' + ') || '—';
            list.appendChild(h('div', { class: `measure-row${measure === m ? ' on' : ''}`, onClick: () => { measure = m; shape = null; afterSelect(); } },
                h('span', { class: 'm-dot', style: { background: m.color } }),
                h('div', { class: 'm-info' }, h('strong', null, m.name), h('div', { class: 'small' }, parts), m.note ? h('div', { class: 'muted small' }, m.note) : null),
                h('button', { class: 'btn ghost icon', type: 'button', title: 'Modifier', onClick: e => { e.stopPropagation(); editMeasure(m); } }, '✏️'),
                h('button', { class: 'btn ghost icon', type: 'button', title: 'Supprimer', onClick: e => { e.stopPropagation(); deleteMeasure(m); } }, '🗑️')));
        }
        panel.appendChild(list);
        if (ms.length) {
            panel.appendChild(h('section', { class: 'lec-section recap' },
                h('h2', null, 'Récapitulatif'),
                h('table', { class: 'recap-table' },
                    h('thead', null, h('tr', null, h('th', null, 'Mesure'), h('th', null, 'Surface'), h('th', null, 'Longueur'))),
                    h('tbody', null, ms.map(m => { const t = measureTotals(m, mp); return h('tr', null, h('td', null, h('span', { class: 'm-dot', style: { background: m.color } }), m.name), h('td', null, t.area ? formatArea(t.area) : '—'), h('td', null, t.length ? formatLength(t.length) : '—')); })),
                    h('tfoot', null, h('tr', null, h('td', null, 'Total'), h('td', null, tA ? formatArea(tA) : '—'), h('td', null, tL ? formatLength(tL) : '—'))))));
            panel.appendChild(h('button', { class: 'btn wide', type: 'button', onClick: exportImage }, '📤 Exporter en image'));
        }
        panel.appendChild(h('p', { class: 'hint' }, `Calcul à partir de l’échelle de la vue (${Math.round(mp * 100)} cm/pixel). Précision de l’ordre de quelques pourcents.`));
    }

    // ------------------------------------------------------------
    // Barre d'outils
    // ------------------------------------------------------------
    const bar = h('div', { class: 'zone-actions' });
    const hint = h('div', { class: 'overlay hint-bubble', hidden: true });
    const undoBtn = h('button', { class: 'btn glass icon', type: 'button', title: 'Annuler (Ctrl+Z)', onClick: doUndo }, '↩️');

    function draftInfo() {
        const d = editor.draft;
        if (!d) return '';
        const mp = view.geo.mPerPx;
        const pts = d.points;
        if (pts.length < 2) return tool === 'line' ? 'Touchez la carte pour poser les points de la ligne.' : 'Touchez la carte pour poser les coins.';
        const last = Math.hypot(pts.at(-1).x - pts.at(-2).x, pts.at(-1).y - pts.at(-2).y) * mp;
        if (tool === 'line') return `Longueur : ${formatLength(polylineLength(pts) * mp)} · dernier segment ${formatLength(last)}`;
        const area = pts.length >= 3 ? formatArea(polygonArea(pts) * mp * mp) : '—';
        return `${tool === 'hole' ? 'Partie retirée' : 'Surface'} : ${area} · dernier côté ${formatLength(last)}`;
    }

    function refreshBar() {
        bar.innerHTML = '';
        hint.hidden = true;
        const btn = (label, onClick, cls = '', extra = {}) => h('button', { class: `btn glass ${cls}`, type: 'button', onClick, ...extra }, label);
        if (editor.draft) {
            const d = editor.draft;
            hint.hidden = false;
            hint.textContent = draftInfo();
            bar.append(btn('↩️ Point', () => editor.undoDraftPoint(), '', { disabled: !d.points.length }), btn('✕ Annuler', cancelTool),
                btn('✅ Terminer', () => { if (!editor.finishDraft()) toast(tool === 'line' ? 'Il faut au moins 2 points.' : 'Il faut au moins 3 points.', 'info'); }, 'primary', { disabled: d.points.length < d.minPoints }));
        } else if (shape) {
            const v = shapeMeasure(shape, view.geo.mPerPx);
            bar.append(h('span', { class: 'sel-chip glass' }, h('span', { class: 'm-dot', style: { background: measure.color } }), `${measure.name} · ${shape.type === 'line' ? formatLength(v.length) : formatArea(v.area)}`));
            if (shape.type === 'surface') bar.append(btn('✂️ Retirer une partie', () => startTool('hole')));
            if (shape.holes?.length) bar.append(btn('↺ Retirer les exclusions', clearHoles));
            if (editor.selectedVertex) bar.append(btn('📍 Suppr. point', () => { if (!editor.deleteSelectedVertex()) toast('Impossible : trop peu de points.', 'info'); }));
            bar.append(btn('🗑️ Supprimer', deleteShape, 'danger'), btn('✓ OK', () => { shape = null; editor.selectedVertex = null; refreshBar(); vp.render(); }));
        } else if (measure) {
            bar.append(h('span', { class: 'sel-chip glass' }, h('span', { class: 'm-dot', style: { background: measure.color } }), measure.name),
                btn('⬛ Surface', () => startTool('surface'), 'primary'), btn('〰️ Ligne', () => startTool('line')));
        } else {
            bar.append(h('span', { class: 'glass info-chip' }, viewMeasures().length ? 'Choisissez une mesure dans la liste, ou créez-en une.' : 'Commencez par « + Nouvelle mesure ».'));
        }
        undoBtn.disabled = !undo.size && !editor.draft;
        vp.render();
    }

    // ------------------------------------------------------------
    async function exportImage() {
        const mp = view.geo.mPerPx;
        const ms = viewMeasures();
        const base = renderViewCanvas(img, { maxSide: 2200, draw: (ctx, unit) => drawMeasures(ctx, ms, { unit, mPerPx: mp }) });
        const rowH = 38, head = 90;
        const out = document.createElement('canvas');
        out.width = Math.max(base.width, 900);
        out.height = head + base.height + 30 + (ms.length + 2) * rowH;
        const ctx = out.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, out.width, out.height);
        ctx.fillStyle = '#16213e'; ctx.fillRect(0, 0, out.width, head);
        ctx.fillStyle = '#ffffff'; ctx.font = '800 30px Arial'; ctx.textBaseline = 'top';
        ctx.fillText(`Métré — ${client.name}`, 20, 14);
        ctx.font = '20px Arial'; ctx.fillStyle = '#c9d1e6';
        ctx.fillText(`${[client.address, client.city].filter(Boolean).join(', ')} · ${view.name} · ${new Date().toLocaleDateString('fr-FR')}`, 20, 54);
        ctx.drawImage(base, 0, head);
        let y = head + base.height + 20;
        ctx.textBaseline = 'middle';
        const cols = [20, out.width * 0.55, out.width * 0.78];
        ctx.font = '700 20px Arial'; ctx.fillStyle = '#16213e';
        ['Mesure', 'Surface', 'Longueur'].forEach((t, i) => ctx.fillText(t, cols[i], y + rowH / 2));
        y += rowH;
        let tA = 0, tL = 0;
        ctx.font = '20px Arial';
        for (const m of ms) {
            const t = measureTotals(m, mp); tA += t.area; tL += t.length;
            ctx.fillStyle = m.color; ctx.fillRect(cols[0], y + 10, 18, 18);
            ctx.fillStyle = '#222';
            ctx.fillText(m.name, cols[0] + 28, y + rowH / 2);
            ctx.fillText(t.area ? formatArea(t.area) : '—', cols[1], y + rowH / 2);
            ctx.fillText(t.length ? formatLength(t.length) : '—', cols[2], y + rowH / 2);
            ctx.strokeStyle = '#ddd'; ctx.beginPath(); ctx.moveTo(20, y + rowH); ctx.lineTo(out.width - 20, y + rowH); ctx.stroke();
            y += rowH;
        }
        ctx.font = '800 20px Arial'; ctx.fillStyle = '#16213e';
        ctx.fillText('Total', cols[0], y + rowH / 2);
        ctx.fillText(tA ? formatArea(tA) : '—', cols[1], y + rowH / 2);
        ctx.fillText(tL ? formatLength(tL) : '—', cols[2], y + rowH / 2);
        ctx.font = '12px Arial'; ctx.fillStyle = '#888';
        ctx.fillText(`${IGN.attribution} · Échelle ${Math.round(mp * 100)} cm/pixel`, 20, out.height - 10);
        const blob = await canvasToBlob(out, 'image/jpeg', 0.88);
        const res = await shareOrDownload(blob, `Metre-${safeFileName(client.name)}-${new Date().toISOString().slice(0, 10)}.jpg`, `Métré — ${client.name}`);
        if (res === 'downloaded') toast('📥 Image du métré téléchargée');
    }

    const onKey = e => {
        if (e.target.matches('input, textarea, select')) return;
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); doUndo(); }
        else if (e.key === 'Enter' && editor.draft) { e.preventDefault(); editor.finishDraft(); }
        else if (e.key === 'Escape') { if (editor.draft) cancelTool(); else if (shape) { shape = null; refreshBar(); } }
        else if ((e.key === 'Delete' || e.key === 'Backspace') && shape && !editor.draft) { e.preventDefault(); editor.selectedVertex ? editor.deleteSelectedVertex() : deleteShape(); }
    };
    document.addEventListener('keydown', onKey);

    const stage = h('div', { class: 'stage lec-stage' },
        canvas,
        h('div', { class: 'overlay ov-top' }, h('div', { class: 'ov-spacer' }), undoBtn),
        hint,
        h('div', { class: 'overlay ov-right' },
            h('button', { class: 'btn glass icon', type: 'button', title: 'Zoom avant', onClick: () => vp.zoomBy(1.4) }, '+'),
            h('button', { class: 'btn glass icon', type: 'button', title: 'Zoom arrière', onClick: () => vp.zoomBy(1 / 1.4) }, '−'),
            h('button', { class: 'btn glass icon', type: 'button', title: 'Recentrer', onClick: fitImage }, '⤢')),
        h('div', { class: 'overlay ov-bottom' }, bar),
        h('div', { class: 'attribution' }, IGN.attribution));

    const el = h('div', { class: 'lecture metre' }, panel, stage);
    renderPanel();
    refreshBar();

    return {
        el,
        async destroy() {
            vp.destroy();
            editor.destroy();
            document.removeEventListener('keydown', onKey);
            await save.flush();
        }
    };
}
