// ==========================================
// EMU CORE REGISTRY (AudioWorklets)
// ==========================================

export const workletRegistry = {
    atari: [
        { id: 'ym-exact', name: 'YM2149 (PolyBLEP Anti-Aliasing)', file: 'js/worklets/atari/ym-exact.js', processor: 'ym-exact-processor' },
        { id: 'ym-standard', name: 'YM2149 (Standard)', file: 'js/worklets/atari/ym-worklet.js', processor: 'ym-processor' },
        { id: 'ym-hifi', name: 'YM2149 (Hi-Fi Remaster)', file: 'js/worklets/atari/ym-hifi.js', processor: 'ym-hifi-processor' },
        // NEU: Der Blade Runner Core!
        { id: 'ym-bladerunner', name: 'YM2149 (Blade Runner Cinematic)', file: 'js/worklets/atari/ym-bladerunner.js', processor: 'ym-bladerunner-processor' }
    ],
    c64: [
        { id: 'sid-6581', name: 'MOS SID 6581 (Classic)', file: 'js/worklets/c64/sid-worklet.js', processor: 'sid-processor' }
    ],
    amiga: [
        { id: 'paula-standard', name: 'MOS Paula 8364', file: 'js/worklets/amiga/paula-worklet.js', processor: 'paula-processor' }
    ]
};