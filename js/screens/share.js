// LAPPEV — Partage : export du fichier unique, import, fusion, copie de sécurité
import { h, toast, formatBytes, formatDate, pickFiles, openModal, confirmDialog, promptDialog, downloadBlob } from '../util.js';
import { db } from '../db.js';
import { local } from '../model.js';
import {
    buildExport, estimateSize, markExported, readImportFile, planMerge, applyMerge, applyReplace,
    getBackupInfo, restoreBackup, deleteBackup
} from '../exchange.js';

export async function shareScreen() {
    const el = h('div', { class: 'page narrow' });
    let prepared = null;

    async function render() {
        const clients = await db.allClients();
        const backup = await getBackupInfo();
        const last = local.get('lastExportAt', null);
        el.innerHTML = '';
        el.append(
            h('h1', { class: 'page-title' }, 'Partage'),
            h('p', { class: 'page-sub' }, 'Toute la bibliothèque tient dans un seul fichier, à envoyer aux collègues puis à fusionner. Pas de serveur : le fichier passe de main en main.')
        );

        // --- Export
        const exportBox = h('div', { class: 'export-result' });
        const prepBtn = h('button', {
            class: 'btn primary', type: 'button', disabled: !clients.length,
            onClick: async () => {
                prepBtn.disabled = true;
                prepBtn.textContent = 'Préparation…';
                try {
                    prepared = await buildExport((i, n) => { prepBtn.textContent = `Préparation… ${i}/${n}`; });
                    renderPrepared();
                } catch (e) {
                    console.error(e);
                    toast(`Export impossible : ${e.message}`, 'error', 6000);
                } finally {
                    prepBtn.disabled = false;
                    prepBtn.textContent = '📦 Préparer le fichier';
                }
            }
        }, '📦 Préparer le fichier');

        function renderPrepared() {
            exportBox.innerHTML = '';
            if (!prepared) return;
            const file = new File([prepared.blob], prepared.name, { type: 'application/json' });
            const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
            exportBox.append(
                h('div', { class: 'file-card' }, h('span', { class: 'ico' }, '📄'),
                    h('div', null, h('strong', null, prepared.name), h('div', { class: 'muted small' }, `${prepared.count} client(s) · ${formatBytes(prepared.blob.size)}`))),
                h('div', { class: 'toolbar-row' },
                    canShare ? h('button', {
                        class: 'btn primary', type: 'button',
                        onClick: async () => {
                            try { await navigator.share({ files: [file], title: prepared.name }); markExported(); toast('📤 Fichier partagé'); render(); }
                            catch (e) { if (e.name !== 'AbortError') toast('Partage impossible, utilisez « Télécharger ».', 'error'); }
                        }
                    }, '📤 Partager (Quick Share…)') : null,
                    h('button', { class: 'btn', type: 'button', onClick: () => { downloadBlob(prepared.blob, prepared.name); markExported(); toast('⬇️ Fichier téléchargé'); setTimeout(render, 300); } }, '⬇️ Télécharger'),
                    h('a', { class: 'btn ghost', href: 'https://pairdrop.net/', target: '_blank', rel: 'noopener' }, '↗ Ouvrir PairDrop')),
                h('p', { class: 'hint' }, canShare
                    ? '« Partager » ouvre le menu de l’appareil : choisissez Quick Share (Android) ou une autre appli. Pour PairDrop : téléchargez le fichier, ouvrez pairdrop.net sur les deux appareils et envoyez-le.'
                    : 'Téléchargez le fichier, puis envoyez-le avec PairDrop (ouvrez pairdrop.net sur les deux appareils), une clé USB ou un dossier partagé.'));
        }

        el.appendChild(h('section', { class: 'card' },
            h('h2', null, '1. Exporter ma bibliothèque'),
            h('dl', { class: 'kv' },
                h('dt', null, 'Clients'), h('dd', null, String(clients.length)),
                h('dt', null, 'Taille estimée'), h('dd', null, formatBytes(estimateSize(clients))),
                h('dt', null, 'Dernier export'), h('dd', null, last ? formatDate(last) : 'jamais')),
            h('div', { class: 'toolbar-row' }, prepBtn),
            exportBox));
        renderPrepared();

        // --- Import
        el.appendChild(h('section', { class: 'card' },
            h('h2', null, '2. Recevoir le fichier d’un collègue'),
            h('p', { class: 'muted small' }, 'Choisissez un fichier LAPPEV-…clients-….json. Vous pourrez le fusionner avec votre bibliothèque (recommandé) ou la remplacer.'),
            h('button', { class: 'btn primary', type: 'button', onClick: importFlow }, '📂 Choisir un fichier .json')));

        // --- Copie de sécurité
        el.appendChild(h('section', { class: 'card' },
            h('h2', null, 'Copie de sécurité'),
            backup
                ? h('div', null,
                    h('p', null, `Copie automatique faite ${formatDate(backup.at)} (${backup.reason}) : ${backup.count} client(s).`),
                    h('div', { class: 'toolbar-row' },
                        h('button', {
                            class: 'btn', type: 'button', onClick: async () => {
                                if (!await confirmDialog({ title: 'Revenir à la copie de sécurité ?', message: 'La bibliothèque actuelle sera remplacée par celle d’avant la dernière fusion ou le dernier remplacement.', okLabel: 'Restaurer', danger: true })) return;
                                const n = await restoreBackup();
                                toast(`↩️ Bibliothèque restaurée (${n} clients)`);
                                render();
                            }
                        }, '↩️ Annuler la dernière fusion'),
                        h('button', { class: 'btn ghost', type: 'button', onClick: async () => { await deleteBackup(); toast('Copie supprimée'); render(); } }, 'Supprimer la copie')))
                : h('p', { class: 'muted' }, 'Une copie est faite automatiquement avant chaque fusion ou remplacement.')));
    }

    async function importFlow() {
        const [file] = await pickFiles({ accept: '.json,application/json' });
        if (!file) return;
        let data;
        try { data = await readImportFile(file); }
        catch (e) { toast(e.message, 'error', 7000); return; }
        const choice = await openModal({
            title: 'Fichier reçu',
            body: h('div', null,
                h('div', { class: 'file-card' }, h('span', { class: 'ico' }, '📄'),
                    h('div', null, h('strong', null, file.name),
                        h('div', { class: 'muted small' }, `${data.clients.length} client(s) · exporté ${formatDate(data.exportedAt)} · LAPPEV ${data.appVersion || ''}`))),
                h('p', null, '« Fusionner » ajoute les nouveaux clients et vous demande quoi faire en cas de doublon. « Remplacer » efface votre bibliothèque et la remplace par celle du fichier.')),
            actions: [
                { label: 'Annuler', value: null, class: 'ghost' },
                { label: '♻️ Remplacer', value: 'replace', class: 'danger' },
                { label: '🔀 Fusionner', value: 'merge', class: 'primary', primary: true }
            ]
        });
        if (choice === 'merge') await mergeFlow(data);
        if (choice === 'replace') await replaceFlow(data);
        render();
    }

    async function replaceFlow(data) {
        if (!await confirmDialog({ title: 'Remplacer toute la bibliothèque ?', message: `Vos clients actuels seront remplacés par les ${data.clients.length} client(s) du fichier.\nUne copie de sécurité est faite avant.`, okLabel: 'Continuer', danger: true })) return;
        const word = await promptDialog({ title: 'Confirmation', message: 'Tapez REMPLACER pour confirmer.', placeholder: 'REMPLACER', okLabel: 'Remplacer' });
        if (word !== 'REMPLACER') { if (word !== null) toast('Mot incorrect : rien n’a été remplacé.', 'info'); return; }
        const n = await applyReplace(data);
        toast(`♻️ Bibliothèque remplacée (${n} clients)`);
    }

    async function mergeFlow(data) {
        const localClients = await db.allClients();
        const items = planMerge(localClients, data.clients);
        const decide = items.filter(i => i.type === 'conflict' || i.type === 'duplicate');
        const nNew = items.filter(i => i.type === 'new').length;
        const nSame = items.filter(i => i.type === 'same').length;

        const rows = decide.map((it, idx) => {
            const name = `d${idx}`;
            const opt = (value, label, hint) => h('label', { class: 'radio' },
                h('input', { type: 'radio', name, value, checked: it.choice === value, onChange: () => { it.choice = value; } }),
                h('span', null, h('strong', null, label), hint ? h('span', { class: 'muted small' }, ` — ${hint}`) : null));
            const card = side => h('div', { class: 'dup-side' },
                h('div', { class: 'muted small' }, side === 'local' ? 'Ma fiche' : 'Fiche reçue'),
                h('strong', null, (side === 'local' ? it.local : it.inc).name),
                h('div', { class: 'small' }, [(side === 'local' ? it.local : it.inc).address, (side === 'local' ? it.local : it.inc).city].filter(Boolean).join(', ') || '—'),
                h('div', { class: 'muted small' }, `modifiée ${formatDate((side === 'local' ? it.local : it.inc).updatedAt)} · ${(side === 'local' ? it.local : it.inc).views.length} vue(s)`));
            return h('div', { class: 'dup-item' },
                h('div', { class: 'dup-reason' }, it.type === 'conflict' ? '⚠️ ' : '🔎 ', it.reasons.join(' · ')),
                h('div', { class: 'dup-sides' }, card('local'), card('inc')),
                h('div', { class: 'dup-choices' },
                    opt('mine', 'Garder la mienne', 'la fiche reçue est ignorée'),
                    opt('theirs', 'Garder la reçue', 'elle remplace la mienne'),
                    opt('both', 'Garder les deux', it.type === 'duplicate' ? 'ex. deux voisins d’un même immeuble' : 'la reçue devient une nouvelle fiche')));
        });

        const ok = await openModal({
            title: 'Fusion des bibliothèques',
            wide: true,
            body: h('div', null,
                h('div', { class: 'merge-summary' },
                    h('div', null, h('strong', null, String(nNew)), h('span', null, 'nouveau(x) client(s)')),
                    h('div', null, h('strong', null, String(nSame)), h('span', null, 'déjà identique(s)')),
                    h('div', null, h('strong', null, String(decide.length)), h('span', null, 'à vérifier'))),
                decide.length ? h('p', null, 'Pour chaque cas, choisissez ce qu’il faut garder :') : h('p', null, 'Aucun doublon détecté.'),
                rows,
                h('p', { class: 'hint' }, 'Une copie de sécurité de votre bibliothèque est faite avant la fusion (onglet Partage → Annuler la dernière fusion).')),
            actions: [
                { label: 'Annuler', value: false, class: 'ghost' },
                { label: '🔀 Fusionner', value: true, class: 'primary', primary: true }
            ]
        });
        if (!ok) return;
        try {
            const r = await applyMerge(data, items);
            toast(`🔀 Fusion terminée : ${r.added} ajouté(s), ${r.updated} remplacé(s), ${r.both} gardé(s) en double, ${r.kept} inchangé(s).`, 'ok', 6000);
            if (r.addedInterventions.length) toast(`Nouvelles interventions : ${r.addedInterventions.join(', ')}`, 'info', 6000);
            if (r.colorClashes.length) toast(`Couleurs en double : ${r.colorClashes.join(' ; ')} (modifiables dans Interventions)`, 'info', 7000);
        } catch (e) {
            console.error(e);
            toast(`Fusion impossible : ${e.message}`, 'error', 7000);
        }
    }

    await render();
    return { el };
}
