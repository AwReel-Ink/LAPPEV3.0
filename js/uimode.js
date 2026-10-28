// LAPPEV — interface PC ou Tablette / Smartphone (préférence mémorisée sur l'appareil)
import { local } from './model.js';

export function detectUiMode() {
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    return coarse || window.innerWidth < 900 ? 'mobile' : 'pc';
}

export function getUiMode() {
    let mode = local.get('uiMode', null);
    if (mode !== 'pc' && mode !== 'mobile') {
        mode = detectUiMode();
        local.set('uiMode', mode);
    }
    return mode;
}

export function applyUiMode(mode = getUiMode()) {
    document.body.classList.toggle('ui-mobile', mode === 'mobile');
    document.body.classList.toggle('ui-pc', mode !== 'mobile');
}

export function setUiMode(mode) {
    local.set('uiMode', mode);
    applyUiMode(mode);
    window.dispatchEvent(new CustomEvent('uimodechange', { detail: mode }));
}

export const isMobileUi = () => document.body.classList.contains('ui-mobile');
