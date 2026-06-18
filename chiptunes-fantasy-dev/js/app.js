// --- IMPORT DER MODULE ---
import { trackRegistry } from '../tracks/registry.js';
import { createKickSample, createBassSample, createChordSample } from './utils/amiga-helper.js'; 

// NEU: Wir importieren den Content für das Museum absolut sauber!
import { systemDescriptions, chipCheatSheets } from './content/museum.js';

// --- GLOBALE VARIABLEN ---
let audioCtx;
let ymNode, paulaNode, sidNode; 
let masterGain;
let analyserNode; 
let currentOscValue = 0; 
let currentChipRegs = null; 
let activeSystem = 'atari';
let trackData = [];    
let currentFrame = 0;  
let isPlaying = false; 
let currentTrackIndex = 0;
let currentScrollerText = "+++ INITIALIZING DEMO ENGINE... +++";
let lastKnownFrame = 0; 

// --- YM2149 NOISE FREQUENCY LOOKUP TABLE (2 MHz Clock) ---
// 32 diskrete Werte für die 5 Bits (0 - 31). Periode 0 wird als 1 behandelt.
const NOISE_LUT_HZ = [
    125000, 125000,  62500,  41667,  31250,  25000,  20833,  17857,
     15625,  13889,  12500,  11364,  10417,   9615,   8929,   8333,
      7813,   7353,   6944,   6579,   6250,   5952,   5682,   5435,
      5208,   5000,   4808,   4630,   4464,   4310,   4167,   4032
];

// --- BOOT SEQUENZ (Modul-sicher) ---
function initApp() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            setTheme(e.target.getAttribute('data-theme'));
        });
    });

    const bootScreen = document.getElementById("boot-screen");
    bootScreen.addEventListener("click", async () => {
        const demoContainer = document.getElementById("demo-container");
        if (!demoContainer) {
            alert("FEHLER: HTML Element 'demo-container' fehlt in der index.html!");
            return;
        }

        bootScreen.classList.add("hidden");
        demoContainer.classList.remove("hidden");
        
        await initAudioEngine();
        initVisuals(); 
        initScroller(); 
        
        setTheme('theme-c64');
        selectAndPlayTrack(0, 'c64'); 
    });
}

if (document.readyState === 'loading') document.addEventListener("DOMContentLoaded", initApp);
else initApp();

// --- AUDIO ENGINE CORE ---
async function initAudioEngine() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    try {
        await audioCtx.audioWorklet.addModule('js/worklets/ym-worklet.js');
        await audioCtx.audioWorklet.addModule('js/worklets/paula-worklet.js');
        await audioCtx.audioWorklet.addModule('js/worklets/sid-worklet.js'); 
        
        ymNode = new AudioWorkletNode(audioCtx, 'ym-processor');
        paulaNode = new AudioWorkletNode(audioCtx, 'paula-processor');
        sidNode = new AudioWorkletNode(audioCtx, 'sid-processor'); 
        
        const amigaFilter = audioCtx.createBiquadFilter();
        amigaFilter.type = 'lowpass';
        amigaFilter.frequency.value = 6000; 

        // --- MASTER VOLUME & FFT ANALYZER ---
        analyserNode = audioCtx.createAnalyser();
        analyserNode.fftSize = 4096; 

        masterGain = audioCtx.createGain();
        masterGain.gain.value = 0.5; 
        
        ymNode.connect(masterGain);
        paulaNode.connect(amigaFilter).connect(masterGain);
        sidNode.connect(masterGain); 
        
        masterGain.connect(analyserNode);
        analyserNode.connect(audioCtx.destination);
        
        const visualHandler = (e) => {
            if (e.data.type === 'VISUAL_DATA') {
                currentOscValue = e.data.value;
                lastKnownFrame = e.data.frame || 0; 
                currentChipRegs = e.data.regs; 
            }
            // DIE ROTE NERD-LED WIRD BEFEUERT!
            if (e.data.type === 'DEBUG') {
                const led = document.getElementById('hud-digi-led');
                
                if (led) {
                    led.style.background = '#ff0000';
                    led.style.boxShadow = '0 0 10px #ff0000';
                    
                    // Hardware-Nachleuchten (50 Millisekunden)
                    setTimeout(() => { 
                        led.style.background = '#440000'; 
                        led.style.boxShadow = 'none';
                    }, 50);
                }
            }
        };

        ymNode.port.onmessage = paulaNode.port.onmessage = sidNode.port.onmessage = visualHandler;
        uploadAmigaSamples();
    } catch (e) { console.error("AudioWorklet Fehler:", e); }
}

function uploadAmigaSamples() {
    if (paulaNode) {
        paulaNode.port.postMessage({ type: 'UPLOAD_SAMPLE', name: 'kick', data: createKickSample() });
        paulaNode.port.postMessage({ type: 'UPLOAD_SAMPLE', name: 'bass', data: createBassSample() });
        paulaNode.port.postMessage({ type: 'UPLOAD_SAMPLE', name: 'chord', data: createChordSample() });
    }
}

// --- TIMELINE HELPER ---
function formatTime(frames) {
    if (!frames) return "00:00";
    let totalSeconds = Math.floor(frames / 50);
    let mins = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    let secs = (totalSeconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
}

function updateTimelineUI() {
    if (!isPlaying || trackData.length === 0) return;
    document.getElementById('time-current').innerText = formatTime(lastKnownFrame);
    document.getElementById('time-total').innerText = formatTime(trackData.length);
    document.getElementById('progress-slider').value = (lastKnownFrame / trackData.length) * 100;
}

// --- PLAYER LOGIK ---
function startPlayback() {
    if (isPlaying || trackData.length === 0) return;
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

    isPlaying = true;
    let isAmiga = trackData[0] && trackData[0].isAmiga;
    let isC64 = trackData[0] && trackData[0].isC64;
    
    if (isAmiga) {
        paulaNode.port.postMessage({ type: 'PLAY_TRACK', track: trackData });
    } else if (isC64) {
        sidNode.port.postMessage({ type: 'PLAY_TRACK', track: trackData });
    } else {
        ymNode.port.postMessage({ 
            type: 'PLAY_TRACK', 
            track: trackData, 
            digidrums: trackData.digidrums 
        });
    }
}

function stopPlayback() {
    if (!isPlaying) return;
    isPlaying = false;
    if (ymNode) ymNode.port.postMessage({ type: 'STOP_TRACK' });
    if (paulaNode) paulaNode.port.postMessage({ type: 'STOP_TRACK' });
    if (sidNode) sidNode.port.postMessage({ type: 'STOP_TRACK' });
}

// --- UI & THEME LOGIK ---
function setTheme(themeName) {
    document.body.className = themeName;
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
        tab.classList.remove('active');
        if (tab.getAttribute('data-theme') === themeName) tab.classList.add('active');
    });

    activeSystem = themeName === 'theme-atari' ? 'atari' : themeName === 'theme-amiga' ? 'amiga' : 'c64';
    
    renderTracklist(activeSystem);
    stopPlayback(); 

    const headerTitles = {
        'c64': '>>> INFO: MOS Technology SID 6581',
        'amiga': '>>> INFO: MOS Paula 8364',
        'atari': '>>> INFO: Yamaha YM2149 (Atari ST)'
    };
    const headerEl = document.querySelector('.museum-header h2');
    if (headerEl) headerEl.innerText = headerTitles[activeSystem];

    document.getElementById('info-text').innerHTML = `
        ${systemDescriptions[activeSystem]}
        <div>
            <p style="color: var(--highlight-color);">[ SYSTEM READY ]</p>
            <p>Please select a track from the playlist to initialize playback and load data into memory...</p>
            <p class="blinking-cursor" style="margin-top: 15px;">_</p>
        </div>
    `;
    currentScrollerText = `+++ ${activeSystem.toUpperCase()} SYSTEM READY. AWAITING INPUT... +++`;

    const legend = document.getElementById('hud-legend');
    if (legend) legend.classList.add('hidden'); 

    trackData = [];
    currentTrackIndex = 0;
    currentChipRegs = null; // NEU: Verhindert alte Geister-Werte beim Tab-Wechsel!
}

function renderTracklist(system) {
    const listElement = document.getElementById('tracklist');
    listElement.innerHTML = ''; 
    const songs = trackRegistry[system];
    if (!songs) return;

    songs.forEach((song, index) => {
        const li = document.createElement('li');
        li.textContent = song.title;
        if (index === currentTrackIndex) li.classList.add('active-track');
        li.addEventListener('click', () => selectAndPlayTrack(index, system));
        listElement.appendChild(li);
    });
}

async function selectAndPlayTrack(index, system) {
    const songs = trackRegistry[system];
    if (!songs || !songs[index]) return;

    stopPlayback();
    currentTrackIndex = index;
    const selectedSong = songs[index];
    
    renderTracklist(system); 

    if (selectedSong.loadAsync) {
        currentScrollerText = "+++ DOWNLOADING AND PARSING BINARY YM FILE... +++";
        try {
            let parsedFile = await selectedSong.loadAsync();
            trackData = parsedFile.frames; 
            trackData.digidrums = parsedFile.digidrums;
            trackData.isYmFile = true; 
            
            let meta = parsedFile.metadata;
            
            currentScrollerText = `+++ BOOM! SUCCESSFULLY CRACKED OPEN BINARY FILE +++ NOW PLAYING: ${meta.name.toUpperCase()} BY ${meta.author.toUpperCase()} +++ COMMENT ALONG THE RIDE: ${meta.comment.toUpperCase() || "NO COMMENT"} +++ CRANK UP THE GAIN AND LET THE YM2149 MELT YOUR SPEAKERS +++ `;

            let techInfo = `<p><strong>File Signature:</strong> ${meta.type} (De-interleaved)</p>`;
            techInfo += `<p><strong>Length:</strong> ${trackData.length} Frames @ 50Hz VBLANK</p>`;
            
            if (meta.digidrumCount > 0) {
                techInfo += `<p style="margin-top: 5px;"><strong>PCM Data:</strong> ${meta.digidrumCount} Digidrum(s) detected!</p>`;
                let sizes = meta.digidrumSizes.map(s => s.toLocaleString('de-DE') + ' Bytes').join(' / ');
                techInfo += `<p style="font-size: 0.9em; margin-left: 10px; color: var(--text-color); opacity: 0.8;">> Sample sizes: [ ${sizes} ]</p>`;
            } else {
                techInfo += `<p style="margin-top: 5px;"><strong>PCM Data:</strong> None. 100% pure synthesized chip magic.</p>`;
            }

            document.getElementById('info-text').innerHTML = `
                <div style="margin-bottom: 20px;">
                    <h2 style="color: var(--highlight-color);">> NOW PLAYING:</h2>
                    <p style="font-size: 1.2em; border-bottom: 1px solid currentColor; padding-bottom: 5px;">${selectedSong.title}</p>
                </div>
                
                <div style="margin-top: 15px; padding: 10px; background: rgba(0,0,0,0.3); border: 1px dashed var(--highlight-color);">
                    <p style="color: var(--highlight-color); margin-bottom: 8px;"><strong>[ BINARY FILE ANALYSIS ]</strong></p>
                    ${techInfo}
                </div>
                
                <div style="margin-top: 30px; border-top: 2px dashed var(--text-color); padding-top: 15px;">
                    ${systemDescriptions[system]}
                </div>
                <p class="blinking-cursor" style="margin-top: 15px;">_</p>
            `;
            startPlayback();
        } catch (err) {
            alert("FEHLER BEIM LADEN: " + err.message);
            currentScrollerText = "+++ ERROR LOADING FILE +++";
        }
    } else {
        document.getElementById('info-text').innerHTML = `
            <div style="margin-bottom: 20px;">
                <h2 style="color: var(--highlight-color);">> NOW PLAYING:</h2>
                <p style="font-size: 1.2em; border-bottom: 1px solid currentColor; padding-bottom: 5px;">${selectedSong.title}</p>
            </div>
            ${selectedSong.composerInfo}
            
            <div style="margin-top: 30px; border-top: 2px dashed var(--text-color); padding-top: 15px;">
                ${systemDescriptions[system]}
            </div>
            <p class="blinking-cursor" style="margin-top: 15px;">_</p>
        `;
        currentScrollerText = "+++ NOW PLAYING: " + selectedSong.title + " +++";
        trackData = selectedSong.generator();
        startPlayback();
    }
}

// --- BUTTON EVENTS ---
document.getElementById('btn-play').addEventListener('click', () => {
    if (isPlaying) stopPlayback();
    else trackData.length === 0 ? selectAndPlayTrack(0, activeSystem) : startPlayback();
});
document.getElementById('btn-next').addEventListener('click', () => {
    selectAndPlayTrack((currentTrackIndex + 1) % trackRegistry[activeSystem].length, activeSystem);
});
document.getElementById('btn-prev').addEventListener('click', () => {
    let prevIdx = currentTrackIndex - 1;
    if (prevIdx < 0) prevIdx = trackRegistry[activeSystem].length - 1;
    selectAndPlayTrack(prevIdx, activeSystem);
});
document.getElementById('volume-slider').addEventListener('input', (e) => {
    if (masterGain) masterGain.gain.value = e.target.value;
});

document.getElementById('btn-hud-info').addEventListener('click', () => {
    const legend = document.getElementById('hud-legend');
    legend.innerHTML = chipCheatSheets[activeSystem]; 
    legend.classList.toggle('hidden');
});

// --- HIGH-PERFORMANCE CHIP HUD UPDATE ---
let cachedSystem = null; 
let hudValElements = [];

// NEU: Historien-Speicher für die Frequenz-Liniendiagramme (ca. 4-5 Sekunden Historie)
const HIST_LEN = 60; 
let pitchHistA = new Float32Array(HIST_LEN);
let pitchHistB = new Float32Array(HIST_LEN);
let pitchHistC = new Float32Array(HIST_LEN);
let histIdx = 0;

// Hilfsfunktion: Zeichnet das Liniendiagramm (Sparkline) ins Canvas
function drawSparkline(canvasId, historyArr, headIdx, color) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;

    // Dynamische Skalierung: Finde Min- und Max-Hz im Puffer, um die Welle optimal darzustellen
    let maxVal = 10;
    let minVal = 99999;
    for(let i=0; i<HIST_LEN; i++) {
        if(historyArr[i] > maxVal) maxVal = historyArr[i];
        if(historyArr[i] > 0 && historyArr[i] < minVal) minVal = historyArr[i];
    }
    if (minVal === 99999) minVal = 0;
    let range = maxVal - minVal;
    if (range < 100) range = 100; // Mindest-Zoom, damit Stille keine flackernde Linie macht

    for(let i=0; i<HIST_LEN; i++) {
        let actualIdx = (headIdx + i) % HIST_LEN;
        let val = historyArr[actualIdx];
        
        // Werte auf die Höhe des Canvas normalisieren (Y ist invertiert: 0 ist oben)
        let norm = (val - minVal) / range;
        let y = canvas.height - (norm * canvas.height);
        let x = (i / (HIST_LEN - 1)) * canvas.width;
        
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();
}

// --- KORRIGIERTE KANAL-FUNKTION ---
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

function updateChipHUD() {
    const matrix = document.getElementById('hud-matrix');

    // 1. DOM IMMER sofort neu aufbauen, wenn sich das System ändert (auch wenn die Musik stoppt!)
    if (cachedSystem !== activeSystem) {
        cachedSystem = activeSystem;
        
        if (activeSystem === 'atari') {
            // ADVANCED DSP ANALYZER LAYOUT FÜR ATARI
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
                            <!-- DIE KORREKTE GLOBAL TRIG LED -->
                            <div class="hud-row">
                                <label>Global Trig</label>
                                <span id="digi-g-val" class="hud-text-sel" style="flex-grow: 1;">--</span>
                                <div id="hud-digi-led" style="width: 10px; height: 10px; border-radius: 50%; background: #440000; border: 1px solid #ff0000; box-shadow: none;"></div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            
            // Historien leeren, falls wir von einem anderen Track zurückkommen
            pitchHistA.fill(0); pitchHistB.fill(0); pitchHistC.fill(0);

        } else {
            // FALLBACK HEX-MATRIX FÜR C64 & AMIGA (Baut sich nun auch im Stop-Modus auf!)
            // C64 hat 29 Register, Amiga hat 16 Register
            let regCount = activeSystem === 'c64' ? 29 : 16;
            let html = '';
            for (let i = 0; i < regCount; i++) {
                let regLabel = i.toString(16).toUpperCase().padStart(2, '0');
                // Standardwert "--" statt "00", bis Musik startet
                html += `<div class="hud-cell"><div class="hud-cell-label">R${regLabel}</div><div class="hud-cell-val" id="hud-val-${i}">--</div></div>`;
            }
            matrix.innerHTML = html;
            
            hudValElements = [];
            for (let i = 0; i < regCount; i++) {
                hudValElements.push(document.getElementById(`hud-val-${i}`));
            }
        }
    }
    
    // 2. SICHERHEITSSCHRANKE FÜR WERTE-UPDATES:
    // Wenn nichts gespielt wird, brechen wir HIER ab, VOR den physikalischen Berechnungen!
    if (!isPlaying || !currentChipRegs) return;
    
    // 3. High-Speed Update & Physik-Berechnung
    if (activeSystem === 'atari') {
        const r = currentChipRegs;
        
        // ... [AB HIER GEHT DEIN NORMALER CODE WEITER (Kanal A, etc.)] ...

        // KANAL A: Hertz Berechnung (2MHz / 16 / Period)
        let pitchA = ((r[1] & 0x0F) << 8) | r[0];
        let hzA = pitchA === 0 ? 0 : 2000000 / (16 * pitchA);
        if (hzA > 15000) hzA = 0; // Filtert unhörbare Ultraschall-Signale (125 kHz) heraus
        pitchHistA[histIdx] = hzA;
        document.getElementById('pitch-a-val').innerText = Math.round(hzA) + ' Hz';
        drawSparkline('pitch-a-chart', pitchHistA, (histIdx+1)%HIST_LEN, '#55ff55');
        
        let volA = r[8] & 0x0F;
        document.getElementById('vol-a-bar').style.width = (volA / 15 * 100) + '%';
        document.getElementById('vol-a-val').innerText = volA;
        document.getElementById('heg-a-led').className = (r[8] & 0x10) ? 'hud-led on' : 'hud-led';
        let digiA = (r[1] & 0xF0) >> 4;
        document.getElementById('digi-a').innerText = digiA > 0 ? `SMP #${digiA}` : '--';

        // KANAL B
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

        // KANAL C
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

        // Ringpuffer weiterdrehen
        histIdx = (histIdx + 1) % HIST_LEN;

        // NOISE (5-Bit Lookup Table anwenden!)
        let noiseP = r[6] & 0x1F;
        let exactHz = NOISE_LUT_HZ[noiseP];
        
        // Dynamische Formatierung, damit es sauber in die 75px Box passt
        let noiseStr = "";
        if (exactHz >= 10000) {
            noiseStr = (exactHz / 1000).toFixed(1) + " kHz"; // Aus 125000 wird "125.0 kHz"
        } else {
            noiseStr = exactHz + " Hz"; // Aus 8333 wird "8333 Hz"
        }

        document.getElementById('noise-bar').style.width = (noiseP / 31 * 100) + '%';
        document.getElementById('noise-val').innerText = noiseStr;

        let mix = r[7];
        document.getElementById('tone-a-led').className = (mix & 0x01) === 0 ? 'hud-led on' : 'hud-led';
        document.getElementById('tone-b-led').className = (mix & 0x02) === 0 ? 'hud-led on' : 'hud-led';
        document.getElementById('tone-c-led').className = (mix & 0x04) === 0 ? 'hud-led on' : 'hud-led';
        document.getElementById('noise-a-led').className = (mix & 0x08) === 0 ? 'hud-led on' : 'hud-led';
        document.getElementById('noise-b-led').className = (mix & 0x10) === 0 ? 'hud-led on' : 'hud-led';
        document.getElementById('noise-c-led').className = (mix & 0x20) === 0 ? 'hud-led on' : 'hud-led';

        // ENVELOPE (Hertz Berechnung: Takt / 256 / Period)
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
            if (s < 4) shapeStr = '\\___';
            else if (s < 8) shapeStr = '/___';
            else shapeStr = shapes[s] || `0x${s}`;
            shapeStr = `[0x${s.toString(16).toUpperCase()}] ` + shapeStr;
        }
        document.getElementById('env-shape-val').innerText = shapeStr;
        document.getElementById('digi-g-val').innerText = r[15] > 0 ? `SMP #${r[15]}` : '--';

} else {
        // C64 / AMIGA Fallback (Ausfallsicher!)
        for (let i = 0; i < currentChipRegs.length; i++) {
            if (!hudValElements[i]) continue; // Sicherheit: Verhindert Absturz beim schnellen Wechsel!
            let hexVal = currentChipRegs[i].toString(16).toUpperCase().padStart(2, '0');
            if (hudValElements[i].innerText !== hexVal) hudValElements[i].innerText = hexVal;
        }
    }
}

// --- ZONE 1: HIGH-PERFORMANCE OSZILLOSKOP, RASTERBARS & SPECTRUM ---
function initVisuals() {
    const canvas = document.getElementById('demo-canvas');
    const ctx = canvas.getContext('2d', { alpha: false }); 
    canvas.width = canvas.clientWidth; 
    canvas.height = canvas.clientHeight;
    
    const historyLength = canvas.width; 
    const oscHistory = new Float32Array(historyLength);
    let oscIndex = 0; 
    let startTime = performance.now();
    let hudCounter = 0; 

    const bufferLength = analyserNode ? analyserNode.frequencyBinCount : 512;
    const dataArray = new Uint8Array(bufferLength);
    const barCount = 48; 
    const peaks = new Array(barCount).fill(0); 

    function drawCopperBar(yCenter, thickness, color1, color2) {
        let grad = ctx.createLinearGradient(0, yCenter - thickness, 0, yCenter + thickness);
        grad.addColorStop(0, `rgba(0,0,0,0)`); grad.addColorStop(0.2, color1);
        grad.addColorStop(0.5, `rgba(255,255,255, 1)`); grad.addColorStop(0.8, color2);
        grad.addColorStop(1, `rgba(0,0,0,0)`);
        ctx.fillStyle = grad; ctx.fillRect(0, yCenter - thickness, canvas.width, thickness * 2);
    }

    function draw() {
        let t = (performance.now() - startTime) * 0.001; 
        
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)'; 
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        let audioPunch = Math.abs(currentOscValue) * 40; 
        const isAmiga = document.body.classList.contains('theme-amiga');
        const isAtari = document.body.classList.contains('theme-atari');
        
        let pal1 = isAtari ? ['#005500', '#00aa00'] : isAmiga ? ['#0000aa', '#0055ff'] : ['#352879', '#6c5eb5'];
        let pal2 = isAtari ? ['#555500', '#aaaa00'] : isAmiga ? ['#aa5500', '#ff8800'] : ['#aa0055', '#ff00aa'];
        let pal3 = isAtari ? ['#005555', '#00aaaa'] : isAmiga ? ['#5500aa', '#aa00ff'] : ['#555555', '#aaaaaa'];
        const lineColor = isAtari ? '#55ff55' : isAmiga ? '#ff8800' : '#6c5eb5';

        ctx.globalCompositeOperation = "screen"; 
        drawCopperBar((canvas.height / 2) + Math.sin(t * 1.2) * (canvas.height * 0.3), 25 + audioPunch, pal1[0], pal1[1]);
        drawCopperBar((canvas.height / 2) + Math.sin(t * 1.8 + 2.0) * (canvas.height * 0.35), 20 + (audioPunch * 0.8), pal2[0], pal2[1]);
        drawCopperBar((canvas.height / 2) + Math.sin(t * 1.5 + 4.0) * (canvas.height * 0.25), 15 + (audioPunch * 0.5), pal3[0], pal3[1]);
        ctx.globalCompositeOperation = "source-over";

        oscHistory[oscIndex] = currentOscValue;
        oscIndex = (oscIndex + 1) % historyLength; 
        
        ctx.beginPath();
        ctx.strokeStyle = lineColor;
        for (let x = 0; x < historyLength; x++) {
            let actualIndex = (oscIndex + x) % historyLength; 
            let y = (canvas.height / 2) - (oscHistory[actualIndex] * (canvas.height * 0.4)); 
            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.lineWidth = 6; ctx.globalAlpha = 0.3; ctx.stroke();
        ctx.lineWidth = 2; ctx.globalAlpha = 1.0; ctx.stroke();

        // --- SPECTRUM ANALYZER ---
        if (analyserNode && isPlaying) {
            analyserNode.getByteFrequencyData(dataArray);
            let barWidth = (canvas.width / barCount) - 2;
            let x = 0;
            
            let hzPerBin = audioCtx.sampleRate / analyserNode.fftSize;
            let minBin = Math.max(1, Math.floor(50 / hzPerBin)); 
            let maxBin = Math.floor(12000 / hzPerBin); 
            let lastEndBin = minBin;
            
            for (let i = 0; i < barCount; i++) {
                let startBin = lastEndBin;
                let endBin = Math.floor(minBin * Math.pow(maxBin / minBin, (i + 1) / barCount));
                if (endBin <= startBin) endBin = startBin + 1;
                lastEndBin = endBin;
                
                let sum = 0;
                for (let b = startBin; b < endBin; b++) sum += dataArray[b];
                let avg = sum / (endBin - startBin);
                
                let heightBoost = 1.0 + (i / barCount) * 0.5;
                let barHeight = ((avg * heightBoost) / 255.0) * (canvas.height * 0.4);
                
                if (barHeight > peaks[i]) peaks[i] = barHeight; 
                else { peaks[i] -= 1.5; if (peaks[i] < 0) peaks[i] = 0; }
                
                ctx.fillStyle = lineColor; ctx.globalAlpha = 0.7;
                ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
                
                if (peaks[i] > 2) {
                    ctx.globalAlpha = 1.0; ctx.fillStyle = '#ffffff';
                    ctx.fillRect(x, canvas.height - peaks[i] - 4, barWidth, 2);
                }
                x += barWidth + 2;
            }
            ctx.globalAlpha = 1.0;
        }

        hudCounter++;
        updateTimelineUI();
        if (hudCounter % 4 === 0) updateChipHUD();
        requestAnimationFrame(draw);
    }
    draw();
}

function initScroller() {
    const canvas = document.getElementById('scroller-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight;
    
    let offset = 0;          
    const speed = 2.5, frequency = 0.015, amplitude = canvas.height / 3; 
    const baseGreets = " +++ AT LAST, THE ULTIMATE HTML5 MUSIC DISK IS COMPLETE +++ CODE & DSP MAGIK RUNNING AT A SOLID 50 HZ VBLANK +++ DEEP CHIP EMULATION VIA AUDIOWORKLETS +++ NO MP3, NO BULLSHIT, JUST PURE MATHEMATICS +++ GREETS FLY OUT TO ALL THE PIXEL PUSHERS, CYCLE CRUNCHERS AND WAVEFORM WIZARDS OUT THERE +++ TO EVERYONE WHO STILL KEEPS THE SPIRIT OF THE 8-BIT AND 16-BIT ERA ALIVE +++ TO THE TRUE LOVERS OF DEMOSCENE ART AND CHIPTUNE MAGIC +++ LET THE ANALOG FILTERS BURN +++ WRAP AROUND +++ ";
    
    function draw() {
        ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        const isAmiga = document.body.classList.contains('theme-amiga');
        const isAtari = document.body.classList.contains('theme-atari');
        
        ctx.fillStyle = isAtari ? '#55ff55' : isAmiga ? '#ff8800' : '#6c5eb5';
        ctx.font = isAmiga || isAtari ? "32px 'VT323', monospace" : "24px 'Press Start 2P', monospace";
        ctx.textBaseline = "middle";
        
        let fullText = currentScrollerText + baseGreets;
        const charWidth = ctx.measureText("A").width;
        let startX = canvas.width - offset;
        
        for (let i = 0; i < fullText.length; i++) {
            let x = startX + (i * charWidth);
            if (x > -50 && x < canvas.width + 50) {
                let wave1 = Math.sin((x * 0.01) + (offset * 0.04)) * (canvas.height / 3);
                let wave2 = Math.cos((x * 0.02) + (offset * 0.07)) * (canvas.height / 6);
                ctx.fillText(fullText[i], x, (canvas.height / 2) + wave1 + wave2);
            }
        }
        offset = (offset + speed) > (charWidth * fullText.length + canvas.width) ? 0 : offset + speed;
        requestAnimationFrame(draw);
    }
    draw();
}