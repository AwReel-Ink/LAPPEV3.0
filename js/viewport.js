// LAPPEV — zone d'affichage zoomable (image ou carte), commune au PC et au tactile.
// Souris : molette = zoom, glisser = déplacer, clic droit/milieu = déplacer.
// Tactile : un doigt = déplacer, deux doigts = zoomer + déplacer.
// Un "handler" peut prendre la main sur un glisser (poignées, tracé...).

export class Viewport {
    constructor(canvas, opts = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.opts = opts;
        this.minScale = opts.minScale ?? 0.05;
        this.maxScale = opts.maxScale ?? 40;
        this.onRender = opts.onRender || (() => {});
        this.onChange = opts.onChange || null;
        this.handler = opts.handler || null;
        this.scale = 1; this.tx = 0; this.ty = 0;
        this.w = 0; this.h = 0; this.dpr = 1;
        this.sized = false;
        this.pointers = new Map();
        this.mode = null;
        this.start = null;
        this.lastTap = null;
        this._raf = 0;

        this._ev = {
            down: e => this._down(e),
            move: e => this._move(e),
            up: e => this._up(e),
            wheel: e => this._wheel(e),
            menu: e => e.preventDefault()
        };
        canvas.addEventListener('pointerdown', this._ev.down);
        canvas.addEventListener('pointermove', this._ev.move);
        canvas.addEventListener('pointerup', this._ev.up);
        canvas.addEventListener('pointercancel', this._ev.up);
        canvas.addEventListener('wheel', this._ev.wheel, { passive: false });
        canvas.addEventListener('contextmenu', this._ev.menu);

        this.ro = new ResizeObserver(() => this.resize());
        this.ro.observe(canvas);
    }

    destroy() {
        const c = this.canvas;
        c.removeEventListener('pointerdown', this._ev.down);
        c.removeEventListener('pointermove', this._ev.move);
        c.removeEventListener('pointerup', this._ev.up);
        c.removeEventListener('pointercancel', this._ev.up);
        c.removeEventListener('wheel', this._ev.wheel);
        c.removeEventListener('contextmenu', this._ev.menu);
        this.ro.disconnect();
        cancelAnimationFrame(this._raf);
    }

    resize() {
        const r = this.canvas.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        const first = !this.sized;
        const oldW = this.w, oldH = this.h;
        this.w = r.width; this.h = r.height; this.dpr = dpr;
        this.canvas.width = Math.round(r.width * dpr);
        this.canvas.height = Math.round(r.height * dpr);
        this.sized = true;
        if (!first) { // garder le même centre
            this.tx += (this.w - oldW) / 2;
            this.ty += (this.h - oldH) / 2;
        }
        this.opts.onResize?.(first);
        this.render(true);
    }

    pt(e) {
        const r = this.canvas.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    toContent(p) { return { x: (p.x - this.tx) / this.scale, y: (p.y - this.ty) / this.scale }; }
    toScreen(p) { return { x: p.x * this.scale + this.tx, y: p.y * this.scale + this.ty }; }
    clampScale(s) { return Math.min(this.maxScale, Math.max(this.minScale, s)); }

    zoomAt(sx, sy, factor) {
        const ns = this.clampScale(this.scale * factor);
        const k = ns / this.scale;
        this.tx = sx - (sx - this.tx) * k;
        this.ty = sy - (sy - this.ty) * k;
        this.scale = ns;
        this._changed();
    }
    zoomBy(factor) { this.zoomAt(this.w / 2, this.h / 2, factor); }

    fit(x, y, w, h, pad = 0.95) {
        if (!this.sized || w <= 0 || h <= 0) return;
        const s = this.clampScale(Math.min(this.w / w, this.h / h) * pad);
        this.scale = s;
        this.tx = (this.w - w * s) / 2 - x * s;
        this.ty = (this.h - h * s) / 2 - y * s;
        this._changed();
    }

    centerOn(cx, cy, scale = this.scale) {
        this.scale = this.clampScale(scale);
        this.tx = this.w / 2 - cx * this.scale;
        this.ty = this.h / 2 - cy * this.scale;
        this._changed();
    }

    visibleRect() {
        const a = this.toContent({ x: 0, y: 0 });
        const b = this.toContent({ x: this.w, y: this.h });
        return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
    }

    _changed() {
        this.render();
        this.onChange?.(this);
    }

    render(now = false) {
        if (!this.sized) return;
        if (now) {
            cancelAnimationFrame(this._raf);
            this._raf = 0;
            this._draw();
            return;
        }
        if (this._raf) return;
        this._raf = requestAnimationFrame(() => { this._raf = 0; this._draw(); });
    }

    _draw() {
        const ctx = this.ctx;
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.clearRect(0, 0, this.w, this.h);
        this.onRender(ctx, this);
    }

    // ---------------- Gestes ----------------
    _down(e) {
        const p = this.pt(e);
        try { this.canvas.setPointerCapture(e.pointerId); } catch { /* ignoré */ }
        this.pointers.set(e.pointerId, p);

        if (this.pointers.size === 1) {
            const panButton = e.button === 1 || e.button === 2;
            this.start = { x: p.x, y: p.y, moved: false, panButton };
            if (!panButton && this.handler?.down && this.handler.down(this.toContent(p), p, e) === true) {
                this.mode = 'handler';
            } else {
                this.mode = 'pan';
                this.panStart = { x: p.x, y: p.y, tx: this.tx, ty: this.ty };
            }
        } else if (this.pointers.size === 2) {
            if (this.mode === 'handler') this.handler?.cancel?.();
            this.mode = 'pinch';
            const [a, b] = [...this.pointers.values()];
            this.pinch = {
                d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
                mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
                scale: this.scale, tx: this.tx, ty: this.ty
            };
            if (this.start) this.start.moved = true;
        }
        e.preventDefault();
    }

    _move(e) {
        const p = this.pt(e);
        if (!this.pointers.has(e.pointerId)) {
            this.handler?.hover?.(this.toContent(p), p, e);
            return;
        }
        this.pointers.set(e.pointerId, p);
        if (this.start && !this.start.moved && Math.hypot(p.x - this.start.x, p.y - this.start.y) > 6) this.start.moved = true;

        if (this.mode === 'pan') {
            if (!this.start?.moved) return;
            this.tx = this.panStart.tx + (p.x - this.panStart.x);
            this.ty = this.panStart.ty + (p.y - this.panStart.y);
            this.canvas.style.cursor = 'grabbing';
            this._changed();
        } else if (this.mode === 'handler') {
            this.handler.move?.(this.toContent(p), p, e);
        } else if (this.mode === 'pinch' && this.pointers.size >= 2) {
            const [a, b] = [...this.pointers.values()];
            const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            const s = this.clampScale(this.pinch.scale * d / this.pinch.d);
            const cx = (this.pinch.mid.x - this.pinch.tx) / this.pinch.scale;
            const cy = (this.pinch.mid.y - this.pinch.ty) / this.pinch.scale;
            this.scale = s;
            this.tx = mid.x - cx * s;
            this.ty = mid.y - cy * s;
            this._changed();
        }
    }

    _up(e) {
        if (!this.pointers.has(e.pointerId)) return;
        const p = this.pt(e);
        this.pointers.delete(e.pointerId);
        try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* ignoré */ }

        if (this.mode === 'pinch') {
            if (this.pointers.size === 1) {
                const [q] = [...this.pointers.values()];
                this.mode = 'pan';
                this.panStart = { x: q.x, y: q.y, tx: this.tx, ty: this.ty };
            } else if (this.pointers.size === 0) {
                this.mode = null;
            }
            return;
        }
        if (this.pointers.size > 0) return;

        const mode = this.mode;
        this.mode = null;
        this.canvas.style.cursor = '';
        if (mode === 'handler') {
            this.handler.up?.(this.toContent(p), p, e);
            return;
        }
        if (mode === 'pan' && this.start && !this.start.moved && !this.start.panButton && e.type !== 'pointercancel') {
            const now = performance.now();
            const cp = this.toContent(p);
            if (this.lastTap && now - this.lastTap.t < 320 && Math.hypot(p.x - this.lastTap.x, p.y - this.lastTap.y) < 24) {
                this.lastTap = null;
                this.handler?.doubleTap?.(cp, p, e);
            } else {
                this.lastTap = { t: now, x: p.x, y: p.y };
                this.handler?.tap?.(cp, p, e);
            }
        }
    }

    _wheel(e) {
        e.preventDefault();
        const p = this.pt(e);
        let dy = e.deltaY;
        if (e.deltaMode === 1) dy *= 16;
        this.zoomAt(p.x, p.y, Math.exp(-dy * 0.0015));
    }
}

// Barre d'échelle (ex. "20 m") en bas à gauche
export function drawScaleBar(ctx, vp, metersPerUnit, opts = {}) {
    if (!metersPerUnit || !isFinite(metersPerUnit)) return;
    const meters = 110 / vp.scale * metersPerUnit;
    const pow = 10 ** Math.floor(Math.log10(meters));
    const n = meters / pow;
    const nice = (n >= 5 ? 5 : n >= 2 ? 2 : 1) * pow;
    const px = nice / metersPerUnit * vp.scale;
    const label = nice >= 1000 ? `${nice / 1000} km` : nice >= 1 ? `${nice} m` : `${Math.round(nice * 100)} cm`;
    const x = opts.x ?? 12;
    const y = vp.h - (opts.bottom ?? 14);
    ctx.save();
    ctx.font = '600 12px system-ui, sans-serif';
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    const bw = px + tw + 26;
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x - 6, y - 16, bw, 24, 6); ctx.fill(); }
    else ctx.fillRect(x - 6, y - 16, bw, 24);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y - 7); ctx.lineTo(x, y); ctx.lineTo(x + px, y); ctx.lineTo(x + px, y - 7);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + px + 8, y - 4);
    ctx.restore();
}
