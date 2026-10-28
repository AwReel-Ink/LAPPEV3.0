// LAPPEV — fichier unique : export, import, fusion entre collègues (sans serveur)
import { db } from './db.js';
import { getCatalog, saveCatalog, FORMAT_VERSION, local } from './model.js';
import { uuid, normalize } from './util.js';

// ------------------------------------------------------------
// Images <-> texte
// ------------------------------------------------------------
function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
    });
}

function dataUrlToBlob(url) {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url || '');
    if (!m) throw new Error('Image illisible dans le fichier');
    const type = m[1] || 'image/jpeg';
    if (!m[2]) return new Blob([decodeURIComponent(m[3])], { type });
    const bin = atob(m[3]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
}

async function serializeClient(c) {
    const out = structuredClone({ ...c, views: [], photos: [] });
    out.views = [];
    for (const v of c.views) out.views.push({ ...structuredClone({ ...v, image: null }), image: await blobToDataUrl(v.image) });
    out.photos = [];
    for (const p of c.photos) out.photos.push({ ...structuredClone({ ...p, image: null }), image: await blobToDataUrl(p.image) });
    return out;
}

function deserializeClient(c) {
    return {
        ...c,
        views: (c.views || []).map(v => ({ ...v, zones: v.zones || [], image: dataUrlToBlob(v.image) })),
        photos: (c.photos || []).map(p => ({ ...p, image: dataUrlToBlob(p.image) })),
        materials: c.materials || {},
        measures: c.measures || []
    };
}

// ------------------------------------------------------------
// Export
// ------------------------------------------------------------
export function exportFileName(count, date = new Date()) {
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    return `LAPPEV-${count}clients-${dd}-${mm}-${date.getFullYear()}.json`;
}

export function estimateSize(clients) {
    let bytes = 0;
    for (const c of clients) {
        for (const v of c.views) bytes += v.image?.size || 0;
        for (const p of c.photos) bytes += p.image?.size || 0;
    }
    return Math.round(bytes * 1.37 + clients.length * 4000);
}

export async function buildExport(onProgress) {
    const clients = await db.allClients();
    const catalog = await getCatalog();
    const parts = [];
    parts.push(`{"app":"LAPPEV","formatVersion":${FORMAT_VERSION},"appVersion":${JSON.stringify(self.LAPPEV_VERSION)},"exportedAt":${Date.now()},"catalog":${JSON.stringify(catalog)},"clients":[`);
    for (let i = 0; i < clients.length; i++) {
        parts.push((i ? ',' : '') + JSON.stringify(await serializeClient(clients[i])));
        onProgress?.(i + 1, clients.length);
    }
    parts.push(']}');
    const blob = new Blob(parts, { type: 'application/json' });
    return { blob, name: exportFileName(clients.length), count: clients.length };
}

export function markExported() { local.set('lastExportAt', Date.now()); }

export function backupReminder(clients) {
    if (!clients.length) return null;
    if (Date.now() < local.get('reminderSnooze', 0)) return null;
    const days = local.get('backupReminderDays', 30);
    const last = local.get('lastExportAt', null);
    const ref = last || Math.min(...clients.map(c => c.createdAt || Date.now()));
    const elapsed = Math.floor((Date.now() - ref) / 86400000);
    return elapsed >= days ? { elapsed, never: !last } : null;
}

// ------------------------------------------------------------
// Lecture d'un fichier
// ------------------------------------------------------------
export async function readImportFile(file) {
    let data;
    try { data = JSON.parse(await file.text()); }
    catch { throw new Error('Ce fichier n’est pas un fichier LAPPEV valide (JSON illisible).'); }
    if (data?.appVersion && String(data.appVersion).startsWith('LAPP EV') && !data.app) {
        throw new Error('C’est un fichier de l’ancienne version (un client par fichier). Il n’est pas repris dans la nouvelle version.');
    }
    if (data?.app !== 'LAPPEV' || !Array.isArray(data.clients)) throw new Error('Ce fichier n’est pas un export LAPPEV.');
    if ((data.formatVersion || 1) > FORMAT_VERSION) throw new Error('Ce fichier vient d’une version plus récente de LAPPEV. Mettez l’appli à jour (Réglages → Rechercher une mise à jour).');
    return data;
}

// ------------------------------------------------------------
// Détection des doublons
// ------------------------------------------------------------
const ABBR = { r: 'rue', av: 'avenue', ave: 'avenue', bd: 'boulevard', bld: 'boulevard', blvd: 'boulevard', ch: 'chemin', chem: 'chemin', pl: 'place', imp: 'impasse', all: 'allee', rte: 'route', sq: 'square', fg: 'faubourg', st: 'saint', ste: 'sainte', bis: 'b', ter: 't' };

export function normAddress(s) {
    return normalize(s).replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).map(w => ABBR[w] || w).join(' ');
}

function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = cur;
    }
    return prev[b.length];
}

export function similarity(a, b) {
    if (!a || !b) return 0;
    return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

export function distanceMeters(a, b) {
    if (!a || !b) return Infinity;
    const R = 6371000, toR = Math.PI / 180;
    const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
}

export function duplicateReasons(l, c) {
    const reasons = [];
    const aL = normAddress(`${l.address} ${l.city}`), aC = normAddress(`${c.address} ${c.city}`);
    const addrSim = aL && aC ? similarity(aL, aC) : 0;
    if (addrSim === 1) reasons.push('même adresse');
    else if (addrSim >= 0.85) reasons.push('adresse très proche');
    const nameSim = similarity(normalize(l.name), normalize(c.name));
    const sameCity = normAddress(l.city) && normAddress(l.city) === normAddress(c.city);
    if (nameSim === 1) reasons.push('même nom');
    else if (nameSim >= 0.8 && (sameCity || addrSim >= 0.6)) reasons.push('nom proche (faute de frappe ?)');
    const d = distanceMeters(l.location, c.location);
    if (d < 30) reasons.push(`chantiers à ${Math.round(d)} m l’un de l’autre`);
    return reasons;
}

// ------------------------------------------------------------
// Plan de fusion
// ------------------------------------------------------------
export function planMerge(localClients, incomingClients) {
    const byId = new Map(localClients.map(c => [c.id, c]));
    return incomingClients.map(inc => {
        const loc = byId.get(inc.id);
        if (loc) {
            if ((loc.updatedAt || 0) === (inc.updatedAt || 0)) return { type: 'same', inc, local: loc, choice: 'mine' };
            return { type: 'conflict', inc, local: loc, reasons: ['même fiche modifiée des deux côtés'], choice: (inc.updatedAt || 0) > (loc.updatedAt || 0) ? 'theirs' : 'mine' };
        }
        let best = null;
        for (const l of localClients) {
            const reasons = duplicateReasons(l, inc);
            if (reasons.length && (!best || reasons.length > best.reasons.length)) best = { local: l, reasons };
        }
        if (best) return { type: 'duplicate', inc, local: best.local, reasons: best.reasons, choice: 'both' };
        return { type: 'new', inc, choice: 'theirs' };
    });
}

// ------------------------------------------------------------
// Fusion du catalogue (interventions, outils, combos)
// ------------------------------------------------------------
function mergeCatalog(localCat, incCat) {
    const itMap = new Map(), toolMap = new Map();
    const added = [], clashes = [];
    for (const it of incCat?.interventions || []) {
        const same = localCat.interventions.find(i => i.id === it.id) || localCat.interventions.find(i => normalize(i.name) === normalize(it.name));
        if (same) { itMap.set(it.id, same.id); continue; }
        const copy = { ...structuredClone(it), order: Math.max(0, ...localCat.interventions.map(i => i.order)) + 1 };
        const clash = localCat.interventions.find(i => i.color.toLowerCase() === copy.color.toLowerCase());
        if (clash) clashes.push(`${copy.name} / ${clash.name}`);
        localCat.interventions.push(copy);
        itMap.set(it.id, copy.id);
        added.push(copy.name);
    }
    for (const t of incCat?.tools || []) {
        const same = localCat.tools.find(x => x.id === t.id) || localCat.tools.find(x => normalize(x.name) === normalize(t.name));
        if (same) { toolMap.set(t.id, same.id); continue; }
        localCat.tools.push(structuredClone(t));
        toolMap.set(t.id, t.id);
    }
    for (const it of localCat.interventions) it.tools = [...new Set(it.tools.map(id => toolMap.get(id) || id))];
    for (const cb of incCat?.combos || []) {
        const ids = cb.interventionIds.map(id => itMap.get(id) || id);
        if (localCat.combos.some(x => x.id === cb.id || normalize(x.name) === normalize(cb.name))) continue;
        localCat.combos.push({ ...cb, interventionIds: ids });
    }
    return { itMap, toolMap, added, clashes };
}

function remapClient(c, itMap, toolMap) {
    for (const v of c.views) for (const z of v.zones || []) if (z.interventionId) z.interventionId = itMap.get(z.interventionId) || z.interventionId;
    const mats = {};
    for (const [itId, tools] of Object.entries(c.materials || {})) {
        const nid = itMap.get(itId) || itId;
        mats[nid] = mats[nid] || {};
        for (const [tid, q] of Object.entries(tools)) mats[nid][toolMap.get(tid) || tid] = q;
    }
    c.materials = mats;
    return c;
}

function withNewIds(c) {
    const viewIds = {};
    c.id = uuid();
    for (const v of c.views) { const n = uuid(); viewIds[v.id] = n; v.id = n; for (const z of v.zones || []) z.id = uuid(); }
    for (const p of c.photos) p.id = uuid();
    for (const m of c.measures || []) { m.id = uuid(); m.viewId = viewIds[m.viewId] || m.viewId; }
    return c;
}

async function makeBackup(reason) {
    const clients = await db.allClients();
    const catalog = await getCatalog();
    await db.setMeta('backup', { at: Date.now(), reason, clients, catalog });
}

export async function getBackupInfo() {
    const b = await db.getMeta('backup');
    return b ? { at: b.at, reason: b.reason, count: b.clients.length } : null;
}

export async function restoreBackup() {
    const b = await db.getMeta('backup');
    if (!b) throw new Error('Aucune copie de sécurité');
    for (const c of await db.allClients()) await db.deleteClient(c.id);
    for (const c of b.clients) await db.putClient(c);
    await saveCatalog(b.catalog);
    return b.clients.length;
}

export async function deleteBackup() { await db.setMeta('backup', null); }

// ------------------------------------------------------------
// Application
// ------------------------------------------------------------
export async function applyMerge(data, items) {
    await makeBackup('avant fusion');
    const catalog = await getCatalog();
    const { itMap, toolMap, added, clashes } = mergeCatalog(catalog, data.catalog);
    await saveCatalog(catalog);
    const stats = { added: 0, updated: 0, kept: 0, both: 0 };
    for (const it of items) {
        if (it.type === 'same') { stats.kept++; continue; }
        if (it.choice === 'mine') { stats.kept++; continue; }
        const c = remapClient(deserializeClient(structuredClone(it.inc)), itMap, toolMap);
        if (it.type === 'new') { await db.putClient(c); stats.added++; continue; }
        if (it.choice === 'theirs') {
            c.id = it.local.id; // remplace la fiche locale
            await db.putClient(c);
            stats.updated++;
        } else if (it.choice === 'both') {
            if (it.type === 'conflict') withNewIds(c);
            await db.putClient(c);
            stats.both++;
        }
    }
    return { ...stats, addedInterventions: added, colorClashes: clashes };
}

export async function applyReplace(data) {
    await makeBackup('avant remplacement');
    for (const c of await db.allClients()) await db.deleteClient(c.id);
    const catalog = await getCatalog();
    const fresh = data.catalog ? structuredClone(data.catalog) : catalog;
    await saveCatalog(fresh);
    for (const c of data.clients) await db.putClient(deserializeClient(c));
    return data.clients.length;
}
