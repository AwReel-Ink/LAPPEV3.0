// LAPPEV — outil commun de tracé et de modification des formes (zones d'intervention et métré)
// - tracé point par point (clic / tap), fermeture en touchant le 1er point, double-clic ou bouton
// - déplacement d'un point en le faisant glisser
// - ajout d'un point avec la poignée au milieu d'un segment
// - suppression d'un point : clic droit (PC) ou sélection puis bouton
import { isMobileUi } from './uimode.js';

export class RingEditor {
    constructor({ vp, getRings, onBeforeChange, onChange, onSelectAt, onDraftChange, color = () => '#e94560' }) {
        this.vp = vp;
        this.getRings = getRings;            // () => [{ points, closed }]  (formes modifiables)
        this.onBeforeChange = onBeforeChange || (() => {});
        this.onChange = onChange || (() => {});
        this.onSelectAt = onSelectAt || (() => {});
        this.onDraftChange = onDraftChange || (() => {});
        this.color = color;
        this.draft = null;
        this.drag = null;
        this.hover = null;
        this.selectedVertex = null;          // { ring, index }
        this._menu = e => this._contextMenu(e);
        vp.canvas.addEventListener('contextmenu', this._menu);
    }

    destroy() { this.vp.canvas.removeEventListener('contextmenu', this._menu); }

    get r() { return isMobileUi() ? 10 : 6.5; }
    get tol() { return isMobileUi() ? 22 : 11; }

    // ---------------- Tracé ----------------
    startDraft({ closed = true, minPoints = closed ? 3 : 2, onFinish, color }) {
        this.draft = { points: [], closed, minPoints, onFinish, color };
        this.selectedVertex = null;
        this.onDraftChange(this.draft);
        this.vp.render();
    }
    cancelDraft() { this.draft = null; this.onDraftChange(null); this.vp.render(); }
    undoDraftPoint() {
        if (!this.draft) return;
        this.draft.points.pop();
        this.onDraftChange(this.draft);
        this.vp.render();
    }
    finishDraft() {
        const d = this.draft;
        if (!d) return false;
        if (d.points.length < d.minPoints) return false;
        this.draft = null;
        this.onDraftChange(null);
        d.onFinish?.(d.points);
        this.vp.render();
        return true;
    }

    // ---------------- Points ----------------
    _screen(p) { return this.vp.toScreen(p); }

    hitVertex(sp) {
        for (const ring of this.getRings()) {
            for (let i = ring.points.length - 1; i >= 0; i--) {
                const s = this._screen(ring.points[i]);
                if (Math.hypot(s.x - sp.x, s.y - sp.y) <= this.tol) return { ring, index: i };
            }
        }
        return null;
    }

    hitMidpoint(sp) {
        for (const ring of this.getRings()) {
            const n = ring.points.length;
            const edges = ring.closed ? n : n - 1;
            for (let i = 0; i < edges; i++) {
                const a = this._screen(ring.points[i]), b = this._screen(ring.points[(i + 1) % n]);
                if (Math.hypot(a.x - b.x, a.y - b.y) < this.r * 5) continue;
                const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
                if (Math.hypot(m.x - sp.x, m.y - sp.y) <= this.tol * 0.85) return { ring, index: i };
            }
        }
        return null;
    }

    canDelete(ring) { return ring.points.length > (ring.closed ? 3 : 2); }

    deleteSelectedVertex() {
        const sv = this.selectedVertex;
        if (!sv || !this.canDelete(sv.ring)) return false;
        this.onBeforeChange();
        sv.ring.points.splice(sv.index, 1);
        this.selectedVertex = null;
        this.onChange();
        this.vp.render();
        return true;
    }

    _contextMenu(e) {
        if (this.draft) { e.preventDefault(); this.undoDraftPoint(); return; }
        const sp = this.vp.pt(e);
        const hit = this.hitVertex(sp);
        if (hit && this.canDelete(hit.ring)) {
            e.preventDefault();
            this.onBeforeChange();
            hit.ring.points.splice(hit.index, 1);
            this.selectedVertex = null;
            this.onChange();
            this.vp.render();
        }
    }

    // ---------------- Gestes (handler du Viewport) ----------------
    handler() {
        return {
            down: (cp, sp) => {
                if (this.draft) return false;
                const v = this.hitVertex(sp);
                if (v) { this.drag = { ...v, moved: false, start: sp }; return true; }
                const m = this.hitMidpoint(sp);
                if (m) {
                    this.onBeforeChange();
                    m.ring.points.splice(m.index + 1, 0, { x: cp.x, y: cp.y });
                    this.drag = { ring: m.ring, index: m.index + 1, moved: true, inserted: true, start: sp };
                    this.vp.render();
                    return true;
                }
                return false;
            },
            move: (cp, sp) => {
                const d = this.drag;
                if (!d) return;
                if (!d.moved) {
                    if (Math.hypot(sp.x - d.start.x, sp.y - d.start.y) < 4) return;
                    this.onBeforeChange();
                    d.moved = true;
                }
                const p = d.ring.points[d.index];
                p.x = cp.x; p.y = cp.y;
                this.vp.render();
            },
            up: () => {
                const d = this.drag;
                this.drag = null;
                if (!d) return;
                if (d.moved) { this.selectedVertex = null; this.onChange(); }
                else {
                    const same = this.selectedVertex && this.selectedVertex.ring === d.ring && this.selectedVertex.index === d.index;
                    this.selectedVertex = same ? null : { ring: d.ring, index: d.index };
                    this.onChange(true);
                }
                this.vp.render();
            },
            cancel: () => { this.drag = null; this.vp.render(); },
            tap: (cp, sp) => {
                if (this.draft) {
                    const d = this.draft;
                    if (d.closed && d.points.length >= d.minPoints) {
                        const f = this._screen(d.points[0]);
                        if (Math.hypot(f.x - sp.x, f.y - sp.y) <= this.tol) { this.finishDraft(); return; }
                    }
                    d.points.push({ x: cp.x, y: cp.y });
                    this.onDraftChange(d);
                    this.vp.render();
                    return;
                }
                this.selectedVertex = null;
                this.onSelectAt(cp, sp);
            },
            doubleTap: (cp, sp) => {
                if (this.draft) {
                    // le premier tap a déjà posé un point : on termine
                    if (!this.finishDraft()) {
                        this.draft.points.push({ x: cp.x, y: cp.y });
                        this.onDraftChange(this.draft);
                        this.vp.render();
                    }
                    return;
                }
                this.onSelectAt(cp, sp);
            },
            hover: (cp, sp) => {
                this.hover = cp;
                if (this.draft) { this.vp.canvas.style.cursor = 'crosshair'; this.vp.render(); return; }
                const v = this.hitVertex(sp) || this.hitMidpoint(sp);
                this.vp.canvas.style.cursor = v ? 'pointer' : '';
            }
        };
    }

    // ---------------- Dessin (coordonnées écran) ----------------
    draw(ctx) {
        const vp = this.vp;
        const R = this.r;
        // poignées des formes sélectionnées
        for (const ring of this.getRings()) {
            const col = this.color(ring);
            const n = ring.points.length;
            const edges = ring.closed ? n : n - 1;
            for (let i = 0; i < edges; i++) {
                const a = vp.toScreen(ring.points[i]), b = vp.toScreen(ring.points[(i + 1) % n]);
                if (Math.hypot(a.x - b.x, a.y - b.y) < R * 5) continue;
                ctx.beginPath();
                ctx.arc((a.x + b.x) / 2, (a.y + b.y) / 2, R * 0.62, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(255,255,255,0.65)';
                ctx.fill();
                ctx.lineWidth = 1.5;
                ctx.strokeStyle = col;
                ctx.stroke();
            }
            ring.points.forEach((p, i) => {
                const s = vp.toScreen(p);
                const sel = this.selectedVertex && this.selectedVertex.ring === ring && this.selectedVertex.index === i;
                ctx.beginPath();
                ctx.arc(s.x, s.y, sel ? R * 1.35 : R, 0, Math.PI * 2);
                ctx.fillStyle = sel ? col : '#ffffff';
                ctx.fill();
                ctx.lineWidth = 2.5;
                ctx.strokeStyle = sel ? '#ffffff' : col;
                ctx.stroke();
            });
        }
        // tracé en cours
        const d = this.draft;
        if (d && d.points.length) {
            const col = d.color || '#e94560';
            const pts = d.points.map(p => vp.toScreen(p));
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
            if (this.hover && !isMobileUi()) {
                const hs = vp.toScreen(this.hover);
                ctx.lineTo(hs.x, hs.y);
            }
            ctx.lineWidth = 4.5; ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.stroke();
            ctx.setLineDash([8, 6]); ctx.lineWidth = 2.5; ctx.strokeStyle = col; ctx.stroke();
            ctx.setLineDash([]);
            pts.forEach((s, i) => {
                ctx.beginPath();
                ctx.arc(s.x, s.y, i === 0 && d.closed ? R * 1.4 : R * 0.8, 0, Math.PI * 2);
                ctx.fillStyle = i === 0 ? '#ffffff' : col;
                ctx.fill();
                ctx.lineWidth = 2;
                ctx.strokeStyle = i === 0 ? col : '#ffffff';
                ctx.stroke();
            });
            ctx.restore();
        }
    }
}

// Pile d'annulation (200 actions)
export class UndoStack {
    constructor(max = 200) { this.max = max; this.items = []; }
    push(snapshot) { this.items.push(snapshot); if (this.items.length > this.max) this.items.shift(); }
    pop() { return this.items.pop(); }
    get size() { return this.items.length; }
    clear() { this.items = []; }
}
