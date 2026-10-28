// LAPPEV — Réglages de l'appareil
import { h, toast, formatBytes, formatDate, confirmDialog, promptDialog } from '../util.js';
import { db, storageStatus, requestPersistence } from '../db.js';
import { local } from '../model.js';
import { getUiMode, setUiMode } from '../uimode.js';
import { IGN } from '../geo.js';

export async function settingsScreen() {
    const el = h('div', { class: 'page narrow' },
        h('h1', { class: 'page-title' }, 'Réglages'),
        h('p', { class: 'page-sub' }, 'Ces réglages concernent uniquement cet appareil.')
    );

    // --- Interface
    const mode = getUiMode();
    const opt = (id, ico, title, text) => h('button', {
        class: `choice${mode === id ? ' on' : ''}`, type: 'button',
        onClick: () => { if (getUiMode() !== id) setUiMode(id); }
    }, h('span', { class: 'ico' }, ico), h('span', null, h('strong', null, title), h('span', { class: 'muted small' }, text)));

    el.appendChild(h('section', { class: 'card settings-section' },
        h('h2', null, 'Interface'),
        h('div', { class: 'choices' },
            opt('pc', '🖥️', 'PC', 'Souris et clavier, barre de menu en haut.'),
            opt('mobile', '📱', 'Tablette / Smartphone', 'Gros boutons, menu en bas, gestes tactiles.')
        ),
        h('p', { class: 'hint' }, 'Vous pouvez aussi changer avec le bouton en haut à droite.')
    ));

    // --- Stockage
    const st = await storageStatus();
    const count = await db.countClients();
    const persistLine = h('div', { class: st.persisted ? 'ok' : 'warn' },
        st.persisted ? '✅ Stockage persistant actif : le navigateur ne videra pas vos données.'
            : st.supported ? '⚠️ Stockage non persistant : le navigateur pourrait effacer les données s’il manque de place.'
                : '⚠️ Ce navigateur ne permet pas de protéger le stockage. Faites des exports réguliers.');
    const persistBtn = !st.persisted && st.supported ? h('button', {
        class: 'btn', type: 'button',
        onClick: async () => {
            const ok = await requestPersistence();
            toast(ok ? '✅ Stockage persistant accordé' : 'Le navigateur a refusé pour le moment. Installez l’appli sur l’écran d’accueil puis réessayez.', ok ? 'ok' : 'info', 5000);
            if (ok) { persistLine.className = 'ok'; persistLine.textContent = '✅ Stockage persistant actif : le navigateur ne videra pas vos données.'; persistBtn.remove(); }
        }
    }, 'Demander le stockage persistant') : null;

    el.appendChild(h('section', { class: 'card settings-section' },
        h('h2', null, 'Stockage'),
        persistLine,
        persistBtn,
        h('dl', { class: 'kv' },
            h('dt', null, 'Clients enregistrés'), h('dd', null, String(count)),
            h('dt', null, 'Espace utilisé'), h('dd', null, isFinite(st.usage) ? `${formatBytes(st.usage)}${isFinite(st.quota) ? ` sur ${formatBytes(st.quota)} disponibles` : ''}` : '—')
        ),
        h('p', { class: 'hint' }, 'Sur iPhone et iPad, installez LAPPEV sur l’écran d’accueil (Partager → « Sur l’écran d’accueil ») pour que les données soient conservées.')
    ));

    // --- Sauvegarde
    const days = local.get('backupReminderDays', 30);
    const lastExport = local.get('lastExportAt', null);
    const sel = h('select', {
        class: 'input', onChange: e => { local.set('backupReminderDays', +e.target.value); toast('Rappel enregistré'); }
    }, [7, 14, 30, 60, 90].map(d => h('option', { value: d, selected: d === days }, `Tous les ${d} jours`)));
    el.appendChild(h('section', { class: 'card settings-section' },
        h('h2', null, 'Sauvegarde'),
        h('div', { class: 'field' }, h('label', null, 'Me rappeler de faire un export'), sel),
        h('dl', { class: 'kv' }, h('dt', null, 'Dernier export'), h('dd', null, lastExport ? formatDate(lastExport) : 'jamais')),
        h('a', { class: 'btn', href: '#/partage' }, '🔄 Aller au partage (export / import)')
    ));

    // --- Version
    const checkBtn = h('button', {
        class: 'btn', type: 'button',
        onClick: async () => {
            const reg = await navigator.serviceWorker?.getRegistration();
            if (!reg) { toast('Mises à jour indisponibles dans ce navigateur', 'info'); return; }
            checkBtn.disabled = true;
            try { await reg.update(); toast('Vérification faite. Si une version est disponible, un bandeau vous proposera de recharger.', 'info', 4500); }
            catch { toast('Vérification impossible (hors ligne ?)', 'error'); }
            finally { checkBtn.disabled = false; }
        }
    }, 'Rechercher une mise à jour');
    el.appendChild(h('section', { class: 'card settings-section' },
        h('h2', null, 'Version'),
        h('dl', { class: 'kv' },
            h('dt', null, 'Application'), h('dd', null, `LAPPEV ${self.LAPPEV_VERSION}`),
            h('dt', null, 'Build'), h('dd', null, self.LAPPEV_BUILD),
            h('dt', null, 'Contenu'), h('dd', null, self.LAPPEV_STAGE)
        ),
        checkBtn
    ));

    // --- Données
    el.appendChild(h('section', { class: 'card settings-section danger-section' },
        h('h2', null, 'Zone sensible'),
        h('p', { class: 'muted' }, 'Efface tous les clients, vues, photos et le catalogue de cet appareil.'),
        h('button', {
            class: 'btn danger', type: 'button',
            onClick: async () => {
                const ok = await confirmDialog({ title: 'Tout effacer ?', message: 'Toutes les données LAPPEV de cet appareil seront supprimées définitivement.', okLabel: 'Continuer', danger: true });
                if (!ok) return;
                const word = await promptDialog({ title: 'Confirmation', message: 'Tapez EFFACER pour confirmer.', label: 'Confirmation', placeholder: 'EFFACER', okLabel: 'Effacer tout' });
                if (word !== 'EFFACER') { if (word !== null) toast('Mot incorrect : rien n’a été effacé.', 'info'); return; }
                await db.clearAll();
                toast('🗑️ Toutes les données ont été effacées');
                location.hash = '#/clients';
            }
        }, 'Effacer toutes les données')
    ));

    el.appendChild(h('p', { class: 'credits muted small' },
        `Cartographie : ${IGN.attribution} (orthophotographies et Plan IGN). © 2026 Leroy Aurélien.`));

    return { el };
}
