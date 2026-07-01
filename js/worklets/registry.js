// === js/worklets/registry.js ===
// ==========================================
// EMU CORE REGISTRY (AudioWorklets)
// ==========================================

export const workletRegistry = {
    atari: [
        { id: 'ym-exact', name: 'YM2149F (2MHz True Lockstep)', cpu: 4, file: 'js/worklets/atari/ym-exact.js', processor: 'ym-exact-processor' },
        { id: 'ym-fantasy', name: 'YM2149F (Chiptunes Fantasy)', cpu: 3, file: 'js/worklets/atari/ym-fantasy.js', processor: 'ym-fantasy-processor' },
        { id: 'ym-bladerunner', name: 'YM2149F (Blade Runner Cinematic)', cpu: 3, file: 'js/worklets/atari/ym-bladerunner.js', processor: 'ym-bladerunner-processor' },
        { id: 'ym-standard', name: 'YM2149F (Digital Fast)', cpu: 1, file: 'js/worklets/atari/ym-standard.js', processor: 'ym-processor' }
    ],
    c64: [
        { id: 'sid-exact', name: 'SID 6581 (1MHz True Analog)', cpu: 4, file: 'js/worklets/c64/sid-exact.js', processor: 'sid-exact-processor' },
        { id: 'sid-standard', name: 'SID 6581 (Digital Fast)', cpu: 1, file: 'js/worklets/c64/sid-standard.js', processor: 'sid-standard-processor' }
    ],
    amiga: [
        { id: 'paula-exact', name: 'Paula 8364 (192kHz True Analog)', cpu: 3, file: 'js/worklets/amiga/paula-exact.js', processor: 'paula-exact-processor' },
        { id: 'paula-standard', name: 'Paula 8364 (Digital Fast)', cpu: 1, file: 'js/worklets/amiga/paula-standard.js', processor: 'paula-standard-processor' }
    ]
};