// LAPPEV — Bibliothèque clients (écran d'accueil)
import { h, toast, normalize, formatDate, blobUrl, openModal, confirmDialog, actionSheet } from '../util.js';
import { db } from '../db.js';
import { createClient, duplicateClient, local } from '../model.js';
import { backupReminder } from '../exchange.js';

export async function libraryScreen() {
    const clients = await db.allClients();
    let query = sessionStorage.getItem('lappev31.query') || '';
    let sort = local.get('sort', 'name');

    const listBox = h('div', { class: 'client-list' });
    const countEl = h('span', { class: 'page-count' });

    const search = h('input', {
        type: 'search', class: 'input search-input', placeholder: 'Rechercher un nom, une adresse, une ville…', value: query,
        onInput: e => { query = e.target.value; sessionStorage.setItem('lappev31.query', query); renderList(); }
    });
    const sortSel = h('select', {
        class: 'input sort-select', 'aria-label': 'Trier',
        onChange: e => { sort = e.target.value; local.set('sort', sort); renderList(); }
    },
        h('option', { value: 'name', selected: sort === 'name' }, 'Trier par nom'),
        h('option', { value: 'city', selected: sort === 'city' }, 'Trier par ville'),
        h('option', { value: 'updated', selected: sort === 'updated' }, 'Derniers modifiés')
    );

    const el = h('div', { class: 'page' },
        h('div', { class: 'page-head' },
            h('div', null,
                h('h1', { class: 'page-title' }, 'Clients ', countEl),
                h('p', { class: 'page-sub' }, 'Tous les chantiers enregistrés sur cet appareil.')
            ),
            h('button', { class: 'btn primary', type: 'button', onClick: newClientFlow }, '+ Nouveau client')
        ),
        reminderBanner(),
        h('div', { class: 'toolbar-row' }, search, sortSel),
        listBox
    );

    function reminderBanner() {
        const r = backupReminder(clients);
        if (!r) return null;
        const box = h('div', { class: 'reminder' },
            h('span', null, '💾 ', r.never ? 'Aucun export n’a encore été fait. ' : `Dernier export il y a ${r.elapsed} jours. `, 'Pensez à exporter la bibliothèque pour la sauvegarder et la partager.'),
            h('a', { class: 'btn primary', href: '#/partage' }, 'Exporter'),
            h('button', { class: 'btn ghost icon', type: 'button', title: 'Plus tard', onClick: () => { local.set('reminderSnooze', Date.now() + 3 * 86400000); box.remove(); } }, '✕'));
        return box;
    }

    function sorted(list) {
        const byName = (a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
        if (sort === 'city') return list.sort((a, b) => (a.city || '').localeCompare(b.city || '', 'fr', { sensitivity: 'base' }) || byName(a, b));
        if (sort === 'updated') return list.sort((a, b) => b.updatedAt - a.updatedAt);
        return list.sort(byName);
    }

    function renderList() {
        listBox.innerHTML = '';
        countEl.textContent = clients.length ? `(${clients.length})` : '';
        if (!clients.length) {
            listBox.appendChild(h('div', { class: 'empty' },
                h('div', { class: 'ico' }, '🌿'),
                h('p', null, h('strong', null, 'Aucun client pour le moment.')),
                h('p', null, 'Créez votre premier chantier : nom, adresse, puis la vue satellite.'),
                h('button', { class: 'btn primary', type: 'button', onClick: newClientFlow }, '+ Créer un client')
            ));
            return;
        }
        const q = normalize(query);
        const list = sorted(clients.filter(c => !q || normalize(`${c.name} ${c.address} ${c.city}`).includes(q)));
        if (!list.length) {
            listBox.appendChild(h('div', { class: 'empty small' }, h('p', null, `Aucun client ne correspond à « ${query} ».`)));
            return;
        }
        for (const c of list) listBox.appendChild(card(c));
    }

    function card(c) {
        const first = c.views?.[0];
        const thumb = h('div', { class: 'client-thumb' });
        if (first?.image) thumb.style.backgroundImage = `url("${blobUrl(first.image)}")`;
        else thumb.textContent = '🗺️';
        const open = () => { location.hash = `#/client/${c.id}`; };
        const nViews = c.views?.length || 0, nPhotos = c.photos?.length || 0;
        return h('div', { class: 'client-card', role: 'button', tabindex: '0', onClick: open, onKeydown: e => { if (e.key === 'Enter') open(); } },
            thumb,
            h('div', { class: 'client-info' },
                h('div', { class: 'client-name' }, c.name),
                h('div', { class: 'client-meta' }, [c.address, c.city].filter(Boolean).join(' · ') || 'Adresse non renseignée'),
                h('div', { class: 'client-badges' },
                    h('span', { class: 'chip' }, `${nViews} vue${nViews > 1 ? 's' : ''}`),
                    nPhotos ? h('span', { class: 'chip' }, `${nPhotos} photo${nPhotos > 1 ? 's' : ''}`) : null,
                    h('span', { class: 'chip muted' }, `modifié ${formatDate(c.updatedAt, false)}`)
                )
            ),
            h('button', {
                class: 'btn ghost icon card-menu', type: 'button', title: 'Actions', 'aria-label': `Actions pour ${c.name}`,
                onClick: e => { e.stopPropagation(); menu(c); }
            }, '⋯')
        );
    }

    async function menu(c) {
        const choice = await actionSheet({
            title: c.name,
            actions: [
                { label: 'Ouvrir la fiche', value: 'open', icon: '📋' },
                { label: 'Lecture sur chantier', value: 'read', icon: '📖' },
                { label: 'Imprimer', value: 'print', icon: '🖨️' },
                { label: 'Nouvelle vue satellite (IGN)', value: 'map', icon: '🛰️' },
                { label: 'Dupliquer', value: 'dup', icon: '📄' },
                { label: 'Supprimer', value: 'del', icon: '🗑️', class: 'danger' }
            ]
        });
        if (choice === 'open') location.hash = `#/client/${c.id}`;
        if (choice === 'map') location.hash = `#/client/${c.id}/carte`;
        if (choice === 'read') location.hash = `#/client/${c.id}/lecture`;
        if (choice === 'print') location.hash = `#/client/${c.id}?tab=imprimer`;
        if (choice === 'dup') {
            const full = await db.getClient(c.id);
            const d = duplicateClient(full);
            await db.putClient(d);
            clients.push(d);
            renderList();
            toast(`📄 « ${d.name} » créé`);
        }
        if (choice === 'del') {
            const ok = await confirmDialog({
                title: 'Supprimer ce client ?',
                message: `« ${c.name} » sera supprimé de cet appareil, avec ses vues, ses zones et ses photos.\nCette action est définitive.`,
                okLabel: 'Supprimer', danger: true
            });
            if (!ok) return;
            await db.deleteClient(c.id);
            clients.splice(clients.indexOf(c), 1);
            renderList();
            toast('🗑️ Client supprimé');
        }
    }

    renderList();
    return { el };
}

export async function newClientFlow() {
    const name = h('input', { type: 'text', placeholder: 'Ex : Mairie de Vernon', autocomplete: 'off' });
    const address = h('input', { type: 'text', placeholder: '12 rue des Fleurs', autocomplete: 'off' });
    const city = h('input', { type: 'text', placeholder: '27200 Vernon', autocomplete: 'off' });
    const nameField = h('div', { class: 'field' }, h('label', null, 'Nom du client *'), name);
    const body = h('div', null,
        nameField,
        h('div', { class: 'field' }, h('label', null, 'Adresse'), address),
        h('div', { class: 'field' }, h('label', null, 'Ville'), city),
        h('p', { class: 'hint' }, "L'adresse sert à centrer la carte satellite. Le reste de la fiche se complète ensuite.")
    );
    const created = await openModal({
        title: 'Nouveau client',
        body,
        actions: [
            { label: 'Annuler', value: null, class: 'ghost' },
            {
                label: 'Créer', class: 'primary', primary: true,
                handler: async () => {
                    if (!name.value.trim()) { nameField.classList.add('error'); name.focus(); return false; }
                    return await createClient({ name: name.value, address: address.value, city: city.value });
                }
            }
        ],
        onOpen: () => name.focus()
    });
    if (created) {
        toast(`✅ « ${created.name} » créé`);
        location.hash = `#/client/${created.id}?tab=vues`;
    }
}
