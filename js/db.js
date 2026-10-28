// LAPPEV — stockage local (IndexedDB)
// Base dédiée "lappev31" : toutes les pages *.github.io d'un même compte partagent
// le même espace de stockage, d'où ce nom distinct.

const DB_NAME = 'lappev31';
const DB_VERSION = 1;

let dbPromise = null;

function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('clients')) db.createObjectStore('clients', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
            // Avancement des chantiers : local à l'appareil, jamais exporté (étape 4)
            if (!db.objectStoreNames.contains('progress')) db.createObjectStore('progress', { keyPath: 'clientId' });
        };
        req.onsuccess = () => {
            const db = req.result;
            db.onversionchange = () => db.close();
            resolve(db);
        };
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('Base de données bloquée par un autre onglet LAPPEV ouvert.'));
    });
    return dbPromise;
}

function run(storeName, mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        let result;
        const r = fn(store);
        if (r && 'onsuccess' in r) r.onsuccess = () => { result = r.result; };
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Transaction annulée'));
    }));
}

export const db = {
    allClients: () => run('clients', 'readonly', s => s.getAll()).then(r => r || []),
    getClient: id => run('clients', 'readonly', s => s.get(id)),
    putClient: client => run('clients', 'readwrite', s => s.put(client)),
    deleteClient: id => Promise.all([
        run('clients', 'readwrite', s => s.delete(id)),
        run('progress', 'readwrite', s => s.delete(id))
    ]),
    countClients: () => run('clients', 'readonly', s => s.count()),

    // Avancement des chantiers (local, jamais exporté)
    getProgress: clientId => run('progress', 'readonly', s => s.get(clientId)),
    putProgress: p => run('progress', 'readwrite', s => s.put(p)),
    deleteProgress: clientId => run('progress', 'readwrite', s => s.delete(clientId)),

    getMeta: key => run('meta', 'readonly', s => s.get(key)).then(r => (r ? r.value : undefined)),
    setMeta: (key, value) => run('meta', 'readwrite', s => s.put({ key, value })),

    async clearAll() {
        await run('clients', 'readwrite', s => s.clear());
        await run('meta', 'readwrite', s => s.clear());
        await run('progress', 'readwrite', s => s.clear());
    }
};

// ------------------------------------------------------------
// Stockage persistant : protège les données contre le nettoyage automatique du navigateur
// ------------------------------------------------------------
export async function storageStatus() {
    const out = { supported: !!(navigator.storage && navigator.storage.persist), persisted: false, usage: NaN, quota: NaN };
    try {
        if (navigator.storage?.persisted) out.persisted = await navigator.storage.persisted();
        if (navigator.storage?.estimate) {
            const e = await navigator.storage.estimate();
            out.usage = e.usage; out.quota = e.quota;
        }
    } catch { /* navigateur ancien */ }
    return out;
}

export async function requestPersistence() {
    try {
        if (!navigator.storage?.persist) return false;
        if (await navigator.storage.persisted()) return true;
        return await navigator.storage.persist();
    } catch { return false; }
}
