// LAPPEV — outils communs : construction de l'interface, dialogues, images, formats.

// ------------------------------------------------------------
// Construction d'éléments (le texte est toujours inséré comme texte,
// jamais comme HTML : pas d'injection possible via les fiches client)
// ------------------------------------------------------------
export function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
        for (const [k, v] of Object.entries(attrs)) {
            if (v == null || v === false) continue;
            if (k === 'class') el.className = v;
            else if (k === 'style') {
                if (typeof v === 'string') el.style.cssText = v;
                else Object.assign(el.style, v);
            }
            else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
            else if (k === 'html') el.innerHTML = v; // réservé au contenu statique écrit dans le code
            else if (['value', 'checked', 'disabled', 'selected', 'hidden', 'readOnly', 'multiple'].includes(k)) el[k] = v;
            else el.setAttribute(k, v === true ? '' : String(v));
        }
    }
    appendChildren(el, children);
    return el;
}

function appendChildren(el, children) {
    for (const c of children.flat(Infinity)) {
        if (c == null || c === false) continue;
        el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
}

export function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const $ = (sel, root = document) => root.querySelector(sel);

export function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const x = [...b].map(n => n.toString(16).padStart(2, '0')).join('');
    return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

export function debounce(fn, ms) {
    let t = null, lastArgs = null;
    const d = (...args) => {
        lastArgs = args;
        clearTimeout(t);
        t = setTimeout(() => { t = null; fn(...lastArgs); }, ms);
    };
    d.flush = () => {
        if (t) { clearTimeout(t); t = null; return fn(...(lastArgs || [])); }
    };
    d.cancel = () => { clearTimeout(t); t = null; };
    return d;
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

// Comparaison de textes sans accents ni majuscules (recherche)
export function normalize(s) {
    return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// ------------------------------------------------------------
// Formats
// ------------------------------------------------------------
export function formatDate(ts, withTime = true) {
    if (!ts) return '—';
    const d = new Date(ts);
    const today = new Date();
    const yest = new Date(); yest.setDate(today.getDate() - 1);
    const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const same = (a, b) => a.toDateString() === b.toDateString();
    if (same(d, today)) return withTime ? `aujourd'hui à ${time}` : "aujourd'hui";
    if (same(d, yest)) return withTime ? `hier à ${time}` : 'hier';
    const date = d.toLocaleDateString('fr-FR');
    return withTime ? `le ${date} à ${time}` : `le ${date}`;
}

export function formatBytes(n) {
    if (!isFinite(n)) return '—';
    if (n < 1024) return `${n} o`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} Ko`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2).replace('.', ',')} Go`;
}

export function formatMeters(m) {
    if (!isFinite(m)) return '—';
    if (m >= 1000) return `${(m / 1000).toFixed(2).replace('.', ',')} km`;
    return `${Math.round(m)} m`;
}

// ------------------------------------------------------------
// Notifications
// ------------------------------------------------------------
export function toast(msg, type = 'ok', ms = 2800) {
    const box = document.getElementById('toasts');
    if (!box) return;
    const t = h('div', { class: `toast ${type}` }, msg);
    box.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 250); }, ms);
}

// ------------------------------------------------------------
// Dialogues
// ------------------------------------------------------------
export function openModal({ title, body, actions = [], dismissible = true, onOpen, wide = false }) {
    return new Promise(resolve => {
        const back = h('div', { class: 'modal-back' });
        let closed = false;
        const close = val => {
            if (closed) return;
            closed = true;
            document.removeEventListener('keydown', onKey);
            back.remove();
            resolve(val);
        };
        const buttons = actions.map(a => h('button', {
            class: `btn ${a.class || ''}`,
            type: 'button',
            'data-primary': a.primary ? '1' : null,
            onClick: async () => {
                if (a.handler) {
                    const r = await a.handler();
                    if (r === false) return;
                    close(r === undefined ? a.value : r);
                } else close(a.value);
            }
        }, a.label));
        const box = h('div', { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true' },
            title ? h('h2', null, title) : null,
            body,
            buttons.length ? h('div', { class: 'modal-actions' }, buttons) : null
        );
        back.appendChild(box);
        back.addEventListener('click', e => { if (e.target === back && dismissible) close(null); });
        function onKey(e) {
            if (e.key === 'Escape' && dismissible) close(null);
            if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
                const p = box.querySelector('[data-primary="1"]');
                if (p) { e.preventDefault(); p.click(); }
            }
        }
        document.addEventListener('keydown', onKey);
        document.body.appendChild(back);
        if (onOpen) onOpen(box, close);
    });
}

export async function confirmDialog({ title, message, okLabel = 'Confirmer', cancelLabel = 'Annuler', danger = false }) {
    const v = await openModal({
        title,
        body: h('p', null, message),
        actions: [
            { label: cancelLabel, value: false, class: 'ghost' },
            { label: okLabel, value: true, class: danger ? 'danger' : 'primary', primary: true }
        ]
    });
    return v === true;
}

export function promptDialog({ title, label, value = '', placeholder = '', okLabel = 'Valider', required = false, message }) {
    const input = h('input', { type: 'text', value, placeholder });
    const field = h('div', { class: 'field' }, label ? h('label', null, label) : null, input);
    return openModal({
        title,
        body: h('div', null, message ? h('p', null, message) : null, field),
        actions: [
            { label: 'Annuler', value: null, class: 'ghost' },
            {
                label: okLabel, class: 'primary', primary: true,
                handler: () => {
                    const v = input.value.trim();
                    if (required && !v) { field.classList.add('error'); input.focus(); return false; }
                    return v;
                }
            }
        ],
        onOpen: () => { input.focus(); input.select(); }
    });
}

// Liste d'actions (menu) : même rendu sur PC et sur mobile
export function actionSheet({ title, actions }) {
    return new Promise(resolve => {
        let closeFn = null;
        const list = h('div', { class: 'sheet-list' }, actions.map(a => h('button', {
            class: `sheet-item ${a.class || ''}`,
            type: 'button',
            disabled: a.disabled,
            onClick: () => closeFn(a.value)
        }, a.icon ? h('span', { class: 'ico' }, a.icon) : null, h('span', null, a.label))));
        openModal({
            title, body: list,
            actions: [{ label: 'Fermer', value: null, class: 'ghost' }],
            onOpen: (box, close) => { closeFn = close; }
        }).then(resolve);
    });
}

// ------------------------------------------------------------
// Fichiers et images
// ------------------------------------------------------------
export function pickFiles({ accept = '*/*', multiple = false } = {}) {
    return new Promise(resolve => {
        const input = h('input', { type: 'file', accept, multiple, style: 'display:none' });
        input.addEventListener('change', () => { resolve([...input.files]); input.remove(); });
        document.body.appendChild(input);
        input.click();
    });
}

export function loadImage(src, { crossOrigin } = {}) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        if (crossOrigin) img.crossOrigin = crossOrigin;
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Image non chargée : ${src.slice(0, 80)}`));
        img.src = src;
    });
}

export async function blobToImage(blob) {
    const url = URL.createObjectURL(blob);
    try { return await loadImage(url); }
    finally { URL.revokeObjectURL(url); }
}

export function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.85) {
    return new Promise((resolve, reject) => {
        try {
            canvas.toBlob(b => (b ? resolve(b) : reject(new Error("Export de l'image impossible"))), type, quality);
        } catch (e) { reject(e); }
    });
}

// Réduit une image (photo, capture importée) pour limiter la place prise
export async function compressImage(blob, { maxSide = 1600, quality = 0.82 } = {}) {
    const img = await blobToImage(blob);
    const w0 = img.naturalWidth, h0 = img.naturalHeight;
    const r = Math.min(1, maxSide / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * r)), hh = Math.max(1, Math.round(h0 * r));
    const c = document.createElement('canvas');
    c.width = w; c.height = hh;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, hh);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, hh);
    const out = await canvasToBlob(c, 'image/jpeg', quality);
    c.width = c.height = 0;
    return { blob: out, width: w, height: hh };
}

// Adresses temporaires des images affichées : libérées à chaque changement d'écran
const scopedUrls = new Set();
export function blobUrl(blob) {
    const u = URL.createObjectURL(blob);
    scopedUrls.add(u);
    return u;
}
export function releaseBlobUrls() {
    for (const u of scopedUrls) URL.revokeObjectURL(u);
    scopedUrls.clear();
}

// Partage natif (Quick Share, etc.) si possible, sinon téléchargement
export async function shareOrDownload(blob, name, title) {
    const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title }); return 'shared'; }
        catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
    }
    downloadBlob(blob, name);
    return 'downloaded';
}

export function downloadBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function safeFileName(s) {
    return String(s || 'client').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'client';
}
