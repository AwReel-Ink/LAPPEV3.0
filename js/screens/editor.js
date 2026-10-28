// LAPPEV — Vue d'un chantier : dessin et modification des zones d'intervention
import { h, toast, blobToImage, formatMeters, debounce, uuid, actionSheet, promptDialog, confirmDialog } from '../util.js';
import { db } from '../db.js';
import { saveClient, getCatalog, local } from '../model.js';
import { Viewport, drawScaleBar } from '../viewport.js';
import { IGN, viewSizeMeters } from '../geo.js';
import { drawZones, zoneNumbers, hitZone, interventionOf } from '../render.js';
import { RingEditor, UndoStack } from '../editkit.js';
import { badgeSvg } from '../symbols.js';
import { isMobileUi } from '../uimode.js';

export async function editorScreen({ clientId, viewId }) {
    const client = await db.getClient(clientId);
    const view = client?.views.find(v => v.id === viewId);
    if (!view) {
        toast('Vue introuvable', 'error');
        location.hash = client ? `#/client/${clientId}?tab=vues` : '#/clients';
        return null;
    }
    view.zones = view.zones || [];
    const catalog = await getCatalog();
    const interventions = new Map(catalog.interventions.map(i => [i.id, i]));
    const ordered = () => [...catalog.interventions].sort((a, b) => a.order - b.order);
    const img = await blobToImage(view.image);

    let current = interventions.get(local.get('lastIntervention')) || ordered()[0] || null;
    let selected = null;          // zone sélectionnée
    let mode = 'idle';            // idle | draw | place-parking | place-entree
    const hidden = new Set();     // interventions masquées
    let onlyCurrent = false;
    const undo = new UndoStack();

    const save = debounce(async () => {
        try { await saveClient(client); }
        catch (e) { console.error(e); toast("⚠️ Enregistrement impossible", 'error'); }
    }, 350);

    const snapshot = () => undo.push(JSON.stringify(view.zones));
    const changed = () => { save(); refreshUi(); vp.render(); };

    const visible = z => {
        if (z.kind !== 'polygon') return true;
        if (onlyCurrent && current && z.interventionId !== current.id) return false;
        return !hidden.has(z.interventionId);
    };

    // ------------------------------------------------------------
    const canvas = h('canvas', { 'aria-label': `Vue ${view.name}` });
    const vp = new Viewport(canvas, {
        minScale: 0.02, maxScale: 30,
        onRender: render,
        onResize: first => { if (first) fitImage(); }
    });
    const editor = new RingEditor({
        vp,
        getRings: () => {
            if (!selected || mode !== 'idle') return [];
            return [{ points: selected.points, closed: selected.kind === 'polygon' }];
        },
        color: () => selected ? (selected.kind === 'polygon' ? interventionOf(selected, interventions).color : '#ffffff') : '#e94560',
        onBeforeChange: snapshot,
        onChange: onlySelection => { if (!onlySelection) save(); refreshUi(); },
        onSelectAt: (cp) => {
            if (mode === 'place-parking' || mode === 'place-entree') { placeMarker(cp); return; }
            const z = hitZone(view.zones, cp, 1 / vp.scale, visible);
            selected = z;
            refreshUi();
            vp.render();
        },
        onDraftChange: () => refreshUi()
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
        drawZones(ctx, view.zones, { interventions, unit: 1 / vp.scale, visible, selectedId: selected?.id });
        ctx.restore();
        editor.draw(ctx);
        if (view.geo) drawScaleBar(ctx, vp, view.geo.mPerPx, { bottom: isMobileUi() ? 150 : 16, x: isMobileUi() ? 12 : 250 });
    }

    // ------------------------------------------------------------
    // Actions
    // ------------------------------------------------------------
    function startDraw() {
        if (!current) { toast('Créez d’abord une intervention (menu Interventions).', 'info'); return; }
        selected = null;
        mode = 'draw';
        editor.startDraft({
            closed: true, color: current.color,
            onFinish: points => {
                snapshot();
                const z = { id: uuid(), kind: 'polygon', interventionId: current.id, points: points.map(p => ({ x: p.x, y: p.y })), createdAt: Date.now() };
                view.zones.push(z);
                mode = 'idle';
                const n = zoneNumbers(view.zones).get(z.id);
                toast(`✅ ${current.name} ${n} ajoutée`);
                changed();
            }
        });
        refreshUi();
    }

    function cancelDraw() {
        editor.cancelDraft();
        mode = 'idle';
        refreshUi();
    }

    function startPlace(kind) {
        if (editor.draft) editor.cancelDraft();
        selected = null;
        mode = kind === 'parking' ? 'place-parking' : 'place-entree';
        refreshUi();
        vp.render();
    }

    function placeMarker(cp) {
        snapshot();
        const kind = mode === 'place-parking' ? 'parking' : 'entree';
        const z = { id: uuid(), kind, interventionId: null, points: [{ x: cp.x, y: cp.y }], note: '', createdAt: Date.now() };
        view.zones.push(z);
        mode = 'idle';
        selected = z;
        toast(kind === 'parking' ? '🅿️ Parking placé' : '🚪 Entrée placée');
        changed();
    }

    async function changeIntervention() {
        if (!selected || selected.kind !== 'polygon') return;
        const choice = await actionSheet({
            title: 'Changer l’intervention de la zone',
            actions: ordered().map(i => ({ label: i.name, value: i.id, icon: badgeSvg(i, 22) }))
        });
        if (!choice || choice === selected.interventionId) return;
        snapshot();
        selected.interventionId = choice;
        changed();
    }

    async function deleteSelected() {
        if (!selected) return;
        const label = describe(selected);
        snapshot();
        view.zones = view.zones.filter(z => z !== selected);
        selected = null;
        toast(`🗑️ ${label} supprimé(e) — numéros mis à jour`);
        changed();
    }

    async function editNote() {
        if (!selected || selected.kind !== 'parking') return;
        const note = await promptDialog({ title: 'Note du parking', label: 'Note (facultative)', value: selected.note || '', placeholder: 'Ex : ne gêne pas les livraisons' });
        if (note === null) return;
        snapshot();
        selected.note = note;
        changed();
    }

    function doUndo() {
        if (editor.draft) { editor.undoDraftPoint(); return; }
        const s = undo.pop();
        if (!s) { toast('Rien à annuler', 'info'); return; }
        view.zones = JSON.parse(s);
        selected = null;
        toast(`↩️ Annulé (${undo.size} restant${undo.size > 1 ? 's' : ''})`, 'info', 1600);
        changed();
    }

    function describe(z) {
        const n = zoneNumbers(view.zones).get(z.id);
        if (z.kind === 'parking') return `Parking ${n}`;
        if (z.kind === 'entree') return `Entrée ${n}`;
        return `${interventionOf(z, interventions).name} ${n}`;
    }

    // ------------------------------------------------------------
    // Interface
    // ------------------------------------------------------------
    const itPanel = h('div', { class: 'overlay zone-panel glass' });
    const actionBar = h('div', { class: 'zone-actions' });
    const hint = h('div', { class: 'overlay hint-bubble', hidden: true });
    const undoBtn = h('button', { class: 'btn glass icon', type: 'button', title: 'Annuler (Ctrl+Z)', onClick: doUndo }, '↩️');

    function setCurrent(it) {
        current = it;
        local.set('lastIntervention', it.id);
        if (selected && selected.kind === 'polygon' && selected.interventionId !== it.id) selected = null;
        refreshUi();
        vp.render();
    }

    function refreshUi() {
        const counts = {};
        for (const z of view.zones) if (z.kind === 'polygon') counts[z.interventionId] = (counts[z.interventionId] || 0) + 1;
        const nP = view.zones.filter(z => z.kind === 'parking').length;
        const nE = view.zones.filter(z => z.kind === 'entree').length;

        // Panneau / bandeau des interventions
        itPanel.innerHTML = '';
        if (!isMobileUi()) itPanel.appendChild(h('div', { class: 'zp-title' }, 'Interventions'));
        const list = h('div', { class: 'zp-list' });
        for (const it of ordered()) {
            const isCur = current?.id === it.id;
            list.appendChild(h('div', { class: `zp-item${isCur ? ' on' : ''}${hidden.has(it.id) ? ' off' : ''}` },
                h('button', { class: 'zp-pick', type: 'button', onClick: () => setCurrent(it), title: `Choisir ${it.name}` },
                    badgeSvg(it, isMobileUi() ? 24 : 22), h('span', { class: 'zp-name' }, it.name), counts[it.id] ? h('span', { class: 'zp-count' }, counts[it.id]) : null),
                isMobileUi() ? null : h('button', {
                    class: 'zp-eye', type: 'button', title: hidden.has(it.id) ? 'Afficher' : 'Masquer',
                    onClick: () => { hidden.has(it.id) ? hidden.delete(it.id) : hidden.add(it.id); refreshUi(); vp.render(); }
                }, hidden.has(it.id) ? '🙈' : '👁️')));
        }
        itPanel.appendChild(list);
        itPanel.appendChild(h('label', { class: 'check zp-only' },
            h('input', { type: 'checkbox', checked: onlyCurrent, onChange: e => { onlyCurrent = e.target.checked; refreshUi(); vp.render(); } }),
            h('span', null, isMobileUi() ? 'Seulement celle-ci' : 'Afficher seulement l’intervention choisie')));
        if (!isMobileUi()) {
            itPanel.appendChild(h('div', { class: 'zp-title' }, 'Repères'));
            itPanel.appendChild(h('div', { class: 'muted small' }, `🅿️ ${nP} parking(s) · 🚪 ${nE} entrée(s)`));
            itPanel.appendChild(h('div', { class: 'zp-help muted small' },
                'Clic : poser un point · double-clic ou 1er point : fermer · glisser un point : le déplacer · poignée du milieu : ajouter un point · clic droit sur un point : le supprimer.'));
        }

        // Barre d'actions selon l'état
        actionBar.innerHTML = '';
        hint.hidden = true;
        const btn = (label, onClick, cls = '', extra = {}) => h('button', { class: `btn glass ${cls}`, type: 'button', onClick, ...extra }, label);

        if (mode === 'draw' && editor.draft) {
            const n = editor.draft.points.length;
            hint.hidden = false;
            hint.textContent = n < 3
                ? `${current.name} : touchez la carte pour poser les points (${n}/3 minimum).`
                : `${n} points · touchez le 1er point, double-cliquez ou « Terminer ».`;
            actionBar.append(
                btn('↩️ Point', () => editor.undoDraftPoint(), '', { disabled: !n }),
                btn('✕ Annuler', cancelDraw),
                btn('✅ Terminer', () => { if (!editor.finishDraft()) toast('Il faut au moins 3 points.', 'info'); }, 'primary', { disabled: n < 3 }));
        } else if (mode === 'place-parking' || mode === 'place-entree') {
            hint.hidden = false;
            hint.textContent = mode === 'place-parking' ? '🅿️ Touchez la carte à l’endroit du parking.' : '🚪 Touchez la carte à l’endroit de l’entrée.';
            actionBar.append(btn('✕ Annuler', () => { mode = 'idle'; refreshUi(); }));
        } else if (selected) {
            const it = selected.kind === 'polygon' ? interventionOf(selected, interventions) : null;
            actionBar.append(h('span', { class: 'sel-chip glass' }, it ? badgeSvg(it, 20) : (selected.kind === 'parking' ? '🅿️ ' : '🚪 '), describe(selected),
                selected.kind === 'parking' && selected.note ? h('span', { class: 'muted small' }, ` · ${selected.note}`) : null));
            if (selected.kind === 'polygon') actionBar.append(btn('🎨 Changer', changeIntervention));
            if (selected.kind === 'parking') actionBar.append(btn('📝 Note', editNote));
            if (editor.selectedVertex) actionBar.append(btn('📍 Suppr. point', () => { if (!editor.deleteSelectedVertex()) toast('Une zone garde au moins 3 points.', 'info'); }));
            actionBar.append(btn('🗑️ Supprimer', deleteSelected, 'danger'), btn('✓ OK', () => { selected = null; editor.selectedVertex = null; refreshUi(); vp.render(); }));
        } else {
            actionBar.append(
                h('button', { class: 'btn primary', type: 'button', onClick: startDraw, disabled: !current },
                    '✏️ ', current ? h('span', null, isMobileUi() ? 'Dessiner' : `Dessiner « ${current.name} »`) : 'Dessiner'),
                btn('🅿️ Parking', () => startPlace('parking')),
                btn('🚪 Entrée', () => startPlace('entree')));
        }
        undoBtn.disabled = !undo.size && !editor.draft;
    }

    const onKey = e => {
        if (e.target.matches('input, textarea, select')) return;
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); doUndo(); }
        else if (e.key === 'Enter' && editor.draft) { e.preventDefault(); editor.finishDraft(); }
        else if (e.key === 'Escape') {
            if (editor.draft) cancelDraw();
            else if (mode !== 'idle') { mode = 'idle'; refreshUi(); }
            else if (selected) { selected = null; refreshUi(); vp.render(); }
        }
        else if ((e.key === 'Delete' || e.key === 'Backspace') && selected && mode === 'idle') {
            e.preventDefault();
            if (editor.selectedVertex) editor.deleteSelectedVertex(); else deleteSelected();
        }
    };
    document.addEventListener('keydown', onKey);

    const back = () => { location.hash = `#/client/${client.id}?tab=vues`; };
    const size = viewSizeMeters(view);
    const info = view.source === 'ign'
        ? `≈ ${formatMeters(size.w)} × ${formatMeters(size.h)} · ${Math.round(view.geo.mPerPx * 100)} cm/pixel`
        : 'Image importée · sans échelle';

    const el = h('div', { class: 'stage editor-stage' },
        canvas,
        h('div', { class: 'overlay ov-top' },
            h('button', { class: 'btn glass icon', type: 'button', onClick: back, title: 'Retour', 'aria-label': 'Retour' }, '←'),
            h('div', { class: 'glass title-chip' },
                h('strong', null, view.name), h('span', { class: 'muted small' }, ` · ${client.name}`),
                h('div', { class: 'muted small' }, info)),
            h('div', { class: 'ov-spacer' }),
            undoBtn,
            h('button', { class: 'btn glass', type: 'button', title: 'Lecture chantier', onClick: () => { location.hash = `#/client/${client.id}/lecture?vue=${view.id}`; } }, '📖', h('span', { class: 'hide-xs' }, ' Lecture'))
        ),
        itPanel,
        hint,
        h('div', { class: 'overlay ov-right' },
            h('button', { class: 'btn glass icon', type: 'button', title: 'Zoom avant', onClick: () => vp.zoomBy(1.4) }, '+'),
            h('button', { class: 'btn glass icon', type: 'button', title: 'Zoom arrière', onClick: () => vp.zoomBy(1 / 1.4) }, '−'),
            h('button', { class: 'btn glass icon', type: 'button', title: 'Recentrer', onClick: fitImage }, '⤢'),
            view.source === 'ign' ? h('button', { class: 'btn glass icon', type: 'button', title: 'Recadrer la capture', onClick: () => { location.hash = `#/client/${client.id}/carte?vue=${view.id}`; } }, '🛰️') : null
        ),
        h('div', { class: 'overlay ov-bottom' }, actionBar),
        view.source === 'ign' ? h('div', { class: 'attribution' }, IGN.attribution) : null
    );

    refreshUi();

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
