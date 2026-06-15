// --- IMPORT DER MODULE ---
import { trackRegistry } from '../tracks/registry.js';
import { createKickSample, createBassSample, createChordSample } from '../tracks/amiga/amiga_helper.js';

// --- GLOBALE VARIABLEN ---
let audioCtx;
let ymNode, paulaNode, sidNode; 
let masterGain;
let currentOscValue = 0; 
let activeSystem = 'atari';
let trackData = [];    
let currentFrame = 0;  
let isPlaying = false; 
let currentTrackIndex = 0;
let currentScrollerText = "+++ INITIALIZING DEMO ENGINE... +++";

// --- BOOT SEQUENZ (Modul-sicher) ---
function initApp() {
    const bootScreen = document.getElementById("boot-screen");
    const demoContainer = document.getElementById("demo-container");

    // Event-Listener für die neuen Tabs (Bindung in JS, nicht in HTML!)
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            setTheme(e.target.getAttribute('data-theme'));
        });
    });

    bootScreen.addEventListener("click", async () => {
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

        masterGain = audioCtx.createGain();
        masterGain.gain.value = 0.5; 
        masterGain.connect(audioCtx.destination);
        
        ymNode.connect(masterGain);
        paulaNode.connect(amigaFilter).connect(masterGain);
        sidNode.connect(masterGain); 
        
        const visualHandler = (e) => {
            if (e.data.type === 'VISUAL_DATA') currentOscValue = e.data.value;
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

// --- PLAYER LOGIK ---
function startPlayback() {
    if (isPlaying || trackData.length === 0) return;
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

    isPlaying = true;
    let isAmiga = trackData[0] && trackData[0].isAmiga;
    let isC64 = trackData[0] && trackData[0].isC64;
    
    if (isAmiga) paulaNode.port.postMessage({ type: 'PLAY_TRACK', track: trackData });
    else if (isC64) sidNode.port.postMessage({ type: 'PLAY_TRACK', track: trackData });
    else ymNode.port.postMessage({ type: 'PLAY_TRACK', track: trackData });
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

    // 3. BUGFIX: Das Museum und den Scroller auf "Warten" setzen, bis ein Track geklickt wird
    document.getElementById('info-text').innerHTML = `
        <p style="color: var(--highlight-color);">[ SYSTEM READY ]</p>
        <p>Please select a track from the playlist to initialize playback and load data into memory...</p>
        <p class="blinking-cursor" style="margin-top: 15px;">_</p>
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

function selectAndPlayTrack(index, system) {
    const songs = trackRegistry[system];
    if (!songs || !songs[index]) return;

    stopPlayback();
    currentTrackIndex = index;
    const selectedSong = songs[index];
    trackData = selectedSong.generator();
    
    renderTracklist(system); 

    // Update den System-Header im Museum
    const headerTitles = {
        'c64': '>>> INFO: MOS Technology SID 6581',
        'amiga': '>>> INFO: MOS Paula 8364',
        'atari': '>>> INFO: Yamaha YM2149 (Atari ST)'
    };
    document.querySelector('.museum-header').innerText = headerTitles[system];

    document.getElementById('info-text').innerHTML = `
        <div style="margin-bottom: 20px;">
            <h2 style="color: var(--highlight-color);">> NOW PLAYING:</h2>
            <p style="font-size: 1.2em; border-bottom: 1px solid currentColor; padding-bottom: 5px;">${selectedSong.title}</p>
        </div>
        ${selectedSong.composerInfo}
        <p class="blinking-cursor" style="margin-top: 15px;">_</p>
    `;
    
    currentScrollerText = "+++ NOW PLAYING: " + selectedSong.title + " +++";
    startPlayback();
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

// --- VISUALS ---
function initVisuals() {
    const canvas = document.getElementById('demo-canvas');
    const ctx = canvas.getContext('2d', { alpha: false }); 
    canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight;
    const historyLength = canvas.width; 
    const oscHistory = new Float32Array(historyLength);
    let oscIndex = 0; 
    let startTime = performance.now();

    function drawCopperBar(yCenter, thickness, color1, color2) {
        let grad = ctx.createLinearGradient(0, yCenter - thickness, 0, yCenter + thickness);
        grad.addColorStop(0, `rgba(0,0,0,0)`); grad.addColorStop(0.2, color1);
        grad.addColorStop(0.5, `rgba(255,255,255, 1)`); grad.addColorStop(0.8, color2);
        grad.addColorStop(1, `rgba(0,0,0,0)`);
        ctx.fillStyle = grad; ctx.fillRect(0, yCenter - thickness, canvas.width, thickness * 2);
    }

    function draw() {
        let t = (performance.now() - startTime) * 0.001; 
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        let audioPunch = Math.abs(currentOscValue) * 40; 
        const isAmiga = document.body.classList.contains('theme-amiga');
        const isAtari = document.body.classList.contains('theme-atari');
        let pal1 = isAtari ? ['#005500', '#00aa00'] : isAmiga ? ['#0000aa', '#0055ff'] : ['#352879', '#6c5eb5'];
        let pal2 = isAtari ? ['#555500', '#aaaa00'] : isAmiga ? ['#aa5500', '#ff8800'] : ['#aa0055', '#ff00aa'];
        let pal3 = isAtari ? ['#005555', '#00aaaa'] : isAmiga ? ['#5500aa', '#aa00ff'] : ['#555555', '#aaaaaa'];

        ctx.globalCompositeOperation = "screen"; 
        drawCopperBar((canvas.height / 2) + Math.sin(t * 1.2) * (canvas.height * 0.3), 25 + audioPunch, pal1[0], pal1[1]);
        drawCopperBar((canvas.height / 2) + Math.sin(t * 1.8 + 2.0) * (canvas.height * 0.35), 20 + (audioPunch * 0.8), pal2[0], pal2[1]);
        drawCopperBar((canvas.height / 2) + Math.sin(t * 1.5 + 4.0) * (canvas.height * 0.25), 15 + (audioPunch * 0.5), pal3[0], pal3[1]);
        ctx.globalCompositeOperation = "source-over";

        oscHistory[oscIndex] = currentOscValue;
        oscIndex = (oscIndex + 1) % historyLength; 
        ctx.beginPath();
        ctx.strokeStyle = isAtari ? '#55ff55' : isAmiga ? '#ff8800' : '#6c5eb5';
        for (let x = 0; x < historyLength; x++) {
            let actualIndex = (oscIndex + x) % historyLength; 
            let y = (canvas.height / 2) - (oscHistory[actualIndex] * (canvas.height * 0.4)); 
            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.lineWidth = 6; ctx.globalAlpha = 0.3; ctx.stroke();
        ctx.lineWidth = 2; ctx.globalAlpha = 1.0; ctx.stroke();
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