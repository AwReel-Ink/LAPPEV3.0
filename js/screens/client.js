// LAPPEV — Fiche client : informations, vues satellite, photos de repérage
import { h, toast, debounce, formatDate, blobUrl, pickFiles, compressImage, confirmDialog, promptDialog, openModal, uuid, formatMeters } from '../util.js';
import { db } from '../db.js';
import { saveClient, getCatalog, TOOL_CATEGORIES } from '../model.js';
import { viewSizeMeters } from '../geo.js';
import { badgeSvg } from '../symbols.js';
import { printMonitorSheet, printWorkerSheet } from '../print.js';

const TABS = [
    { id: 'fiche', label: 'Fiche', icon: '👤' },
    { id: 'vues', label: 'Vues', icon: '🛰️' },
    { id: 'photos', label: 'Photos de repérage', short: 'Photos', icon: '📷' },
    { id: 'interventions', label: 'Interventions & matériel', short: 'Interventions', icon: '🎨' },
    { id: 'lecture', label: 'Lecture', icon: '📖', route: 'lecture' },
    { id: 'metre', label: 'Métré', icon: '📏', route: 'metre' },
    { id: 'imprimer', label: 'Imprimer', icon: '🖨️' }
];

export async function clientScreen({ clientId, tab }) {
    const client = await db.getClient(clientId);
    if (!client) {
        toast('Client introuvable', 'error');
        location.hash = '#/clients';
        return null;
    }
    let current = TABS.some(t => t.id === tab && !t.route) ? tab : 'fiche';
    const catalog = await getCatalog();
    const interventions = new Map(catalog.interventions.map(i => [i.id, i]));
    const ordered = () => [...catalog.interventions].sort((a, b) => a.order - b.order);
    const toolsById = new Map(catalog.tools.map(t => [t.id, t]));
    client.materials = client.materials || {};

    const title = h('h1', { class: 'client-title' }, client.name);
    const status = h('span', { class: 'save-status' });
    const body = h('div', { class: 'tab-body' });
    const tabBar = h('div', { class: 'tabs', role: 'tablist' });

    const doSave = debounce(async () => {
        try {
            await saveClient(client);
            setStatus('Enregistré ✓', 'saved');
        } catch (e) {
            console.error(e);
            setStatus("Erreur d'enregistrement", 'error');
            toast("⚠️ Enregistrement impossible : l'espace de stockage est peut-être plein.", 'error', 5000);
        }
    }, 450);

    function setStatus(text, cls = '') {
        status.textContent = text;
        status.className = `save-status ${cls}`;
    }

    async function saveNow(msg) {
        doSave.cancel();
        await saveClient(client);
        setStatus('Enregistré ✓', 'saved');
        if (msg) toast(msg);
    }

    function renderTabs() {
        tabBar.innerHTML = '';
        for (const t of TABS) {
            tabBar.appendChild(h('button', {
                class: `tab${t.id === current ? ' active' : ''}`,
                type: 'button', role: 'tab',
                onClick: () => {
                    if (t.route) { location.hash = `#/client/${client.id}/${t.route}`; return; }
                    current = t.id;
                    history.replaceState(null, '', `#/client/${client.id}?tab=${t.id}`);
                    renderTabs();
                    renderBody();
                }
            }, h('span', { class: 'tab-ico' }, t.icon), h('span', { class: 'tab-label' }, t.short || t.label)));
        }
    }

    function renderBody() {
        body.innerHTML = '';
        if (current === 'fiche') body.appendChild(renderFiche());
        if (current === 'vues') body.appendChild(renderViews());
        if (current === 'photos') body.appendChild(renderPhotos());
        if (current === 'interventions') body.appendChild(renderInterventions());
        if (current === 'imprimer') body.appendChild(renderPrint());
    }

    // ------------------------------------------------------------
    // Interventions & matériel du chantier
    // ------------------------------------------------------------
    function zoneCounts() {
        const counts = {};
        for (const v of client.views) for (const z of v.zones || []) if (z.kind === 'polygon') counts[z.interventionId] = (counts[z.interventionId] || 0) + 1;
        return counts;
    }

    function renderInterventions() {
        const wrap = h('div', { class: 'interventions-tab' });
        const counts = zoneCounts();

        // Vues et zones
        wrap.appendChild(h('h2', { class: 'section-title' }, '1. Zones de travail'));
        if (!client.views.length) {
            wrap.appendChild(h('div', { class: 'empty small' }, h('p', null, 'Créez d’abord une vue dans l’onglet « Vues ».')));
        } else {
            const grid = h('div', { class: 'zone-views' });
            for (const v of client.views) {
                const per = {};
                for (const z of v.zones || []) if (z.kind === 'polygon') per[z.interventionId] = (per[z.interventionId] || 0) + 1;
                const nP = (v.zones || []).filter(z => z.kind === 'parking').length;
                const nE = (v.zones || []).filter(z => z.kind === 'entree').length;
                grid.appendChild(h('div', { class: 'zone-view card' },
                    h('div', { class: 'zv-thumb', style: { backgroundImage: `url("${blobUrl(v.image)}")` } }),
                    h('div', { class: 'zv-body' },
                        h('strong', null, v.name),
                        h('div', { class: 'combo-chips' },
                            Object.keys(per).length ? Object.entries(per).map(([id, n]) => {
                                const it = interventions.get(id) || { name: 'Supprimée', color: '#999', symbol: 'aucun' };
                                return h('span', { class: 'it-chip' }, badgeSvg(it, 16), `${it.name} × ${n}`);
                            }) : h('span', { class: 'muted small' }, 'Aucune zone dessinée'),
                            nP ? h('span', { class: 'it-chip' }, `🅿️ × ${nP}`) : null,
                            nE ? h('span', { class: 'it-chip' }, `🚪 × ${nE}`) : null),
                        h('button', { class: 'btn primary', type: 'button', onClick: () => { location.hash = `#/client/${client.id}/vue/${v.id}`; } }, '✏️ Dessiner les zones'))));
            }
            wrap.appendChild(grid);
        }

        // Matériel
        wrap.appendChild(h('h2', { class: 'section-title' }, '2. Matériel du chantier'));
        wrap.appendChild(h('p', { class: 'page-sub' }, 'Les quantités habituelles pour ce client, par intervention (par exemple pour 12 travailleurs : 6 débroussailleuses, 4 tondeuses mulching, 2 ramasseuses).'));
        const usedIds = ordered().map(i => i.id).filter(id => counts[id] || client.materials[id]);
        for (const id of Object.keys(client.materials)) if (!usedIds.includes(id) && !interventions.has(id)) delete client.materials[id];
        if (!usedIds.length) wrap.appendChild(h('p', { class: 'muted' }, 'Dessinez des zones, ou ajoutez une intervention ci-dessous pour préparer son matériel.'));
        for (const id of usedIds) wrap.appendChild(materialCard(interventions.get(id), counts[id] || 0));

        const others = ordered().filter(i => !usedIds.includes(i.id));
        if (others.length) {
            const sel = h('select', { class: 'input', onChange: e => {
                if (!e.target.value) return;
                client.materials[e.target.value] = client.materials[e.target.value] || {};
                setStatus('Modification…'); doSave(); renderBody();
            } }, h('option', { value: '' }, '+ Préparer le matériel d’une autre intervention…'), others.map(i => h('option', { value: i.id }, i.name)));
            wrap.appendChild(h('div', { class: 'toolbar-row' }, sel));
        }
        wrap.appendChild(h('div', { class: 'epi-note' }, '⚠️ Portez les EPI adaptés aux outils sélectionnés.'));
        return wrap;
    }

    function materialCard(it, nZones) {
        const mat = client.materials[it.id] || {};
        const ids = [...new Set([...it.tools, ...Object.keys(mat)])];
        const rows = h('div', { class: 'mat-rows' });
        const total = () => Object.values(client.materials[it.id] || {}).reduce((s, n) => s + n, 0);
        const totalEl = h('span', { class: 'muted small' });
        const updTotal = () => { totalEl.textContent = `${total()} outil(s) prévu(s)`; };
        for (const tid of ids) {
            const t = toolsById.get(tid) || { name: 'Outil supprimé du catalogue', motorise: false };
            const input = h('input', { type: 'number', min: 0, max: 99, inputmode: 'numeric', class: 'qty', value: mat[tid] || 0 });
            const set = v => {
                v = Math.max(0, Math.min(99, parseInt(v, 10) || 0));
                input.value = v;
                client.materials[it.id] = client.materials[it.id] || {};
                if (v > 0) client.materials[it.id][tid] = v; else delete client.materials[it.id][tid];
                row.classList.toggle('zero', !v);
                updTotal(); setStatus('Modification…'); doSave();
            };
            input.addEventListener('change', () => set(input.value));
            const row = h('div', { class: `mat-row${mat[tid] ? '' : ' zero'}` },
                h('span', { class: 'mat-name' }, t.motorise ? '⛽ ' : '🧹 ', t.name),
                h('div', { class: 'stepper' },
                    h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Moins', onClick: () => set((+input.value || 0) - 1) }, '−'),
                    input,
                    h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Plus', onClick: () => set((+input.value || 0) + 1) }, '+')));
            rows.appendChild(row);
        }
        const addSel = h('select', { class: 'input add-tool', onChange: e => {
            const tid = e.target.value;
            if (!tid) return;
            client.materials[it.id] = client.materials[it.id] || {};
            client.materials[it.id][tid] = 1;
            setStatus('Modification…'); doSave(); renderBody();
        } }, h('option', { value: '' }, '+ Ajouter un outil…'),
            TOOL_CATEGORIES.map(cat => {
                const tools = catalog.tools.filter(t => t.cat === cat.id && !ids.includes(t.id));
                return tools.length ? h('optgroup', { label: cat.label }, tools.map(t => h('option', { value: t.id }, t.name))) : null;
            }));
        updTotal();
        return h('section', { class: 'card mat-card' },
            h('div', { class: 'section-head' },
                h('div', { class: 'mat-title' }, badgeSvg(it, 28), h('div', null, h('strong', null, it.name), h('div', { class: 'muted small' }, `${nZones} zone(s) · `, totalEl)))),
            rows,
            h('div', { class: 'toolbar-row' }, addSel));
    }

    // ------------------------------------------------------------
    // Impression
    // ------------------------------------------------------------
    function renderPrint() {
        const counts = zoneCounts();
        const present = ordered().filter(i => counts[i.id]);
        const chosen = new Set(present.map(i => i.id));
        const wrap = h('div', { class: 'print-tab' });
        if (!present.length) {
            wrap.appendChild(h('div', { class: 'empty small' }, h('div', { class: 'ico' }, '🖨️'), h('p', null, 'Dessinez d’abord des zones d’intervention pour pouvoir imprimer.')));
            return wrap;
        }
        const checks = h('div', { class: 'check-list' });
        const renderChecks = () => {
            checks.innerHTML = '';
            for (const it of present) checks.appendChild(h('label', { class: 'check big' },
                h('input', { type: 'checkbox', checked: chosen.has(it.id), onChange: e => { e.target.checked ? chosen.add(it.id) : chosen.delete(it.id); } }),
                badgeSvg(it, 22), h('span', null, `${it.name} (${counts[it.id]} zone${counts[it.id] > 1 ? 's' : ''})`)));
        };
        renderChecks();
        const combos = catalog.combos.filter(cb => cb.interventionIds.some(id => counts[id]));
        const go = async kind => {
            if (!chosen.size) { toast('Choisissez au moins une intervention', 'info'); return; }
            await doSave.flush();
            const ids = present.filter(i => chosen.has(i.id)).map(i => i.id);
            try {
                if (kind === 'monitor') await printMonitorSheet(client, catalog, ids);
                else await printWorkerSheet(client, catalog, ids);
            } catch (e) { console.error(e); toast(`Impression impossible : ${e.message}`, 'error'); }
        };
        wrap.append(
            h('section', { class: 'card' },
                h('h2', null, 'Interventions à imprimer'),
                combos.length ? h('div', { class: 'combo-chips' }, h('span', { class: 'muted small' }, 'Combos : '), combos.map(cb => h('button', {
                    class: 'btn', type: 'button', onClick: () => { chosen.clear(); cb.interventionIds.filter(id => counts[id]).forEach(id => chosen.add(id)); renderChecks(); }
                }, cb.name))) : null,
                checks),
            h('div', { class: 'print-choices' },
                h('button', { class: 'print-choice card', type: 'button', onClick: () => go('monitor') },
                    h('span', { class: 'ico' }, '📋'), h('strong', null, 'Fiche moniteur'),
                    h('span', { class: 'muted small' }, 'Une page par vue avec toutes les infos client, la légende numérotée et les photos, puis la page matériel.')),
                h('button', { class: 'print-choice card', type: 'button', onClick: () => go('workers') },
                    h('span', { class: 'ico' }, '👷'), h('strong', null, 'Fiche travailleurs'),
                    h('span', { class: 'muted small' }, 'A4 paysage, une page par intervention : couleur, symbole, numéros en grand, cases à cocher, photo de repérage. Sans coordonnées du client.'))),
            h('p', { class: 'hint' }, 'Astuce : dans la fenêtre d’impression, choisissez « Enregistrer en PDF » pour obtenir un fichier à envoyer.'));
        return wrap;
    }

    // ------------------------------------------------------------
    // Fiche
    // ------------------------------------------------------------
    function renderFiche() {
        const field = (key, label, attrs = {}, span2 = false) => {
            const isArea = attrs.textarea;
            const input = isArea
                ? h('textarea', { rows: 4, placeholder: attrs.placeholder || '' })
                : h('input', { type: attrs.type || 'text', placeholder: attrs.placeholder || '', inputmode: attrs.inputmode, autocomplete: 'off' });
            input.value = client[key] || '';
            const wrap = h('div', { class: `field${span2 ? ' span-2' : ''}` }, h('label', null, label), input);
            input.addEventListener('input', () => {
                const v = input.value;
                if (key === 'name') {
                    if (!v.trim()) { wrap.classList.add('error'); setStatus('Le nom est obligatoire', 'error'); return; }
                    wrap.classList.remove('error');
                    title.textContent = v.trim();
                    client.name = v.trim();
                } else {
                    client[key] = v;
                }
                setStatus('Modification…');
                doSave();
            });
            return wrap;
        };

        const loc = client.location;
        return h('div', { class: 'fiche' },
            h('div', { class: 'form-grid' },
                field('name', 'Nom du client *', { placeholder: 'Ex : Mairie de Vernon' }, true),
                field('phone', 'Téléphone', { type: 'tel', inputmode: 'tel', placeholder: '06 00 00 00 00' }),
                field('email', 'Email', { type: 'email', inputmode: 'email', placeholder: 'contact@mail.fr' }),
                field('address', 'Adresse', { placeholder: '12 rue des Fleurs' }),
                field('city', 'Ville', { placeholder: '27200 Vernon' }),
                field('accessCode', "Code d'accès", { placeholder: 'Digicode, badge, boîte à clés…' }, true),
                field('notes', 'Notes', { textarea: true, placeholder: 'Prendre les clés avec le porte-clé vert…' }, true)
            ),
            h('div', { class: 'info-box' },
                h('div', null, '📍 ', loc
                    ? `Position du chantier enregistrée (${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}). Elle servira à l'itinéraire.`
                    : "Position du chantier : elle sera enregistrée automatiquement lors de la première capture satellite."),
                h('div', { class: 'muted small' }, `Créé ${formatDate(client.createdAt)} · modifié ${formatDate(client.updatedAt)}`)
            ),
            h('div', { class: 'danger-zone' },
                h('button', { class: 'btn danger', type: 'button', onClick: deleteClient }, '🗑️ Supprimer ce client')
            )
        );
    }

    async function deleteClient() {
        const ok = await confirmDialog({
            title: 'Supprimer ce client ?',
            message: `« ${client.name} » sera supprimé de cet appareil, avec ses vues, ses zones et ses photos.\nCette action est définitive.`,
            okLabel: 'Supprimer', danger: true
        });
        if (!ok) return;
        doSave.cancel();
        await db.deleteClient(client.id);
        toast('🗑️ Client supprimé');
        location.hash = '#/clients';
    }

    // ------------------------------------------------------------
    // Vues
    // ------------------------------------------------------------
    function renderViews() {
        const wrap = h('div', { class: 'views' });
        wrap.appendChild(h('div', { class: 'add-tiles' },
            h('button', { class: 'add-tile primary-tile', type: 'button', onClick: () => { location.hash = `#/client/${client.id}/carte`; } },
                h('span', { class: 'ico' }, '🛰️'),
                h('span', null, h('strong', null, 'Nouvelle vue satellite'), h('span', null, 'Carte IGN : tracez le rectangle du chantier puis capturez (internet requis).'))
            ),
            h('button', { class: 'add-tile', type: 'button', onClick: importView },
                h('span', { class: 'ico' }, '🖼️'),
                h('span', null, h('strong', null, 'Importer une image'), h('span', null, 'En secours : capture faite ailleurs. Pas de mesures possibles (pas d\'échelle).'))
            )
        ));

        if (!client.views.length) {
            wrap.appendChild(h('div', { class: 'empty small' },
                h('p', null, 'Aucune vue pour ce chantier.'),
                h('p', { class: 'muted' }, 'Commencez par « Nouvelle vue satellite ».')));
            return wrap;
        }
        const grid = h('div', { class: 'view-grid' });
        client.views.forEach((v, i) => grid.appendChild(viewCard(v, i)));
        wrap.appendChild(grid);
        return wrap;
    }

    function viewCard(v) {
        const size = viewSizeMeters(v);
        const meta = v.source === 'ign'
            ? `≈ ${formatMeters(size.w)} × ${formatMeters(size.h)} · ${Math.round(v.geo.mPerPx * 100)} cm/pixel`
            : `Image importée · ${v.width} × ${v.height} px · sans échelle`;
        const open = () => { location.hash = `#/client/${client.id}/vue/${v.id}`; };
        return h('div', { class: 'view-card' },
            h('div', { class: 'view-thumb', style: { backgroundImage: `url("${blobUrl(v.image)}")` }, onClick: open, role: 'button', title: 'Ouvrir' },
                h('span', { class: `badge ${v.source === 'ign' ? 'ign' : 'imp'}` }, v.source === 'ign' ? 'IGN' : 'Import')),
            h('div', { class: 'view-body' },
                h('div', { class: 'view-name' }, v.name),
                h('div', { class: 'view-meta' }, meta),
                h('div', { class: 'view-meta' }, `${v.source === 'ign' ? 'Capturée' : 'Importée'} ${formatDate(v.capturedAt)}`)
            ),
            h('div', { class: 'view-actions' },
                h('button', { class: 'btn primary', type: 'button', onClick: open }, 'Ouvrir'),
                v.source === 'ign'
                    ? h('button', { class: 'btn', type: 'button', title: 'Refaire la capture avec un nouveau cadrage', onClick: () => { location.hash = `#/client/${client.id}/carte?vue=${v.id}`; } }, 'Recadrer')
                    : null,
                h('button', { class: 'btn', type: 'button', onClick: () => renameView(v) }, 'Renommer'),
                h('button', { class: 'btn danger icon', type: 'button', title: 'Supprimer', 'aria-label': 'Supprimer la vue', onClick: () => deleteView(v) }, '🗑️')
            )
        );
    }

    async function renameView(v) {
        const name = await promptDialog({ title: 'Renommer la vue', label: 'Nom', value: v.name, required: true });
        if (!name) return;
        v.name = name;
        await saveNow('✏️ Vue renommée');
        renderBody();
    }

    async function deleteView(v) {
        const nz = v.zones?.length || 0;
        const ok = await confirmDialog({
            title: 'Supprimer cette vue ?',
            message: `« ${v.name} » sera supprimée${nz ? ` avec ses ${nz} zone(s)` : ''}.`,
            okLabel: 'Supprimer', danger: true
        });
        if (!ok) return;
        client.views = client.views.filter(x => x !== v);
        client.measures = (client.measures || []).filter(m => m.viewId !== v.id);
        await saveNow('🗑️ Vue supprimée');
        renderBody();
    }

    async function importView() {
        const files = await pickFiles({ accept: 'image/*', multiple: true });
        if (!files.length) return;
        setStatus('Import en cours…');
        let n = 0;
        for (const f of files) {
            try {
                const { blob, width, height } = await compressImage(f, { maxSide: 4000, quality: 0.85 });
                client.views.push({
                    id: uuid(), name: client.views.length ? `Vue ${client.views.length + 1}` : 'Vue principale',
                    source: 'import', image: blob, width, height, geo: null, capturedAt: Date.now(), zones: []
                });
                n++;
            } catch (e) {
                console.error(e);
                toast(`Image illisible : ${f.name}`, 'error');
            }
        }
        if (n) {
            await saveNow(`🖼️ ${n} image(s) importée(s)`);
            renderBody();
        }
    }

    // ------------------------------------------------------------
    // Photos de repérage
    // ------------------------------------------------------------
    function renderPhotos() {
        const wrap = h('div', { class: 'photos' },
            h('p', { class: 'page-sub' }, "Ajoutez des images pour aider à trouver le chantier : capture Street View de la porte, du portail ou de la rue. Elles apparaîtront en lecture et sur la fiche des travailleurs."),
            h('div', { class: 'toolbar-row' },
                h('button', { class: 'btn primary', type: 'button', onClick: addPhotos }, '+ Ajouter des photos'))
        );
        if (!client.photos.length) {
            wrap.appendChild(h('div', { class: 'empty small' }, h('div', { class: 'ico' }, '📷'), h('p', null, 'Aucune photo de repérage.')));
            return wrap;
        }
        const grid = h('div', { class: 'photo-grid' });
        for (const p of client.photos) {
            const url = blobUrl(p.image);
            const caption = h('input', { type: 'text', class: 'input', placeholder: 'Légende (ex : portail vert)', value: p.caption || '' });
            caption.addEventListener('input', () => { p.caption = caption.value; setStatus('Modification…'); doSave(); });
            grid.appendChild(h('div', { class: 'photo-card' },
                h('img', { src: url, alt: p.caption || 'Photo de repérage', loading: 'lazy', onClick: () => showPhoto(url, p.caption) }),
                h('div', { class: 'photo-body' },
                    caption,
                    h('button', { class: 'btn danger icon', type: 'button', title: 'Supprimer', 'aria-label': 'Supprimer la photo', onClick: () => deletePhoto(p) }, '🗑️'))
            ));
        }
        wrap.appendChild(grid);
        return wrap;
    }

    function showPhoto(url, caption) {
        openModal({
            title: caption || 'Photo de repérage', wide: true,
            body: h('img', { src: url, class: 'photo-full', alt: caption || '' }),
            actions: [{ label: 'Fermer', value: null, class: 'ghost' }]
        });
    }

    async function addPhotos() {
        const files = await pickFiles({ accept: 'image/*', multiple: true });
        if (!files.length) return;
        let n = 0;
        for (const f of files) {
            try {
                const { blob } = await compressImage(f, { maxSide: 1600, quality: 0.82 });
                client.photos.push({ id: uuid(), image: blob, caption: '', addedAt: Date.now() });
                n++;
            } catch (e) {
                console.error(e);
                toast(`Image illisible : ${f.name}`, 'error');
            }
        }
        if (n) {
            await saveNow(`📷 ${n} photo(s) ajoutée(s)`);
            renderBody();
        }
    }

    async function deletePhoto(p) {
        const ok = await confirmDialog({ title: 'Supprimer cette photo ?', message: p.caption || 'La photo sera supprimée.', okLabel: 'Supprimer', danger: true });
        if (!ok) return;
        client.photos = client.photos.filter(x => x !== p);
        await saveNow('🗑️ Photo supprimée');
        renderBody();
    }

    // ------------------------------------------------------------
    const el = h('div', { class: 'page client-page' },
        h('div', { class: 'client-head' },
            h('button', { class: 'btn ghost icon', type: 'button', title: 'Retour aux clients', 'aria-label': 'Retour', onClick: () => { location.hash = '#/clients'; } }, '←'),
            title,
            status
        ),
        tabBar,
        body
    );
    renderTabs();
    renderBody();

    return {
        el,
        async destroy() { await doSave.flush(); }
    };
}
