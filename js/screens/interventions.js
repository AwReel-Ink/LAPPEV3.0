// LAPPEV — Catalogue : interventions, combos et matériel
import { h, toast, openModal, confirmDialog, uuid } from '../util.js';
import { db } from '../db.js';
import { getCatalog, saveCatalog, PALETTE, SYMBOLS, TOOL_CATEGORIES } from '../model.js';
import { badgeSvg, SYMBOL_LABELS } from '../symbols.js';

export async function interventionsScreen() {
    const catalog = await getCatalog();
    const clients = await db.allClients();
    const el = h('div', { class: 'page narrow' });

    const usage = id => {
        let zones = 0; const names = [];
        for (const c of clients) {
            const n = c.views.reduce((s, v) => s + (v.zones || []).filter(z => z.interventionId === id).length, 0);
            if (n) { zones += n; names.push(c.name); }
        }
        return { zones, names };
    };

    async function persist(msg) {
        await saveCatalog(catalog);
        if (msg) toast(msg);
        render();
    }

    function render() {
        el.innerHTML = '';
        el.append(
            h('div', { class: 'page-head' },
                h('div', null,
                    h('h1', { class: 'page-title' }, 'Interventions'),
                    h('p', { class: 'page-sub' }, 'Les types de travaux, leur couleur, leur symbole et le matériel suggéré. Ce catalogue voyage avec le fichier partagé.')),
                h('button', { class: 'btn primary', type: 'button', onClick: () => editIntervention(null) }, '+ Nouvelle intervention')
            )
        );

        const sorted = [...catalog.interventions].sort((a, b) => a.order - b.order);
        const list = h('div', { class: 'it-list' });
        sorted.forEach((it, idx) => {
            const u = usage(it.id);
            const colorName = PALETTE.find(p => p.hex.toLowerCase() === it.color.toLowerCase())?.name || it.color;
            list.appendChild(h('div', { class: 'it-row card' },
                badgeSvg(it, 34),
                h('div', { class: 'it-info' },
                    h('strong', null, it.name),
                    h('div', { class: 'muted small' }, `${colorName} · ${SYMBOL_LABELS[it.symbol] || 'Aucun symbole'} · ${it.tools.length} outil(s) suggéré(s)`),
                    h('div', { class: 'muted small' }, u.zones ? `${u.zones} zone(s) chez ${u.names.length} client(s)` : 'Pas encore utilisée')),
                h('div', { class: 'it-actions' },
                    h('button', { class: 'btn ghost icon', type: 'button', title: 'Monter', disabled: idx === 0, onClick: () => move(sorted, idx, -1) }, '↑'),
                    h('button', { class: 'btn ghost icon', type: 'button', title: 'Descendre', disabled: idx === sorted.length - 1, onClick: () => move(sorted, idx, 1) }, '↓'),
                    h('button', { class: 'btn', type: 'button', onClick: () => editIntervention(it) }, 'Modifier'),
                    h('button', { class: 'btn danger icon', type: 'button', title: 'Supprimer', onClick: () => deleteIntervention(it) }, '🗑️'))
            ));
        });
        el.appendChild(list);

        // Combos
        el.appendChild(h('section', { class: 'card' },
            h('div', { class: 'section-head' },
                h('h2', null, 'Combos'),
                h('button', { class: 'btn', type: 'button', onClick: () => editCombo(null) }, '+ Nouveau combo')),
            h('p', { class: 'muted small' }, 'Raccourcis pour sélectionner plusieurs interventions d’un coup en lecture et à l’impression (ex. « Tonte + Débroussaillage »).'),
            catalog.combos.length
                ? h('div', { class: 'combo-list' }, catalog.combos.map(cb => h('div', { class: 'combo-row' },
                    h('strong', null, cb.name),
                    h('div', { class: 'combo-chips' }, cb.interventionIds.map(id => catalog.interventions.find(i => i.id === id)).filter(Boolean)
                        .map(i => h('span', { class: 'it-chip' }, badgeSvg(i, 16), i.name))),
                    h('div', { class: 'it-actions' },
                        h('button', { class: 'btn', type: 'button', onClick: () => editCombo(cb) }, 'Modifier'),
                        h('button', { class: 'btn danger icon', type: 'button', title: 'Supprimer', onClick: () => deleteCombo(cb) }, '🗑️')))))
                : h('p', { class: 'muted' }, 'Aucun combo pour le moment.')
        ));

        // Matériel personnalisé
        const custom = catalog.tools.filter(t => t.custom);
        el.appendChild(h('section', { class: 'card' },
            h('div', { class: 'section-head' },
                h('h2', null, 'Matériel'),
                h('button', { class: 'btn', type: 'button', onClick: () => editTool(null) }, '+ Ajouter un outil')),
            h('p', { class: 'muted small' }, `${catalog.tools.length - custom.length} outils par défaut (dont la tondeuse ramasseuse) et ${custom.length} outil(s) ajouté(s). Les quantités se règlent dans chaque fiche client.`),
            custom.length
                ? h('div', { class: 'tool-list' }, custom.map(t => h('div', { class: 'tool-row' },
                    h('span', null, t.motorise ? '⛽ ' : '🧹 ', t.name, h('span', { class: 'muted small' }, ` · ${TOOL_CATEGORIES.find(c => c.id === t.cat)?.label || ''}`)),
                    h('div', { class: 'it-actions' },
                        h('button', { class: 'btn', type: 'button', onClick: () => editTool(t) }, 'Modifier'),
                        h('button', { class: 'btn danger icon', type: 'button', title: 'Supprimer', onClick: () => deleteTool(t) }, '🗑️')))))
                : null,
            h('details', { class: 'tool-defaults' },
                h('summary', null, 'Voir la liste par défaut'),
                TOOL_CATEGORIES.filter(c => c.id !== 'perso').map(cat => h('div', { class: 'tool-cat' },
                    h('strong', null, cat.label),
                    h('div', { class: 'muted small' }, catalog.tools.filter(t => t.cat === cat.id && !t.custom).map(t => t.name).join(' · ')))))
        ));
    }

    async function move(sorted, idx, dir) {
        const a = sorted[idx], b = sorted[idx + dir];
        [a.order, b.order] = [b.order, a.order];
        await persist();
    }

    // ------------------------------------------------------------
    async function editIntervention(it) {
        const isNew = !it;
        const draft = it ? structuredClone(it) : {
            id: uuid(), name: '', color: PALETTE.find(p => !catalog.interventions.some(i => i.color.toLowerCase() === p.hex.toLowerCase()))?.hex || PALETTE[0].hex,
            symbol: 'lettre', tools: [], order: Math.max(0, ...catalog.interventions.map(i => i.order)) + 1
        };
        const name = h('input', { type: 'text', value: draft.name, placeholder: 'Ex : Nettoyage de berges' });
        const nameField = h('div', { class: 'field' }, h('label', null, 'Nom *'), name);
        const preview = h('div', { class: 'it-preview' });
        const swatches = h('div', { class: 'swatches' });
        const symbols = h('div', { class: 'symbol-grid' });

        const refresh = () => {
            draft.name = name.value;
            preview.innerHTML = '';
            preview.append(badgeSvg(draft, 44), h('strong', null, draft.name || 'Nouvelle intervention'));
            swatches.innerHTML = '';
            for (const p of PALETTE) {
                const used = catalog.interventions.find(i => i.id !== draft.id && i.color.toLowerCase() === p.hex.toLowerCase());
                swatches.appendChild(h('button', {
                    type: 'button', class: `swatch${draft.color.toLowerCase() === p.hex.toLowerCase() ? ' on' : ''}${used ? ' used' : ''}`,
                    style: { background: p.hex }, title: used ? `${p.name} (déjà prise par ${used.name})` : p.name,
                    onClick: () => { draft.color = p.hex; refresh(); }
                }, used ? '•' : ''));
            }
            symbols.innerHTML = '';
            for (const s of SYMBOLS) {
                symbols.appendChild(h('button', {
                    type: 'button', class: `symbol-btn${draft.symbol === s ? ' on' : ''}`, title: SYMBOL_LABELS[s],
                    onClick: () => { draft.symbol = s; refresh(); }
                }, badgeSvg({ ...draft, symbol: s }, 30), h('span', null, SYMBOL_LABELS[s])));
            }
        };
        name.addEventListener('input', refresh);

        const toolBoxes = TOOL_CATEGORIES.map(cat => {
            const tools = catalog.tools.filter(t => t.cat === cat.id);
            if (!tools.length) return null;
            return h('div', { class: 'tool-check-cat' },
                h('div', { class: 'muted small' }, cat.label),
                h('div', { class: 'tool-checks' }, tools.map(t => h('label', { class: 'check' },
                    h('input', { type: 'checkbox', checked: draft.tools.includes(t.id), onChange: e => {
                        draft.tools = e.target.checked ? [...draft.tools, t.id] : draft.tools.filter(x => x !== t.id);
                    } }),
                    h('span', null, t.name)))));
        });

        refresh();
        const ok = await openModal({
            title: isNew ? 'Nouvelle intervention' : 'Modifier l’intervention',
            wide: true,
            body: h('div', { class: 'it-editor' },
                preview,
                nameField,
                h('div', { class: 'field' }, h('label', null, 'Couleur (palette fixe, pour que tout reste lisible)'), swatches),
                h('div', { class: 'field' }, h('label', null, 'Symbole'), symbols),
                h('div', { class: 'field' }, h('label', null, 'Matériel suggéré (sans quantités)'), h('div', { class: 'tool-check-wrap' }, toolBoxes))
            ),
            actions: [
                { label: 'Annuler', value: false, class: 'ghost' },
                {
                    label: isNew ? 'Créer' : 'Enregistrer', class: 'primary', primary: true,
                    handler: () => {
                        if (!name.value.trim()) { nameField.classList.add('error'); name.focus(); return false; }
                        return true;
                    }
                }
            ],
            onOpen: () => name.focus()
        });
        if (!ok) return;
        draft.name = name.value.trim();
        const clash = catalog.interventions.find(i => i.id !== draft.id && i.color.toLowerCase() === draft.color.toLowerCase());
        if (isNew) catalog.interventions.push(draft);
        else Object.assign(it, draft);
        await persist(isNew ? `✅ « ${draft.name} » ajoutée` : '✏️ Intervention modifiée');
        if (clash) toast(`Attention : même couleur que « ${clash.name} ».`, 'info', 4500);
    }

    async function deleteIntervention(it) {
        const u = usage(it.id);
        const ok = await confirmDialog({
            title: `Supprimer « ${it.name} » ?`,
            message: u.zones
                ? `Elle est utilisée chez : ${u.names.join(', ')}.\nSes ${u.zones} zone(s) seront supprimées chez ces clients.`
                : 'Elle n’est utilisée chez aucun client.',
            okLabel: 'Supprimer', danger: true
        });
        if (!ok) return;
        for (const c of clients) {
            let changed = false;
            for (const v of c.views) {
                const before = (v.zones || []).length;
                v.zones = (v.zones || []).filter(z => z.interventionId !== it.id);
                if (v.zones.length !== before) changed = true;
            }
            if (c.materials?.[it.id]) { delete c.materials[it.id]; changed = true; }
            if (changed) { c.updatedAt = Date.now(); await db.putClient(c); }
        }
        catalog.interventions = catalog.interventions.filter(i => i.id !== it.id);
        for (const cb of catalog.combos) cb.interventionIds = cb.interventionIds.filter(id => id !== it.id);
        await persist('🗑️ Intervention supprimée');
    }

    // ------------------------------------------------------------
    async function editCombo(cb) {
        const draft = cb ? structuredClone(cb) : { id: uuid(), name: '', interventionIds: [] };
        const name = h('input', { type: 'text', value: draft.name, placeholder: 'Ex : Tonte + Débroussaillage' });
        const nameField = h('div', { class: 'field' }, h('label', null, 'Nom *'), name);
        const checks = [...catalog.interventions].sort((a, b) => a.order - b.order).map(it => h('label', { class: 'check big' },
            h('input', { type: 'checkbox', checked: draft.interventionIds.includes(it.id), onChange: e => {
                draft.interventionIds = e.target.checked ? [...draft.interventionIds, it.id] : draft.interventionIds.filter(x => x !== it.id);
                if (!name.value.trim() || name.dataset.auto === '1') {
                    name.value = draft.interventionIds.map(id => catalog.interventions.find(i => i.id === id)?.name).filter(Boolean).join(' + ');
                    name.dataset.auto = '1';
                }
            } }),
            badgeSvg(it, 20), h('span', null, it.name)));
        name.addEventListener('input', () => { name.dataset.auto = '0'; });
        const ok = await openModal({
            title: cb ? 'Modifier le combo' : 'Nouveau combo',
            body: h('div', null, h('div', { class: 'field' }, h('label', null, 'Interventions'), h('div', { class: 'check-list' }, checks)), nameField),
            actions: [
                { label: 'Annuler', value: false, class: 'ghost' },
                {
                    label: 'Enregistrer', class: 'primary', primary: true,
                    handler: () => {
                        if (draft.interventionIds.length < 2) { toast('Choisissez au moins 2 interventions', 'info'); return false; }
                        if (!name.value.trim()) { nameField.classList.add('error'); return false; }
                        return true;
                    }
                }
            ]
        });
        if (!ok) return;
        draft.name = name.value.trim();
        if (cb) Object.assign(cb, draft); else catalog.combos.push(draft);
        await persist('✅ Combo enregistré');
    }

    async function deleteCombo(cb) {
        if (!await confirmDialog({ title: `Supprimer « ${cb.name} » ?`, message: 'Les interventions elles-mêmes ne sont pas supprimées.', okLabel: 'Supprimer', danger: true })) return;
        catalog.combos = catalog.combos.filter(x => x !== cb);
        await persist('🗑️ Combo supprimé');
    }

    // ------------------------------------------------------------
    async function editTool(t) {
        const draft = t ? { ...t } : { id: uuid(), name: '', cat: 'perso', motorise: false, custom: true };
        const name = h('input', { type: 'text', value: draft.name, placeholder: 'Ex : Tondeuse ramasseuse 53 cm' });
        const nameField = h('div', { class: 'field' }, h('label', null, 'Nom *'), name);
        const cat = h('select', null, TOOL_CATEGORIES.map(c => h('option', { value: c.id, selected: c.id === draft.cat }, c.label)));
        const mot = h('input', { type: 'checkbox', checked: draft.motorise });
        const ok = await openModal({
            title: t ? 'Modifier l’outil' : 'Ajouter un outil',
            body: h('div', null, nameField,
                h('div', { class: 'field' }, h('label', null, 'Catégorie'), cat),
                h('label', { class: 'check big' }, mot, h('span', null, 'Matériel motorisé (thermique ou électrique)'))),
            actions: [
                { label: 'Annuler', value: false, class: 'ghost' },
                { label: 'Enregistrer', class: 'primary', primary: true, handler: () => { if (!name.value.trim()) { nameField.classList.add('error'); return false; } return true; } }
            ],
            onOpen: () => name.focus()
        });
        if (!ok) return;
        Object.assign(draft, { name: name.value.trim(), cat: cat.value, motorise: mot.checked });
        if (t) Object.assign(t, draft); else catalog.tools.push(draft);
        await persist('✅ Outil enregistré');
    }

    async function deleteTool(t) {
        if (!await confirmDialog({ title: `Supprimer « ${t.name} » ?`, message: 'Il sera retiré des listes de matériel suggérées. Les quantités déjà saisies chez les clients sont conservées.', okLabel: 'Supprimer', danger: true })) return;
        catalog.tools = catalog.tools.filter(x => x !== t);
        for (const it of catalog.interventions) it.tools = it.tools.filter(id => id !== t.id);
        await persist('🗑️ Outil supprimé');
    }

    render();
    return { el };
}
