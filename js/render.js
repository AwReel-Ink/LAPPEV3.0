// LAPPEV — géométrie et dessin des zones, marqueurs et mesures (écran, partage, impression)
// Tous les dessins se font en coordonnées "image" (pixels de la vue capturée).
// "unit" = taille d'un pixel d'écran exprimée en pixels d'image (1 / zoom), pour garder des traits lisibles.
import { drawBadge, textOn, hexToRgba } from './symbols.js';

export const PARKING_COLOR = '#1565C0';
export const ENTREE_COLOR = '#FDD835';
const UNKNOWN = { id: '?', name: 'Intervention supprimée', color: '#9e9e9e', symbol: 'aucun' };

// ------------------------------------------------------------
// Géométrie
// ------------------------------------------------------------
export function pointInPolygon(p, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[i], b = pts[j];
        if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
}

export function polygonArea(pts) {
    let s = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
    return Math.abs(s / 2);
}

export function polylineLength(pts, closed = false) {
    let s = 0;
    for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (closed && pts.length > 2) s += Math.hypot(pts[0].x - pts.at(-1).x, pts[0].y - pts.at(-1).y);
    return s;
}

export function distToSegment(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function bbox(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

// Point le plus "intérieur" d'un polygone (pour y placer le numéro)
function polylabelRaw(points, precision) {
    if (points.length < 3) return { x: points[0].x, y: points[0].y };
    const b = bbox(points);
    const cell = Math.max(b.w, b.h);
    if (!cell) return { x: b.x0, y: b.y0 };
    precision = precision || cell / 200;
    const distToPoly = (x, y) => {
        let min = Infinity;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) min = Math.min(min, distToSegment({ x, y }, points[i], points[j]));
        return (pointInPolygon({ x, y }, points) ? 1 : -1) * min;
    };
    const mk = (x, y, h) => { const d = distToPoly(x, y); return { x, y, h, d, max: d + h * Math.SQRT2 }; };
    // candidat initial : barycentre
    let cx = 0, cy = 0, a = 0;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const f = points[j].x * points[i].y - points[i].x * points[j].y;
        cx += (points[j].x + points[i].x) * f; cy += (points[j].y + points[i].y) * f; a += f * 3;
    }
    let best = a ? mk(cx / a, cy / a, 0) : mk(points[0].x, points[0].y, 0);
    const h0 = cell / 2;
    let queue = [];
    for (let x = b.x0; x < b.x1; x += cell) for (let y = b.y0; y < b.y1; y += cell) queue.push(mk(x + h0, y + h0, h0));
    let guard = 0;
    while (queue.length && guard++ < 4000) {
        queue.sort((p, q) => q.max - p.max);
        const c = queue.shift();
        if (c.d > best.d) best = c;
        if (c.max - best.d <= precision) continue;
        const hh = c.h / 2;
        queue.push(mk(c.x - hh, c.y - hh, hh), mk(c.x + hh, c.y - hh, hh), mk(c.x - hh, c.y + hh, hh), mk(c.x + hh, c.y + hh, hh));
    }
    return { x: best.x, y: best.y };
}

const labelCache = new Map();
export function polylabel(points) {
    let k = points.length + ':';
    for (const p of points) k += `${p.x.toFixed(1)},${p.y.toFixed(1)};`;
    let v = labelCache.get(k);
    if (!v) {
        v = polylabelRaw(points);
        labelCache.set(k, v);
        if (labelCache.size > 2000) labelCache.delete(labelCache.keys().next().value);
    }
    return v;
}

// ------------------------------------------------------------
// Numérotation : par intervention et par vue (Tonte 1, 2, 3 ; Taille 1, 2), parkings P1, P2…
// ------------------------------------------------------------
export function zoneNumbers(zones) {
    const counters = {};
    const map = new Map();
    const nParking = zones.filter(z => z.kind === 'parking').length;
    const nEntree = zones.filter(z => z.kind === 'entree').length;
    for (const z of zones) {
        const key = z.kind === 'polygon' ? `i:${z.interventionId}` : z.kind;
        counters[key] = (counters[key] || 0) + 1;
        const n = counters[key];
        if (z.kind === 'parking') map.set(z.id, nParking > 1 ? `P${n}` : 'P');
        else if (z.kind === 'entree') map.set(z.id, nEntree > 1 ? `E${n}` : 'E');
        else map.set(z.id, String(n));
    }
    return map;
}

export function interventionOf(zone, interventions) {
    return interventions.get(zone.interventionId) || UNKNOWN;
}

// ------------------------------------------------------------
// Dessin des zones
// ------------------------------------------------------------
function tracePoly(ctx, pts) {
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
}

function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
}

export function drawNumberBadge(ctx, label, x, y, r, color, { selected = false } = {}) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = selected ? '#ffffff' : color;
    ctx.fill();
    ctx.lineWidth = Math.max(r * 0.16, 0.5);
    ctx.strokeStyle = selected ? color : '#ffffff';
    ctx.stroke();
    ctx.fillStyle = selected ? color : textOn(color);
    ctx.font = `800 ${r * (label.length > 2 ? 0.8 : 1.05)}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y + r * 0.06);
}

function drawCheck(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#2e7d32';
    ctx.fill();
    ctx.lineWidth = r * 0.18;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - r * 0.45, y + r * 0.02);
    ctx.lineTo(x - r * 0.12, y + r * 0.36);
    ctx.lineTo(x + r * 0.5, y - r * 0.34);
    ctx.lineWidth = r * 0.26;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
}

export function drawMarker(ctx, zone, label, unit, { selected = false, scale = 1 } = {}) {
    const p = zone.points[0];
    if (!p) return;
    const s = 15 * unit * scale;
    ctx.save();
    if (zone.kind === 'parking') {
        roundRectPath(ctx, p.x - s, p.y - s, s * 2, s * 2, s * 0.35);
        ctx.fillStyle = PARKING_COLOR;
        ctx.fill();
        ctx.lineWidth = 2.5 * unit * scale;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `800 ${s * (label.length > 1 ? 1.05 : 1.45)}px Arial, sans-serif`;
        ctx.fillText(label, p.x, p.y + s * 0.06);
    } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, s, 0, Math.PI * 2);
        ctx.fillStyle = ENTREE_COLOR;
        ctx.fill();
        ctx.lineWidth = 2.5 * unit * scale;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        // porte
        ctx.fillStyle = '#3e2723';
        ctx.fillRect(p.x - s * 0.36, p.y - s * 0.55, s * 0.72, s * 1.05);
        ctx.fillStyle = ENTREE_COLOR;
        ctx.beginPath();
        ctx.arc(p.x + s * 0.18, p.y, s * 0.09, 0, Math.PI * 2);
        ctx.fill();
        if (label.length > 1) {
            ctx.font = `800 ${s * 0.7}px Arial, sans-serif`;
            ctx.fillStyle = '#1d1d1d';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(label.slice(1), p.x + s * 0.95, p.y + s * 0.35);
        }
    }
    if (selected) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, s * 1.55, 0, Math.PI * 2);
        ctx.setLineDash([5 * unit, 4 * unit]);
        ctx.lineWidth = 2.5 * unit;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        ctx.setLineDash([]);
    }
    ctx.restore();
}

/**
 * Dessine les zones d'une vue.
 * opts : interventions (Map), unit, visible(zone) → bool, selectedId, checked (Set d'id),
 *        numbers (Map), numberScale, fillAlpha, dimUnchecked
 */
export function drawZones(ctx, zones, opts) {
    const { interventions, unit } = opts;
    const visible = opts.visible || (() => true);
    const numbers = opts.numbers || zoneNumbers(zones);
    const checked = opts.checked || new Set();
    const ns = opts.numberScale || 1;
    const alpha = opts.fillAlpha ?? 0.42;
    const lw = opts.lineScale || 1;

    // 1) surfaces
    for (const z of zones) {
        if (z.kind !== 'polygon' || z.points.length < 3 || !visible(z)) continue;
        const it = interventionOf(z, interventions);
        const isSel = z.id === opts.selectedId;
        ctx.save();
        ctx.beginPath();
        tracePoly(ctx, z.points);
        ctx.fillStyle = hexToRgba(it.color, checked.has(z.id) ? alpha * 0.55 : alpha);
        ctx.fill();
        ctx.lineJoin = 'round';
        ctx.lineWidth = 5 * unit * lw;
        ctx.strokeStyle = 'rgba(255,255,255,0.92)';
        ctx.stroke();
        ctx.lineWidth = 2.8 * unit * lw;
        ctx.strokeStyle = it.color;
        ctx.stroke();
        if (isSel) {
            ctx.setLineDash([9 * unit, 6 * unit]);
            ctx.lineWidth = 3 * unit;
            ctx.strokeStyle = '#ffffff';
            ctx.stroke();
            ctx.setLineDash([]);
        }
        if (checked.has(z.id)) {
            ctx.fillStyle = 'rgba(255,255,255,0.45)';
            ctx.fill();
        }
        ctx.restore();
    }
    // 2) numéros (au-dessus de toutes les surfaces)
    for (const z of zones) {
        if (z.kind !== 'polygon' || z.points.length < 3 || !visible(z)) continue;
        const it = interventionOf(z, interventions);
        const c = polylabel(z.points);
        const r = 11.5 * unit * ns;
        drawNumberBadge(ctx, numbers.get(z.id) || '?', c.x, c.y, r, it.color, { selected: z.id === opts.selectedId });
        if (opts.showSymbols) drawBadge(ctx, it, c.x - r * 1.9, c.y, r * 0.8);
        if (checked.has(z.id)) drawCheck(ctx, c.x + r * 1.6, c.y - r * 0.9, r * 0.85);
    }
    // 3) marqueurs
    for (const z of zones) {
        if (z.kind === 'polygon' || !visible(z)) continue;
        drawMarker(ctx, z, numbers.get(z.id) || (z.kind === 'parking' ? 'P' : 'E'), unit, { selected: z.id === opts.selectedId, scale: ns });
    }
}

// Recherche de la zone sous un point (la plus haute d'abord)
export function hitZone(zones, p, unit, visible = () => true) {
    for (let i = zones.length - 1; i >= 0; i--) {
        const z = zones[i];
        if (!visible(z) || z.kind === 'polygon') continue;
        if (z.points[0] && Math.hypot(p.x - z.points[0].x, p.y - z.points[0].y) <= 20 * unit) return z;
    }
    for (let i = zones.length - 1; i >= 0; i--) {
        const z = zones[i];
        if (!visible(z) || z.kind !== 'polygon' || z.points.length < 3) continue;
        if (pointInPolygon(p, z.points)) return z;
    }
    return null;
}

// ------------------------------------------------------------
// Métré
// ------------------------------------------------------------
export function shapeMeasure(shape, mPerPx) {
    if (shape.type === 'line') return { length: polylineLength(shape.points) * mPerPx, area: 0 };
    const outer = polygonArea(shape.points);
    const holes = (shape.holes || []).reduce((s, h) => s + (h.length >= 3 ? polygonArea(h) : 0), 0);
    return { area: Math.max(0, outer - holes) * mPerPx * mPerPx, length: 0 };
}

export function measureTotals(measure, mPerPx) {
    let area = 0, length = 0;
    for (const sh of measure.shapes || []) {
        const m = shapeMeasure(sh, mPerPx);
        area += m.area; length += m.length;
    }
    return { area, length };
}

export function formatArea(m2) {
    return `${Math.round(m2).toLocaleString('fr-FR')} m²`;
}
export function formatLength(m) {
    return `${(m < 10 ? Math.round(m * 10) / 10 : Math.round(m)).toLocaleString('fr-FR')} m`;
}

function labelPill(ctx, text, x, y, unit, color) {
    ctx.save();
    ctx.font = `700 ${13 * unit}px system-ui, Arial, sans-serif`;
    const w = ctx.measureText(text).width + 14 * unit;
    const hh = 22 * unit;
    roundRectPath(ctx, x - w / 2, y - hh / 2, w, hh, 11 * unit);
    ctx.fillStyle = 'rgba(15,20,40,0.88)';
    ctx.fill();
    ctx.lineWidth = 2 * unit;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + unit);
    ctx.restore();
}

export function drawMeasures(ctx, measures, { unit, mPerPx, selectedMeasureId, selectedShape, labels = true }) {
    for (const m of measures) {
        const dim = selectedMeasureId && m.id !== selectedMeasureId;
        for (const sh of m.shapes || []) {
            if (!sh.points.length) continue;
            const isSel = sh === selectedShape;
            ctx.save();
            ctx.globalAlpha = dim ? 0.55 : 1;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            if (sh.type === 'line') {
                ctx.beginPath();
                ctx.moveTo(sh.points[0].x, sh.points[0].y);
                for (const p of sh.points.slice(1)) ctx.lineTo(p.x, p.y);
                ctx.lineWidth = 7 * unit; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.stroke();
                ctx.lineWidth = 4 * unit; ctx.strokeStyle = m.color; ctx.stroke();
            } else if (sh.points.length >= 3) {
                ctx.beginPath();
                tracePoly(ctx, sh.points);
                for (const hole of sh.holes || []) if (hole.length >= 3) tracePoly(ctx, hole);
                ctx.fillStyle = hexToRgba(m.color, 0.32);
                ctx.fill('evenodd');
                ctx.lineWidth = 4.5 * unit; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.stroke();
                ctx.lineWidth = 2.4 * unit; ctx.strokeStyle = m.color; ctx.stroke();
            }
            if (isSel) {
                ctx.setLineDash([8 * unit, 6 * unit]);
                ctx.lineWidth = 2.5 * unit;
                ctx.strokeStyle = '#ffffff';
                ctx.stroke();
                ctx.setLineDash([]);
            }
            ctx.restore();
            if (labels && mPerPx && !dim) {
                const val = shapeMeasure(sh, mPerPx);
                if (sh.type === 'line' && sh.points.length >= 2) {
                    const mid = Math.floor((sh.points.length - 1) / 2);
                    const a = sh.points[mid], b = sh.points[mid + 1];
                    labelPill(ctx, formatLength(val.length), (a.x + b.x) / 2, (a.y + b.y) / 2 - 16 * unit, unit, m.color);
                } else if (sh.points.length >= 3) {
                    const c = polylabel(sh.points);
                    labelPill(ctx, formatArea(val.area), c.x, c.y, unit, m.color);
                }
            }
        }
    }
}

// ------------------------------------------------------------
// Rendu d'une vue complète sur un canvas (partage, impression)
// ------------------------------------------------------------
export function renderViewCanvas(img, { maxSide = 2000, draw } = {}) {
    const w0 = img.naturalWidth, h0 = img.naturalHeight;
    const f = Math.min(1, maxSide / Math.max(w0, h0));
    const c = document.createElement('canvas');
    c.width = Math.round(w0 * f);
    c.height = Math.round(h0 * f);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.scale(f, f);
    ctx.drawImage(img, 0, 0);
    // taille d'un "pixel d'affichage" : proportionnelle à l'image pour que l'impression reste lisible
    const unit = Math.max(w0, h0) / 1100;
    draw?.(ctx, unit, f);
    return c;
}
