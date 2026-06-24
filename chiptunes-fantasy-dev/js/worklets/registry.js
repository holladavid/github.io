// ==========================================
// EMU CORE REGISTRY (AudioWorklets)
// ==========================================

export const workletRegistry = {
    atari: [
        { id: 'ym-exact', name: 'YM2149 (PolyBLEP Anti-Aliasing)', cpu: 2, file: 'js/worklets/atari/ym-exact.js', processor: 'ym-exact-processor' },
        { id: 'ym-standard', name: 'YM2149 (Standard)', cpu: 1, file: 'js/worklets/atari/ym-worklet.js', processor: 'ym-processor' },
        // HIER IST DER NEUE KÖNIG!
        { id: 'ym-fantasy', name: 'YM2149 (Chiptunes Fantasy)', cpu: 4, file: 'js/worklets/atari/ym-fantasy.js', processor: 'ym-fantasy-processor' },
        { id: 'ym-bladerunner', name: 'YM2149 (Blade Runner Cinematic)', cpu: 4, file: 'js/worklets/atari/ym-bladerunner.js', processor: 'ym-bladerunner-processor' }
    ],
    c64: [
        // Der SID erfordert ordentlich Mathe für die ADSR und analogen Filter
        { id: 'sid-6581', name: 'MOS SID 6581 (Classic)', cpu: 3, file: 'js/worklets/c64/sid-worklet.js', processor: 'sid-processor' }
    ],
    amiga: [
        // Mit originaler Amiga 500 Filter-Emulation und DAC-Multiplikation heben wir die CPU auf Stufe 2 (■■□□)
        { id: 'paula-standard', name: 'MOS Paula 8364', cpu: 2, file: 'js/worklets/amiga/paula-worklet.js', processor: 'paula-processor' }
    ]
};