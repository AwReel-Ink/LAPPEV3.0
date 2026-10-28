// LAPPEV — cartographie IGN (Géoplateforme) : tuiles, recherche d'adresse, capture géoréférencée.
// Projection Web Mercator (EPSG:3857), tuiles de 256 px, grille "PM" de la Géoplateforme.
// Les coordonnées "monde" utilisées ici sont exprimées en pixels au zoom 0 (de 0 à 256).

import { loadImage, canvasToBlob, sleep } from './util.js';

export const TILE = 256;
const EARTH = 40075016.686; // circonférence équatoriale (m)

export const IGN = {
    attribution: '© IGN – Géoplateforme · Licence Ouverte',
    layers: {
        ortho: { id: 'ortho', label: 'Satellite', layer: 'ORTHOIMAGERY.ORTHOPHOTOS', format: 'image/jpeg', maxNative: 19 },
        plan: { id: 'plan', label: 'Plan', layer: 'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', format: 'image/png', maxNative: 19 }
    },
    tileUrl(layerId, z, x, y) {
        const l = this.layers[layerId];
        return 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0'
            + `&LAYER=${l.layer}&STYLE=normal&TILEMATRIXSET=PM`
            + `&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}&FORMAT=${encodeURIComponent(l.format)}`;
    }
};

// Capture : résolution native de l'IGN (zoom 19 ≈ 20 cm/pixel en France).
// Le plafond ne sert que pour les très grands chantiers (limite des tablettes : ~16 millions de pixels).
export const CAPTURE = { zoom: 19, maxSide: 8000, maxArea: 16_000_000, quality: 0.85, concurrency: 6 };

// ------------------------------------------------------------
// Projection
// ------------------------------------------------------------
export function lngLatToWorld(lng, lat) {
    const s = Math.sin(Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI / 180);
    return {
        x: (lng + 180) / 360 * TILE,
        y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE
    };
}

export function worldToLngLat(x, y) {
    const n = Math.PI - 2 * Math.PI * y / TILE;
    return {
        lng: x / TILE * 360 - 180,
        lat: 180 / Math.PI * Math.atan(Math.sinh(n))
    };
}

// Mètres réels pour une unité "monde" (pixel au zoom 0) à une latitude donnée
export function metersPerWorldUnit(lat) {
    return EARTH * Math.cos(lat * Math.PI / 180) / TILE;
}

// Conversions pixel d'une vue capturée <-> longitude/latitude
export function viewPxToLngLat(geo, px, py) {
    const s = 2 ** geo.zoom;
    return worldToLngLat((geo.x0 + px) / s, (geo.y0 + py) / s);
}

export function lngLatToViewPx(geo, lng, lat) {
    const s = 2 ** geo.zoom;
    const w = lngLatToWorld(lng, lat);
    return { x: w.x * s - geo.x0, y: w.y * s - geo.y0 };
}

// Rectangle "monde" couvert par une vue capturée
export function viewWorldRect(geo) {
    const s = 2 ** geo.zoom;
    return { x0: geo.x0 / s, y0: geo.y0 / s, x1: (geo.x0 + geo.width) / s, y1: (geo.y0 + geo.height) / s };
}

export function viewSizeMeters(view) {
    if (!view.geo) return null;
    return { w: view.width * view.geo.mPerPx, h: view.height * view.geo.mPerPx };
}

// ------------------------------------------------------------
// Recherche d'adresse (service public IGN, sans clé)
// ------------------------------------------------------------
export async function searchAddress(text, signal) {
    const q = text.trim();
    if (q.length < 3) return [];
    // 1) Autocomplétion (pensée pour la saisie au fil de l'eau)
    try {
        const r = await fetch(`https://data.geopf.fr/geocodage/completion/?text=${encodeURIComponent(q)}&maximumResponses=6`, { signal });
        if (r.ok) {
            const j = await r.json();
            const res = (j.results || [])
                .filter(x => isFinite(x.x) && isFinite(x.y))
                .map(x => ({ label: x.fulltext || q, lng: +x.x, lat: +x.y }));
            if (res.length) return res;
        }
    } catch (e) {
        if (e.name === 'AbortError') throw e;
    }
    // 2) Géocodage classique en secours
    const r = await fetch(`https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(q)}&limit=6`, { signal });
    if (!r.ok) throw new Error(`Recherche d'adresse indisponible (${r.status})`);
    const j = await r.json();
    return (j.features || [])
        .filter(f => f.geometry && Array.isArray(f.geometry.coordinates))
        .map(f => ({
            label: f.properties?.label || f.properties?.name || q,
            lng: f.geometry.coordinates[0],
            lat: f.geometry.coordinates[1]
        }));
}

// ------------------------------------------------------------
// Capture d'une zone en image géoréférencée
// ------------------------------------------------------------
export function estimateCapture(rect) {
    let z = CAPTURE.zoom;
    for (;;) {
        const s = 2 ** z;
        const width = Math.ceil(rect.x1 * s) - Math.floor(rect.x0 * s);
        const height = Math.ceil(rect.y1 * s) - Math.floor(rect.y0 * s);
        const fits = width <= CAPTURE.maxSide && height <= CAPTURE.maxSide && width * height <= CAPTURE.maxArea;
        if (fits || z <= 12) {
            const latc = worldToLngLat((rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2).lat;
            const mPerPx = metersPerWorldUnit(latc) / s;
            return { zoom: z, s, width, height, mPerPx, reduced: z < CAPTURE.zoom };
        }
        z--;
    }
}

async function loadTile(url) {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            return await loadImage(url, { crossOrigin: 'anonymous' });
        } catch {
            await sleep(300 * (attempt + 1));
        }
    }
    return null;
}

export async function captureArea(rect, layerId, onProgress) {
    const est = estimateCapture(rect);
    const { zoom: z, s } = est;
    const x0 = Math.floor(rect.x0 * s), y0 = Math.floor(rect.y0 * s);
    const x1 = Math.ceil(rect.x1 * s), y1 = Math.ceil(rect.y1 * s);
    const width = x1 - x0, height = y1 - y0;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#7a7a7a';
    ctx.fillRect(0, 0, width, height);

    const queue = [];
    for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y1 - 1) / TILE); ty++) {
        for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((x1 - 1) / TILE); tx++) queue.push([tx, ty]);
    }
    const total = queue.length;
    let done = 0, missing = 0;
    onProgress?.(0, total);

    const worker = async () => {
        while (queue.length) {
            const [tx, ty] = queue.shift();
            const img = await loadTile(IGN.tileUrl(layerId, z, tx, ty));
            if (img) ctx.drawImage(img, tx * TILE - x0, ty * TILE - y0);
            else missing++;
            done++;
            onProgress?.(done, total);
        }
    };
    await Promise.all(Array.from({ length: CAPTURE.concurrency }, worker));

    let blob;
    try {
        blob = await canvasToBlob(canvas, 'image/jpeg', CAPTURE.quality);
    } catch (e) {
        const err = new Error(e.message);
        err.userMessage = e.name === 'SecurityError'
            ? "Le navigateur a refusé d'enregistrer l'image (sécurité CORS). Essayez avec Chrome ou Firefox à jour."
            : "Impossible de créer l'image : la zone est peut-être trop grande pour cet appareil.";
        throw err;
    } finally {
        canvas.width = canvas.height = 0;
    }

    const nw = worldToLngLat(x0 / s, y0 / s);
    const se = worldToLngLat(x1 / s, y1 / s);
    const geo = {
        crs: 'EPSG:3857',
        layer: layerId,
        zoom: z,
        x0, y0, width, height,
        north: nw.lat, south: se.lat, west: nw.lng, east: se.lng,
        mPerPx: metersPerWorldUnit((nw.lat + se.lat) / 2) / s
    };
    return { blob, width, height, geo, missing, total };
}

// Après une recapture : on recale les zones et le métré de la vue grâce aux coordonnées GPS.
// Renvoie le nombre de points qui tombent hors du nouveau cadrage.
export function reprojectViewContent(client, view, newGeo) {
    const old = view.geo;
    if (!old) return 0;
    let outside = 0;
    const conv = p => {
        const ll = viewPxToLngLat(old, p.x, p.y);
        const q = lngLatToViewPx(newGeo, ll.lng, ll.lat);
        if (q.x < 0 || q.y < 0 || q.x > newGeo.width || q.y > newGeo.height) outside++;
        return { ...p, x: q.x, y: q.y };
    };
    for (const z of view.zones || []) z.points = (z.points || []).map(conv);
    for (const m of client.measures || []) {
        if (m.viewId !== view.id) continue;
        for (const sh of m.shapes || []) {
            sh.points = (sh.points || []).map(conv);
            if (sh.holes) sh.holes = sh.holes.map(hole => hole.map(conv));
        }
    }
    return outside;
}
