// LAPPEV — symboles simples des interventions (dessinés par l'appli, identiques à l'écran et à l'impression)
// Tracés dans une grille de 24 × 24.

export const SYMBOL_PATHS = {
    rond: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0Z',
    carre: 'M4 4h16v16H4Z',
    triangle: 'M12 3L22 20H2Z',
    losange: 'M12 2L22 12L12 22L2 12Z',
    etoile: 'M12 2l2.9 6.2 6.8.8-5 4.6 1.4 6.7L12 17l-6.1 3.3 1.4-6.7-5-4.6 6.8-.8Z',
    goutte: 'M12 2C12 2 5 10 5 15a7 7 0 0 0 14 0C19 10 12 2 12 2Z',
    feuille: 'M20 3C9 3 4 9.5 4 16.5V21h4.5C15.5 21 20 15 20 3Z',
    flamme: 'M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-3-1-6 1-9Z',
    ciseaux: 'M6 4a3 3 0 1 0 0 6a3 3 0 1 0 0-6Zm0 1.6a1.4 1.4 0 1 1 0 2.8a1.4 1.4 0 1 1 0-2.8ZM6 14a3 3 0 1 0 0 6a3 3 0 1 0 0-6Zm0 1.6a1.4 1.4 0 1 1 0 2.8a1.4 1.4 0 1 1 0-2.8ZM8.6 8.4L21.3 18.9 20 20.3 7.6 9.9ZM8.6 15.6L21.3 5.1 20 3.7 7.6 14.1Z',
    arbre: 'M12 2L19 12h-3l4 6h-6v4h-4v-4H4l4-6H5Z',
    main: 'M7 11.5V5.5a1.5 1.5 0 0 1 3 0V10h.6V3.6a1.5 1.5 0 0 1 3 0V10h.6V4.6a1.5 1.5 0 0 1 3 0v7.6l1.3-1.8a1.5 1.5 0 0 1 2.4 1.8L16.3 18a5 5 0 0 1-4.1 2.2H11.4A5.4 5.4 0 0 1 6 14.8V12.5a1 1 0 0 1 1-1Z',
    vague: 'M2 8.5c3-3 5-3 7.5 0s4.5 3 7.5 0 3.5-2 5 0v3c-1.5-2-3-2-5 0s-5 3-7.5 0-4.5-3-7.5 0ZM2 14.5c3-3 5-3 7.5 0s4.5 3 7.5 0 3.5-2 5 0v3c-1.5-2-3-2-5 0s-5 3-7.5 0-4.5-3-7.5 0Z'
};

export const SYMBOL_LABELS = {
    aucun: 'Aucun', rond: 'Rond', carre: 'Carré', triangle: 'Triangle', losange: 'Losange', etoile: 'Étoile',
    goutte: 'Goutte', feuille: 'Feuille', flamme: 'Flamme', ciseaux: 'Ciseaux', arbre: 'Arbre', main: 'Main',
    vague: 'Vague', lettre: 'Lettre (initiale)'
};

const path2dCache = new Map();
function path2d(id) {
    if (!path2dCache.has(id)) path2dCache.set(id, new Path2D(SYMBOL_PATHS[id]));
    return path2dCache.get(id);
}

// Couleur de texte lisible sur une couleur de fond
export function textOn(hex) {
    const n = parseInt(String(hex).replace('#', ''), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) > 165 ? '#1d1d1d' : '#ffffff';
}

export function hexToRgba(hex, a) {
    const n = parseInt(String(hex).replace('#', ''), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function initial(name) {
    return (String(name || '?').trim()[0] || '?').toUpperCase();
}

// Pastille ronde colorée avec le symbole (canvas)
export function drawBadge(ctx, intervention, x, y, r) {
    const color = intervention.color;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.14);
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    drawSymbolGlyph(ctx, intervention, x, y, r * 1.25, textOn(color));
    ctx.restore();
}

// Symbole seul, centré en (x, y), dans un carré de côté "size"
export function drawSymbolGlyph(ctx, intervention, x, y, size, color) {
    const sym = intervention.symbol || 'aucun';
    if (sym === 'aucun') return;
    ctx.save();
    ctx.fillStyle = color;
    if (sym === 'lettre' || !SYMBOL_PATHS[sym]) {
        ctx.font = `800 ${size * 0.72}px system-ui, Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(initial(intervention.name), x, y + size * 0.04);
    } else {
        const k = size / 24;
        ctx.translate(x - size / 2, y - size / 2);
        ctx.scale(k, k);
        ctx.fill(path2d(sym), 'evenodd');
    }
    ctx.restore();
}

// Pastille en SVG (listes, légendes, impression)
const NS = 'http://www.w3.org/2000/svg';
export function badgeSvg(intervention, size = 22) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('class', 'badge-svg');
    svg.setAttribute('aria-hidden', 'true');
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', 12); c.setAttribute('cy', 12); c.setAttribute('r', 11.2);
    c.setAttribute('fill', intervention.color);
    c.setAttribute('stroke', '#ffffff'); c.setAttribute('stroke-width', 1.4);
    svg.appendChild(c);
    const fg = textOn(intervention.color);
    const sym = intervention.symbol || 'aucun';
    if (sym === 'lettre' || (sym !== 'aucun' && !SYMBOL_PATHS[sym])) {
        const t = document.createElementNS(NS, 'text');
        t.setAttribute('x', 12); t.setAttribute('y', 16.6);
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('font-size', 13); t.setAttribute('font-weight', 800);
        t.setAttribute('font-family', 'Arial, sans-serif');
        t.setAttribute('fill', fg);
        t.textContent = initial(intervention.name);
        svg.appendChild(t);
    } else if (sym !== 'aucun') {
        const g = document.createElementNS(NS, 'g');
        g.setAttribute('transform', 'translate(4.5 4.5) scale(0.625)');
        const p = document.createElementNS(NS, 'path');
        p.setAttribute('d', SYMBOL_PATHS[sym]);
        p.setAttribute('fill', fg);
        p.setAttribute('fill-rule', 'evenodd');
        g.appendChild(p);
        svg.appendChild(g);
    }
    return svg;
}

// Aperçu d'un symbole seul (grille de choix)
export function symbolPreviewSvg(sym, color = '#ffffff', size = 24, name = 'A') {
    return badgeSvg({ symbol: sym, color, name }, size);
}
