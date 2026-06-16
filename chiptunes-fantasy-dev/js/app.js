// --- IMPORT DER MODULE ---
import { trackRegistry } from '../tracks/registry.js';
import { createKickSample, createBassSample, createChordSample } from './utils/amiga-helper.js'; // <-- PFAD GEÄNDERT!

// --- GLOBALE VARIABLEN ---
let audioCtx;
let ymNode, paulaNode, sidNode; 
let masterGain;
let analyserNode; // NEU: Für die FFT Frequenz-Analyse
let currentOscValue = 0; 
let activeSystem = 'atari';
let trackData = [];    
let currentFrame = 0;  
let isPlaying = false; 
let currentTrackIndex = 0;
let currentScrollerText = "+++ INITIALIZING DEMO ENGINE... +++";
let lastKnownFrame = 0; // NEU: Merkt sich den Frame für die Timeline

// --- DIE PERMANENTEN HARDWARE-HANDBÜCHER ---
const systemDescriptions = {
    c64: `
        <div style="border: 1px solid var(--text-color); padding: 10px; margin-bottom: 15px; background: rgba(0,0,0,0.2);">
            <h3 style="color: var(--highlight-color); margin-bottom: 5px;">[ CHIP-SPECS: MOS SID 6581 ]</h3>
            <p>Ein echter, analoger subtraktiver Synthesizer auf einem Silizium-Chip. Besitzt 3 Oszillatoren, Hardware-ADSR-Hüllkurven und ein legendäres, rein analoges Multimode-Filter.</p>
            <p style="margin-top: 8px;"><strong>🔥 Szene-Hack (PWM):</strong> Da der C64 nur 3 Stimmen hat, modulierten Coder die Pulsweite der Rechteckwelle (PWM) in rasender Geschwindigkeit, um wabernde, extrem "dicke" Bässe zu erzeugen, die klingen, als liefen mehrere Oszillatoren gleichzeitig.</p>
        </div>
    `,
    amiga: `
        <div style="border: 1px solid var(--text-color); padding: 10px; margin-bottom: 15px; background: rgba(0,0,0,0.2);">
            <h3 style="color: var(--highlight-color); margin-bottom: 5px;">[ CHIP-SPECS: MOS PAULA 8364 ]</h3>
            <p>Paula revolutionierte den Sound durch Direct Memory Access (DMA). Anstatt Töne zu generieren, liest Paula 4 eigenständige 8-Bit PCM-Samples direkt aus dem RAM und pitcht sie in Hardware stufenlos hoch und runter.</p>
            <p style="margin-top: 8px;"><strong>🔥 Szene-Hack (Software-Mixing):</strong> Um das starre Hard-Panning (1&4 links, 2&3 rechts) und das 4-Kanal-Limit zu überwinden, mischten geniale Programmierer (wie Chris Hülsbeck) per CPU mehrere Samples zusammen, um 7-stimmige Polyphonie zu erreichen.</p>
        </div>
    `,
    atari: `
        <div style="border: 1px solid var(--text-color); padding: 10px; margin-bottom: 15px; background: rgba(0,0,0,0.2);">
            <h3 style="color: var(--highlight-color); margin-bottom: 5px;">[ CHIP-SPECS: YAMAHA YM2149F ]</h3>
            <p>Ein Klon des AY-3-8910, der im Atari ST mit 2.000.000 Hz getaktet war. Ein reiner Programmable Sound Generator (PSG) mit 3 Rechteck-Oszillatoren, 1 Noise-Generator (5-Bit LFSR) und 1 Hardware Envelope Generator (HEG, 16 feste Hüllkurven-Shapes). Er bot <em>keinen</em> PCM-Kanal und <em>keine</em> analogen Filter.</p>
            <p style="margin-top: 8px;"><strong>🔥 Szene-Hack 1 (Digidrums):</strong> Um PCM abzuspielen, hackten Coder CPU-Timer (oft 12.5 kHz), um das 4-Bit-Lautstärkeregister direkt zu überschreiben. Arnaud Carré (Leonard) versteckte diese Trigger für das <code>.ym</code> Format genial in den physikalisch ungenutzten Bits (Bit 4-7) der Frequenzregister.</p>
            <p style="margin-top: 8px;"><strong>🔥 Szene-Hack 2 (HEG Speech Synthesis):</strong> Für das Thalion-Intro nutzte Jochen Hippel <em>gar keine Samples!</em> Er missbrauchte den Hardware Envelope Generator (Register 13). Durch das Neustarten der Hardware-Hüllkurve in Audio-Geschwindigkeit verformte er die Rechteckwelle so massiv, dass der Chip wie menschliche Stimmbänder klang ("Tha-li-on") – reine Mathematik, 0 Kilobyte Speicherplatz!</p>
        </div>
    `
};

// --- BOOT SEQUENZ (Modul-sicher & Bulletproof) ---
function initApp() {
    // Event-Listener für die neuen Tabs (Bindung in JS)
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            setTheme(e.target.getAttribute('data-theme'));
        });
    });

    const bootScreen = document.getElementById("boot-screen");
    
    bootScreen.addEventListener("click", async () => {
        // BUGFIX: Wir suchen den Container erst genau jetzt beim Klick!
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

// Stellt sicher, dass das DOM geladen ist, bevor die Events gesetzt werden
if (document.readyState === 'loading') {
    document.addEventListener("DOMContentLoaded", initApp);
} else {
    initApp();
}

// --- AUDIO ENGINE CORE ---
async function initAudioEngine() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    try {
        // Pfade angepasst für Unterordner!
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
        analyserNode.fftSize = 4096; // NERD-PERFEKTION: 11,7 Hz Auflösung pro Bin!

        masterGain = audioCtx.createGain();
        masterGain.gain.value = 0.5; 
        
        // Routing: Chips -> MasterGain -> Analyser -> Lautsprecher
        ymNode.connect(masterGain);
        paulaNode.connect(amigaFilter).connect(masterGain);
        sidNode.connect(masterGain); 
        
        masterGain.connect(analyserNode);
        analyserNode.connect(audioCtx.destination);
        


        const visualHandler = (e) => {
            if (e.data.type === 'VISUAL_DATA') {
                currentOscValue = e.data.value;
                lastKnownFrame = e.data.frame || 0; 
                updateTimelineUI(); 
            }
            // LÄSST DIE ROTE LED FLACKERN
            /*
            if (e.data.type === 'DEBUG') {
                const led = document.getElementById('digi-led');
                if (led) {
                    led.style.background = '#ff0000';
                    led.style.boxShadow = '0 0 10px #ff0000';
                    setTimeout(() => { 
                        led.style.background = '#440000'; 
                        led.style.boxShadow = 'none';
                    }, 50);
                }
            }
            */
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

// Wandelt Frames (50Hz) in ein "MM:SS" Format um
function formatTime(frames) {
    if (!frames) return "00:00";
    let totalSeconds = Math.floor(frames / 50);
    let mins = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    let secs = (totalSeconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
}

// Aktualisiert den Balken und die Zeiten
function updateTimelineUI() {
    if (!isPlaying || trackData.length === 0) return;
    document.getElementById('time-current').innerText = formatTime(lastKnownFrame);
    document.getElementById('time-total').innerText = formatTime(trackData.length);
    document.getElementById('progress-slider').value = (lastKnownFrame / trackData.length) * 100;
}

// --- DER NEUE HIGH-PRECISION PLAYER ---
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
        // HIER WAR DER FEHLER: Wir müssen die Digidrums explizit mitsenden!
        ymNode.port.postMessage({ 
            type: 'PLAY_TRACK', 
            track: trackData, 
            digidrums: trackData.digidrums // <--- DAS IST DAS WICHTIGSTE KABEL!
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
    
    // 1. Playback stoppen und Tracklist neu zeichnen
    renderTracklist(activeSystem);
    stopPlayback(); 

    // 2. BUGFIX: Den Header im Museum sofort an das neue System anpassen
    const headerTitles = {
        'c64': '>>> INFO: MOS Technology SID 6581',
        'amiga': '>>> INFO: MOS Paula 8364',
        'atari': '>>> INFO: Yamaha YM2149 (Atari ST)'
    };
    document.querySelector('.museum-header').innerText = headerTitles[activeSystem];

    // 3. Das Museum auf "Warten" setzen, aber die Chip-Specs sofort anzeigen!
    document.getElementById('info-text').innerHTML = `
        ${systemDescriptions[activeSystem]}
        <div>
            <p style="color: var(--highlight-color);">[ SYSTEM READY ]</p>
            <p>Please select a track from the playlist to initialize playback and load data into memory...</p>
            <p class="blinking-cursor" style="margin-top: 15px;">_</p>
        </div>
    `;
    currentScrollerText = `+++ ${activeSystem.toUpperCase()} SYSTEM READY. AWAITING INPUT... +++`;

    // Setze auch den internen Track-Pointer zurück (damit der erste Klick auf "Next" oder "Play" klappt)
    trackData = [];
    currentTrackIndex = 0;
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
    document.getElementById('info-text').innerHTML = `
        <div style="margin-bottom: 20px;">
            <h2 style="color: var(--highlight-color);">> NOW PLAYING:</h2>
            <p style="font-size: 1.2em; border-bottom: 1px solid currentColor; padding-bottom: 5px;">${selectedSong.title}</p>
        </div>
        ${selectedSong.composerInfo}
        <p class="blinking-cursor" style="margin-top: 15px;">_</p>
    `;
    
    currentScrollerText = "+++ NOW PLAYING: " + selectedSong.title + " +++";
    
    // NEU: Asynchrones Laden von echten Dateien unterstützen!
    if (selectedSong.loadAsync) {
        currentScrollerText = "+++ DOWNLOADING AND PARSING BINARY YM FILE... +++";
try {
            let parsedFile = await selectedSong.loadAsync();
            trackData = parsedFile.frames; 
            trackData.digidrums = parsedFile.digidrums;
            trackData.isYmFile = true; 
            
            let meta = parsedFile.metadata;
            
            // 1. SCROLLER MIT SZENE-JARGON FÜTTERN
            currentScrollerText = `+++ BOOM! SUCCESSFULLY CRACKED OPEN BINARY FILE +++ NOW PLAYING: ${meta.name.toUpperCase()} BY ${meta.author.toUpperCase()} +++ COMMENT ALONG THE RIDE: ${meta.comment.toUpperCase() || "NO COMMENT"} +++ CRANK UP THE GAIN AND LET THE YM2149 MELT YOUR SPEAKERS +++ `;

            // 2. TECHNISCHE FILE-INFOS GENERIEREN
            let techInfo = `<p><strong>File Signature:</strong> ${meta.type} (De-interleaved)</p>`;
            techInfo += `<p><strong>Length:</strong> ${trackData.length} Frames @ 50Hz VBLANK</p>`;
            
            if (meta.digidrumCount > 0) {
                techInfo += `<p style="margin-top: 5px;"><strong>PCM Data:</strong> ${meta.digidrumCount} Digidrum(s) detected!</p>`;
                // NEU: Exakte Bytes statt fehleranfälliger Kilobyte-Rundung!
                let sizes = meta.digidrumSizes.map(s => s.toLocaleString('de-DE') + ' Bytes').join(' / ');
                techInfo += `<p style="font-size: 0.9em; margin-left: 10px; color: var(--text-color); opacity: 0.8;">> Sample sizes: [ ${sizes} ]</p>`;
            } else {
                techInfo += `<p style="margin-top: 5px;"><strong>PCM Data:</strong> None. 100% pure synthesized chip magic.</p>`;
            }

            // Museum füllen
            document.getElementById('info-text').innerHTML = `
                ${systemDescriptions[system]}
                <div style="margin-bottom: 20px;">
                    <h2 style="color: var(--highlight-color);">> NOW PLAYING:</h2>
                    <p style="font-size: 1.2em; border-bottom: 1px solid currentColor; padding-bottom: 5px;">${selectedSong.title}</p>
                </div>
                
                <div style="margin-top: 15px; padding: 10px; background: rgba(0,0,0,0.3); border: 1px dashed var(--highlight-color);">
                    <p style="color: var(--highlight-color); margin-bottom: 8px;"><strong>[ BINARY FILE ANALYSIS ]</strong></p>
                    ${techInfo}
                </div>
                <p class="blinking-cursor" style="margin-top: 15px;">_</p>
            `;
            
            startPlayback();
        } catch (err) {
            alert("FEHLER BEIM LADEN: " + err.message);
            currentScrollerText = "+++ ERROR LOADING FILE +++";
        }
} else {
        // Der alte Weg (Generatoren)
        document.getElementById('info-text').innerHTML = `
            ${systemDescriptions[system]} <!-- NEU: Das permanente Handbuch -->
            <div style="margin-bottom: 10px; margin-top: 20px;">
                <h2 style="color: var(--highlight-color);">> NOW PLAYING:</h2>
                <p style="font-size: 1.2em; border-bottom: 1px solid currentColor; padding-bottom: 5px;">${selectedSong.title}</p>
            </div>
            ${selectedSong.composerInfo}
            <p class="blinking-cursor" style="margin-top: 15px;">_</p>
        `;
        trackData = selectedSong.generator();
        startPlayback();
    }
}

// --- EVENTS ---
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

    // FFT Setup
    const bufferLength = analyserNode ? analyserNode.frequencyBinCount : 512;
    const dataArray = new Uint8Array(bufferLength);
    
    // Für den Hardware-EQ Look (Winamp Style)
    const barCount = 48; 
    const peaks = new Array(barCount).fill(0); // Speichert die Höhe der kleinen "Hütchen"

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

// --- 4. DER LOGARITHMISCHE SPECTRUM ANALYZER (Nerd Perfection) ---
        if (analyserNode && isPlaying) {
            analyserNode.getByteFrequencyData(dataArray);
            
            let barWidth = (canvas.width / barCount) - 2;
            let x = 0;
            
            // Frequenz-Fenster definieren (z.B. 50 Hz bis 12.000 Hz)
            // Bei 48.000Hz Samplerate und FFT 4096 entspricht ein Bin ca. 11.7 Hz
            // audioCtx.sampleRate ist meist 48000
            let hzPerBin = audioCtx.sampleRate / analyserNode.fftSize;
            let minBin = Math.max(1, Math.floor(50 / hzPerBin)); // Startet bei ca. 50 Hz
            let maxBin = Math.floor(12000 / hzPerBin); // Endet bei ca. 12 kHz
            
            let lastEndBin = minBin;
            
            for (let i = 0; i < barCount; i++) {
                let startBin = lastEndBin;
                
                // Echte logarithmische Frequenz-Spreizung (Oktaven-basiert)
                // Die Formel: end = min * (max/min) ^ (i / (bars-1))
                let endBin = Math.floor(minBin * Math.pow(maxBin / minBin, (i + 1) / barCount));
                
                // Absolute Sicherheit: Kein Balken darf denselben Bin lesen wie sein Nachbar!
                if (endBin <= startBin) endBin = startBin + 1;
                lastEndBin = endBin;
                
                // Durchschnittliche Amplitude in diesem Frequenzbereich berechnen
                let sum = 0;
                for (let b = startBin; b < endBin; b++) {
                    sum += dataArray[b];
                }
                let avg = sum / (endBin - startBin);
                
                // Sanfte Anhebung der Höhen (High-Shelf EQ visuell simulieren), 
                // da hohe Frequenzen mathematisch weniger Energie haben als fette Bässe
                let heightBoost = 1.0 + (i / barCount) * 0.5;
                
                let barHeight = ((avg * heightBoost) / 255.0) * (canvas.height * 0.4);
                
                // Schwerkraft für die Peak-Hütchen
                if (barHeight > peaks[i]) {
                    peaks[i] = barHeight; 
                } else {
                    peaks[i] -= 1.5; 
                    if (peaks[i] < 0) peaks[i] = 0;
                }
                
                // Balken zeichnen
                ctx.fillStyle = lineColor;
                ctx.globalAlpha = 0.7;
                ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
                
                // Peak-Hütchen zeichnen
                if (peaks[i] > 2) {
                    ctx.globalAlpha = 1.0;
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(x, canvas.height - peaks[i] - 4, barWidth, 2);
                }
                
                x += barWidth + 2;
            }
            ctx.globalAlpha = 1.0;
        }
        
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
        ctx.font = isAmiga || isAtari ? "24px 'VT323', monospace" : "16px 'Press Start 2P', monospace";
        ctx.textBaseline = "middle";
        
        let fullText = currentScrollerText + baseGreets;
        const charWidth = ctx.measureText("A").width;
        let startX = canvas.width - offset;
        
        for (let i = 0; i < fullText.length; i++) {
            let x = startX + (i * charWidth);
            if (x > -50 && x < canvas.width + 50) {
                ctx.fillText(fullText[i], x, (canvas.height / 2) + Math.sin((x * frequency) + (offset * 0.05)) * amplitude);
            }
        }
        offset = (offset + speed) > (charWidth * fullText.length + canvas.width) ? 0 : offset + speed;
        requestAnimationFrame(draw);
    }
    draw();
}