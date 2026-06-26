// =========================================================
// HIGH-PERFORMANCE DSP REGISTER HUD & ANALYZER MODULE
// ES6 Modular Architecture - JIT-Safe Sparkline Rendering
// =========================================================

// --- YM2149 NOISE FREQUENCY LOOKUP TABLE (2 MHz Clock) ---
// Aus app.js ausgelagert, um globale Hardware-Konstanten sauber zu kapseln
const NOISE_LUT_HZ = [
    125000, 125000,  62500,  41667,  31250,  25000,  20833,  17857,
     15625,  13889,  12500,  11364,  10417,   9615,   8929,   8333,
      7813,   7353,   6944,   6579,   6250,   5952,   5682,   5435,
      5208,   5000,   4808,   4630,   4464,   4310,   4167,   4032
];

// --- INTERNER MODUL-STATUS ---
let cachedSystem = null; 
let hudValElements = [];

// Historien-Speicher für die Frequenz-Liniendiagramme (ca. 4-5 Sekunden Historie)
const HIST_LEN = 60; 
const pitchHistA = new Float32Array(HIST_LEN);
const pitchHistB = new Float32Array(HIST_LEN);
const pitchHistC = new Float32Array(HIST_LEN);
const pitchHistD = new Float32Array(HIST_LEN); // Exklusiv für Amiga Paula CH 3 (DMA 3)
let histIdx = 0;

/**
 * Resettet die historischen Frequenzpuffer und Cache-Variablen.
 * Wird beim Track-Wechsel oder System-Reset aufgerufen.
 */
export function resetHUD() {
    pitchHistA.fill(0);
    pitchHistB.fill(0);
    pitchHistC.fill(0);
    pitchHistD.fill(0);
    histIdx = 0;
    cachedSystem = null;
    hudValElements = [];
}

/**
 * Zeichnet eine sachte Frequenz-Sparkline in ein Mini-Canvas.
 */
function drawSparkline(canvasId, historyArr, headIdx, color) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;

    // Dynamische vertikale Skalierung auf Basis der Min/Max Frequenzen im Puffer
    let maxVal = 10;
    let minVal = 99999;
    for (let i = 0; i < HIST_LEN; i++) {
        if (historyArr[i] > maxVal) maxVal = historyArr[i];
        if (historyArr[i] > 0 && historyArr[i] < minVal) minVal = historyArr[i];
    }
    if (minVal === 99999) minVal = 0;
    let range = maxVal - minVal;
    if (range < 100) range = 100; // Mindestzoom, damit Stille nicht flackert

    for (let i = 0; i < HIST_LEN; i++) {
        let actualIdx = (headIdx + i) % HIST_LEN;
        let val = historyArr[actualIdx];
        
        let norm = (val - minVal) / range;
        let y = canvas.height - (norm * canvas.height);
        let x = (i / (HIST_LEN - 1)) * canvas.width;
        
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();
}

// --- ATARI ST KANAL ROW GENERATOR ---
function makeAtariChannelRow(ch, pitchId, volId, hegId, digiId) {
    let digiHtml = digiId ? `
        <div class="hud-row">
            <label>Digi Hack</label>
            <span id="${digiId}" class="hud-text-sel">--</span>
        </div>` : '';
    
    return `
        <div class="hud-channel">
            <h4>[ CH ${ch} ]</h4>
            <div class="hud-row">
                <label>Freq</label>
                <canvas class="hud-sparkline" id="${pitchId}-chart" width="100" height="18"></canvas>
                <span class="hud-val" id="${pitchId}-val">0 Hz</span>
            </div>
            <div class="hud-row">
                <label>Volume</label>
                <div class="hud-bar"><div class="hud-bar-fill" id="${volId}-bar"></div></div>
                <span class="hud-val" id="${volId}-val" style="width: 20px;">0</span>
                <div style="width: 5px;"></div>
                <div class="hud-led" id="${hegId}-led"></div><span style="font-size:0.8em; color:var(--text-color);">HEG</span>
            </div>
            ${digiHtml}
        </div>
    `;
}

// --- C64 SID KANAL ROW GENERATOR ---
function makeC64ChannelRow(ch, id) {
    return `
        <div class="hud-channel">
            <h4>[ VOICE ${ch} ]</h4>
            <div class="hud-row">
                <label>Freq</label>
                <canvas class="hud-sparkline" id="c64-pitch-${id}-chart" width="100" height="18"></canvas>
                <span class="hud-val" id="c64-pitch-${id}-val">0 Hz</span>
            </div>
            <div class="hud-row">
                <label>Wave</label>
                <div class="hud-led" id="c64-tri-${id}-led"></div><span style="margin-right:8px">TRI</span>
                <div class="hud-led" id="c64-saw-${id}-led"></div><span style="margin-right:8px">SAW</span>
                <div class="hud-led" id="c64-pul-${id}-led"></div><span style="margin-right:8px">PUL</span>
                <div class="hud-led" id="c64-noi-${id}-led"></div><span>NOI</span>
            </div>
            <div class="hud-row">
                <label>PW</label>
                <div class="hud-bar"><div class="hud-bar-fill" id="c64-pw-${id}-bar"></div></div>
                <span class="hud-val" id="c64-pw-${id}-val" style="width: 35px;">0%</span>
            </div>
            <div class="hud-row">
                <label>ADSR</label>
                <span class="hud-text-sel" id="c64-adsr-${id}-val" style="flex-grow:1; font-size: 0.9em;">A:0 D:0 S:0 R:0</span>
                <div class="hud-led" id="c64-gate-${id}-led"></div><span style="font-size:0.8em; color:var(--text-color);">GATE</span>
            </div>
        </div>
    `;
}

// --- AMIGA PAULA KANAL ROW GENERATOR ---
function makeAmigaChannelRow(ch, pan) {
    return `
        <div class="hud-channel">
            <h4>[ DMA CH ${ch} • ${pan} ]</h4>
            <div class="hud-row">
                <label>Rate</label>
                <canvas class="hud-sparkline" id="amiga-pitch-${ch}-chart" width="100" height="18"></canvas>
                <span class="hud-val" id="amiga-pitch-${ch}-val">0 Hz</span>
            </div>
            <div class="hud-row">
                <label>Volume</label>
                <div class="hud-bar"><div class="hud-bar-fill" id="amiga-vol-${ch}-bar"></div></div>
                <span class="hud-val" id="amiga-vol-${ch}-val" style="width: 30px;">0</span>
            </div>
            <div class="hud-row">
                <label>Buffer</label>
                <span class="hud-text-sel" id="amiga-len-${ch}-val" style="flex-grow:1;">0 Bytes</span>
                <div class="hud-led" id="amiga-dma-${ch}-led"></div><span style="font-size:0.8em; color:var(--text-color);">ACT</span>
            </div>
        </div>
    `;
}

/**
 * Führt die hochfrequente Echtzeit-Auswertung und das Zeichnen des Debugger-HUDs aus.
 * 
 * @param {Object} stateGetters - Objekt mit Closures zum Auslesen des App-Zustands
 * @param {Function} stateGetters.getActiveSystem - Liefert den aktiven Systemstring ('atari', 'c64', 'amiga')
 * @param {Function} stateGetters.getIsPlaying - Liefert den aktuellen Playback-Zustand
 * @param {Function} stateGetters.getCurrentChipRegs - Liefert das aktuelle custom chip Register-Array (Uint8Array)
 */
export function updateChipHUD(stateGetters) {
    const matrix = document.getElementById('hud-matrix');
    if (!matrix) return;

    const activeSystem = stateGetters.getActiveSystem();
    const isPlaying = stateGetters.getIsPlaying();
    const currentChipRegs = stateGetters.getCurrentChipRegs();

    // 1. DOM IMMER sofort neu aufbauen, wenn sich das System ändert!
    if (cachedSystem !== activeSystem) {
        cachedSystem = activeSystem;
        
        if (activeSystem === 'atari') {
            matrix.innerHTML = `
                <div class="atari-analyzer-grid">
                    <div>
                        ${makeAtariChannelRow('A', 'pitch-a', 'vol-a', 'heg-a', 'digi-a')}
                        ${makeAtariChannelRow('B', 'pitch-b', 'vol-b', 'heg-b', 'digi-b')}
                        ${makeAtariChannelRow('C', 'pitch-c', 'vol-c', 'heg-c', null)}
                    </div>
                    <div>
                        <div class="hud-channel">
                            <h4>[ MIXER & NOISE ]</h4>
                            <div class="hud-row">
                                <label>N-Freq</label>
                                <div class="hud-bar"><div class="hud-bar-fill" id="noise-bar"></div></div>
                                <span class="hud-val" id="noise-val">0 Hz</span>
                            </div>
                            <div class="hud-row">
                                <label>Tone</label>
                                <div class="hud-led" id="tone-a-led"></div><span style="margin-right: 12px">A</span>
                                <div class="hud-led" id="tone-b-led"></div><span style="margin-right: 12px">B</span>
                                <div class="hud-led" id="tone-c-led"></div><span>C</span>
                            </div>
                            <div class="hud-row">
                                <label>Noise</label>
                                <div class="hud-led" id="noise-a-led"></div><span style="margin-right: 12px">A</span>
                                <div class="hud-led" id="noise-b-led"></div><span style="margin-right: 12px">B</span>
                                <div class="hud-led" id="noise-c-led"></div><span>C</span>
                            </div>
                        </div>

                        <div class="hud-channel">
                            <h4>[ HARDWARE ENVELOPE ]</h4>
                            <div class="hud-row">
                                <label>Frequency</label>
                                <div class="hud-bar"><div class="hud-bar-fill" id="env-bar"></div></div>
                                <span class="hud-val" id="env-val">0.0 Hz</span>
                            </div>
                            <div class="hud-row">
                                <label>Shape</label>
                                <span id="env-shape-val" class="hud-text-sel">--</span>
                            </div>
                            <div class="hud-row">
                                <label>Global Trig</label>
                                <span id="digi-g-val" class="hud-text-sel" style="flex-grow: 1;">--</span>
                                <div id="hud-digi-led" style="width: 10px; height: 10px; border-radius: 50%; background: #440000; border: 1px solid #ff0000; box-shadow: none;"></div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            resetHUD();
            cachedSystem = 'atari'; 

        } else if (activeSystem === 'c64') {
            matrix.innerHTML = `
                <div class="atari-analyzer-grid">
                    <div>
                        ${makeC64ChannelRow(1, '1')}
                        ${makeC64ChannelRow(2, '2')}
                        ${makeC64ChannelRow(3, '3')}
                    </div>
                    <div>
                        <div class="hud-channel">
                            <h4>[ ANALOG FILTER ]</h4>
                            <div class="hud-row">
                                <label>Cutoff</label>
                                <div class="hud-bar"><div class="hud-bar-fill" id="c64-cut-bar"></div></div>
                                <span class="hud-val" id="c64-cut-val">0 Hz</span>
                            </div>
                            <div class="hud-row">
                                <label>Resonance</label>
                                <div class="hud-bar"><div class="hud-bar-fill" id="c64-res-bar"></div></div>
                                <span class="hud-val" id="c64-res-val">0</span>
                            </div>
                            <div class="hud-row">
                                <label>Type</label>
                                <div class="hud-led" id="c64-lp-led"></div><span style="margin-right:12px">LP</span>
                                <div class="hud-led" id="c64-bp-led"></div><span style="margin-right:12px">BP</span>
                                <div class="hud-led" id="c64-hp-led"></div><span>HP</span>
                            </div>
                            <div class="hud-row">
                                <label>Routing</label>
                                <div class="hud-led" id="c64-route-1-led"></div><span style="margin-right:12px">V1</span>
                                <div class="hud-led" id="c64-route-2-led"></div><span style="margin-right:12px">V2</span>
                                <div class="hud-led" id="c64-route-3-led"></div><span>V3</span>
                            </div>
                        </div>
                        <div class="hud-channel">
                            <h4>[ MASTER OUTPUT ]</h4>
                            <div class="hud-row">
                                <label>Volume</label>
                                <div class="hud-bar"><div class="hud-bar-fill" id="c64-vol-bar"></div></div>
                                <span class="hud-val" id="c64-vol-val">0</span>
                            </div>
                            <div class="hud-row">
                                <label>Voice3 Off</label>
                                <div class="hud-led" id="c64-v3off-led"></div>
                            </div>
                            <div class="hud-row" style="margin-top: 15px;">
                                <label>Digi Hack</label>
                                <span id="digi-g-val" class="hud-text-sel" style="flex-grow: 1;">--</span>
                                <div id="hud-digi-led" style="width: 10px; height: 10px; border-radius: 50%; background: #440000; border: 1px solid #ff0000; box-shadow: none;"></div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            resetHUD();
            cachedSystem = 'c64';

        } else if (activeSystem === 'amiga') {
            matrix.innerHTML = `
                <div class="atari-analyzer-grid">
                    <div>
                        ${makeAmigaChannelRow(0, 'L')}
                        ${makeAmigaChannelRow(1, 'R')}
                        ${makeAmigaChannelRow(2, 'R')}
                    </div>
                    <div>
                        ${makeAmigaChannelRow(3, 'L')}
                        <div class="hud-channel" style="margin-top: 15px;">
                            <h4>[ PAULA 8364 & FILTERS ]</h4>
                            <div class="hud-row">
                                <label>Clock</label>
                                <span class="hud-text-sel" style="flex-grow: 1;">3.546895 MHz (PAL)</span>
                            </div>
                            <div class="hud-row">
                                <label>LED Filter</label>
                                <span class="hud-text-sel" style="flex-grow: 1;">12dB Butterworth</span>
                                <div class="hud-led on" id="amiga-led-pwr" style="background:#ff0000; box-shadow:0 0 8px #ff0000; border-color:#ff8800;"></div>
                                <span style="font-size:0.8em; margin-left:8px; color:var(--text-color);">PWR</span>
                            </div>
                            <div class="hud-row">
                                <label>RC Filter</label>
                                <span class="hud-text-sel" style="flex-grow: 1;">6dB Static (4.42kHz)</span>
                            </div>
                            <div class="hud-row" style="margin-top: 15px;">
                                <label>Digi Hack</label>
                                <span id="digi-g-val" class="hud-text-sel" style="flex-grow: 1;">--</span>
                                <div id="hud-digi-led" style="width: 10px; height: 10px; border-radius: 50%; background: #440000; border: 1px solid #ff0000; box-shadow: none;"></div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            resetHUD();
            cachedSystem = 'amiga';
        }
    }
    
    // 2. Sicherheits-Ausstieg falls kein Signal anliegt
    if (!isPlaying || !currentChipRegs) return;
    
    // 3. High-Speed Update & Register-to-Text Berechnungen
    if (activeSystem === 'atari') {
        const r = currentChipRegs;
        
        let pitchA = ((r[1] & 0x0F) << 8) | r[0];
        let hzA = pitchA === 0 ? 0 : 2000000 / (16 * pitchA);
        if (hzA > 15000) hzA = 0; 
        pitchHistA[histIdx] = hzA;
        document.getElementById('pitch-a-val').innerText = Math.round(hzA) + ' Hz';
        drawSparkline('pitch-a-chart', pitchHistA, (histIdx+1)%HIST_LEN, '#55ff55');
        
        let volA = r[8] & 0x0F;
        document.getElementById('vol-a-bar').style.width = (volA / 15 * 100) + '%';
        document.getElementById('vol-a-val').innerText = volA;
        document.getElementById('heg-a-led').className = (r[8] & 0x10) ? 'hud-led on' : 'hud-led';
        let digiA = (r[1] & 0xF0) >> 4;
        document.getElementById('digi-a').innerText = digiA > 0 ? `SMP #${digiA}` : '--';

        let pitchB = ((r[3] & 0x0F) << 8) | r[2];
        let hzB = pitchB === 0 ? 0 : 2000000 / (16 * pitchB);
        if (hzB > 15000) hzB = 0;
        pitchHistB[histIdx] = hzB;
        document.getElementById('pitch-b-val').innerText = Math.round(hzB) + ' Hz';
        drawSparkline('pitch-b-chart', pitchHistB, (histIdx+1)%HIST_LEN, '#55ff55');

        let volB = r[9] & 0x0F;
        document.getElementById('vol-b-bar').style.width = (volB / 15 * 100) + '%';
        document.getElementById('vol-b-val').innerText = volB;
        document.getElementById('heg-b-led').className = (r[9] & 0x10) ? 'hud-led on' : 'hud-led';
        let digiB = (r[3] & 0xF0) >> 4;
        document.getElementById('digi-b').innerText = digiB > 0 ? `SMP #${digiB}` : '--';

        let pitchC = ((r[5] & 0x0F) << 8) | r[4];
        let hzC = pitchC === 0 ? 0 : 2000000 / (16 * pitchC);
        if (hzC > 15000) hzC = 0;
        pitchHistC[histIdx] = hzC;
        document.getElementById('pitch-c-val').innerText = Math.round(hzC) + ' Hz';
        drawSparkline('pitch-c-chart', pitchHistC, (histIdx+1)%HIST_LEN, '#55ff55');

        let volC = r[10] & 0x0F;
        document.getElementById('vol-c-bar').style.width = (volC / 15 * 100) + '%';
        document.getElementById('vol-c-val').innerText = volC;
        document.getElementById('heg-c-led').className = (r[10] & 0x10) ? 'hud-led on' : 'hud-led';

        histIdx = (histIdx + 1) % HIST_LEN;

        let noiseP = r[6] & 0x1F;
        let exactHz = NOISE_LUT_HZ[noiseP];
        let noiseStr = exactHz >= 10000 ? (exactHz / 1000).toFixed(1) + " kHz" : exactHz + " Hz";
        document.getElementById('noise-bar').style.width = (noiseP / 31 * 100) + '%';
        document.getElementById('noise-val').innerText = noiseStr;

        let mix = r[7];
        document.getElementById('tone-a-led').className = (mix & 0x01) === 0 ? 'hud-led on' : 'hud-led';
        document.getElementById('tone-b-led').className = (mix & 0x02) === 0 ? 'hud-led on' : 'hud-led';
        document.getElementById('tone-c-led').className = (mix & 0x04) === 0 ? 'hud-led on' : 'hud-led';
        document.getElementById('noise-a-led').className = (mix & 0x08) === 0 ? 'hud-led on' : 'hud-led';
        document.getElementById('noise-b-led').className = (mix & 0x10) === 0 ? 'hud-led on' : 'hud-led';
        document.getElementById('noise-c-led').className = (mix & 0x20) === 0 ? 'hud-led on' : 'hud-led';

        let envP = (r[12] << 8) | r[11];
        let envHz = envP === 0 ? 0 : 2000000 / (256 * envP);
        document.getElementById('env-bar').style.width = (envP / 65535 * 100) + '%';
        document.getElementById('env-val').innerText = envHz.toFixed(1) + ' Hz';
        
        let shapeBits = r[13];
        let shapeStr = "--";
        if (shapeBits !== 0xFF && shapeBits !== 0) {
            const shapes = {
                0:'\\___', 4:'/___', 8:'\\\\\\\\', 9:'\\___', 10:'\\/\\/', 
                11:'\\---', 12:'////', 13:'/---', 14:'/\\/\\', 15:'/___'
            };
            let s = shapeBits & 0x0F;
            shapeStr = `[0x${s.toString(16).toUpperCase()}] ` + (s < 4 ? '\\___' : (s < 8 ? '/___' : shapes[s] || `0x${s}`));
        }
        document.getElementById('env-shape-val').innerText = shapeStr;

    } else if (activeSystem === 'c64') {
        const r = currentChipRegs;
        
        for (let v = 0; v < 3; v++) {
            let base = v * 7;
            
            let freq = r[base] | (r[base+1] << 8);
            let hz = freq ? (freq * 985248) / 16777216 : 0;
            if (hz > 15000) hz = 0; 

            let histArr = v === 0 ? pitchHistA : (v === 1 ? pitchHistB : pitchHistC);
            histArr[histIdx] = hz;
            
            document.getElementById(`c64-pitch-${v+1}-val`).innerText = hz >= 1000 ? (hz/1000).toFixed(1)+' kHz' : Math.round(hz) + ' Hz';
            drawSparkline(`c64-pitch-${v+1}-chart`, histArr, (histIdx+1)%HIST_LEN, '#6c5eb5');

            let pw = r[base+2] | ((r[base+3] & 0x0F) << 8);
            document.getElementById(`c64-pw-${v+1}-bar`).style.width = (pw / 4095 * 100) + '%';
            document.getElementById(`c64-pw-${v+1}-val`).innerText = Math.round((pw / 4095) * 100) + '%';

            let ctrl = r[base+4];
            document.getElementById(`c64-tri-${v+1}-led`).className = (ctrl & 16) ? 'hud-led on' : 'hud-led';
            document.getElementById(`c64-saw-${v+1}-led`).className = (ctrl & 32) ? 'hud-led on' : 'hud-led';
            document.getElementById(`c64-pul-${v+1}-led`).className = (ctrl & 64) ? 'hud-led on' : 'hud-led';
            document.getElementById(`c64-noi-${v+1}-led`).className = (ctrl & 128) ? 'hud-led on' : 'hud-led';
            document.getElementById(`c64-gate-${v+1}-led`).className = (ctrl & 1) ? 'hud-led on' : 'hud-led';

            let ad = r[base+5];
            let sr = r[base+6];
            document.getElementById(`c64-adsr-${v+1}-val`).innerText = `A:${ad>>4} D:${ad&15} S:${sr>>4} R:${sr&15}`;
        }
        
        histIdx = (histIdx + 1) % HIST_LEN;

        let fcut = (r[21] & 7) | (r[22] << 3);
        let fhz = 30 + (fcut * 8);
        document.getElementById('c64-cut-bar').style.width = (fcut / 2047 * 100) + '%';
        document.getElementById('c64-cut-val').innerText = fhz >= 1000 ? (fhz/1000).toFixed(1)+' kHz' : Math.round(fhz) + ' Hz';

        let fres = r[23] >> 4;
        document.getElementById('c64-res-bar').style.width = (fres / 15 * 100) + '%';
        document.getElementById('c64-res-val').innerText = fres;

        let froute = r[23] & 15;
        document.getElementById('c64-route-1-led').className = (froute & 1) ? 'hud-led on' : 'hud-led';
        document.getElementById('c64-route-2-led').className = (froute & 2) ? 'hud-led on' : 'hud-led';
        document.getElementById('c64-route-3-led').className = (froute & 4) ? 'hud-led on' : 'hud-led';

        let fmode = r[24] & 0xF0;
        document.getElementById('c64-lp-led').className = (fmode & 16) ? 'hud-led on' : 'hud-led';
        document.getElementById('c64-bp-led').className = (fmode & 32) ? 'hud-led on' : 'hud-led';
        document.getElementById('c64-hp-led').className = (fmode & 64) ? 'hud-led on' : 'hud-led';
        document.getElementById('c64-v3off-led').className = (fmode & 128) ? 'hud-led on' : 'hud-led';

        let vol = r[24] & 15;
        document.getElementById('c64-vol-bar').style.width = (vol / 15 * 100) + '%';
        document.getElementById('c64-vol-val').innerText = vol;

    } else if (activeSystem === 'amiga') {
        const r = currentChipRegs;
        const hists = [pitchHistA, pitchHistB, pitchHistC, pitchHistD];
        
        for (let c = 0; c < 4; c++) {
            let base = c * 7;
            
            let address = (r[base] << 8) | r[base+1];
            let lenWords = (r[base+2] << 8) | r[base+3];
            let period = (r[base+4] << 8) | r[base+5];
            let vol = r[base+6];
            
            let hz = period > 0 ? 3546895 / period : 0;
            if (hz > 60000) hz = 0; 
            
            hists[c][histIdx] = hz;
            document.getElementById(`amiga-pitch-${c}-val`).innerText = hz >= 1000 ? (hz/1000).toFixed(1)+' kHz' : Math.round(hz) + ' Hz';
            drawSparkline(`amiga-pitch-${c}-chart`, hists[c], (histIdx+1)%HIST_LEN, '#ff8800'); 
            
            document.getElementById(`amiga-vol-${c}-bar`).style.width = (vol / 64 * 100) + '%';
            document.getElementById(`amiga-vol-${c}-val`).innerText = vol;
            
            document.getElementById(`amiga-len-${c}-val`).innerText = (lenWords * 2) + ' B';
            
            let isAct = address > 0 && vol > 0 && lenWords > 0;
            document.getElementById(`amiga-dma-${c}-led`).className = isAct ? 'hud-led on' : 'hud-led';
        }
        
        histIdx = (histIdx + 1) % HIST_LEN;
    }
}