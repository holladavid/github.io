// === js/app.js ===
// =========================================================================
//                  CHIPTUNES FANTASY - MAIN APP CONTROLLER
// =========================================================================

import { trackRegistry } from '../tracks/registry.js';
import { systemDescriptions, chipCheatSheets } from './content/museum.js'; 
import { workletRegistry } from './worklets/registry.js';
import { initScroller } from './visuals/scroller.js'; 
import { initVisuals } from './visuals/visualizer.js'; 
import { updateChipHUD, resetHUD } from './ui/hud-debugger.js'; 
import { 
    initAudioEngine, 
    loadEmuCore, 
    resumeAudioContext,
    getAudioContext, 
    getAnalyserNode, 
    getMasterGain, 
    getYmNode, 
    getPaulaNode, 
    getSidNode 
} from './audio/audio-controller.js';

let currentOscValue = 0; 
let currentChipRegs = null; 
let activeSystem = 'atari';
let trackData = [];    
let isPlaying = false; 
let currentTrackIndex = 0;
let currentScrollerText = "+++ INITIALIZING DEMO ENGINE... +++";
let lastKnownFrame = 0; 
let previousFrame = 0;       
let lastTrackChangeTime = 0; 
let isEcoMode = false;      
let isUserDragging = false; 
let currentSubsongIndex = 1; 
// Globales Array für die Kanallautstärken (Zero-Allocation)
let channelVolumes = new Float32Array(4);

function initApp() {
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('sw.js')
                .then(reg => console.log('[PWA] Service Worker erfolgreich gekoppelt.', reg.scope))
                .catch(err => console.warn('[PWA] Service-Worker-Kopplung fehlgeschlagen.', err));
        });
    }

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            setTheme(e.target.getAttribute('data-theme'));
        });
    });

    const bootScreen = document.getElementById("boot-screen");
    bootScreen.addEventListener("click", async () => {
        const demoContainer = document.getElementById("demo-container");
        if (!demoContainer) return;

        bootScreen.classList.add("hidden");
        demoContainer.classList.remove("hidden");
        
        await initAudioEngine();
        
        try {
            await loadEmuCore('atari', workletRegistry.atari[0], handleWorkletMessage);
            await loadEmuCore('c64', workletRegistry.c64[0], handleWorkletMessage);
            await loadEmuCore('amiga', workletRegistry.amiga[0], handleWorkletMessage);
        } catch (err) {
            console.error("[CRITICAL] Cores konnten nicht geladen werden:", err);
        }

        initVisuals({
            getEcoMode: () => isEcoMode,
            getCurrentOscValue: () => currentOscValue,
            getChannelVolumes: () => channelVolumes, // === DIESEN GETTER HIER ERGÄNZEN ===
            getTrackData: () => trackData,
            getAnalyserNode: getAnalyserNode,  
            getIsPlaying: () => isPlaying,
            getAudioContext: getAudioContext  
        }, {
            updateTimelineUI: () => updateTimelineUI(),
            updateChipHUD: () => updateChipHUD({
                getActiveSystem: () => activeSystem,
                getIsPlaying: () => isPlaying,
                getCurrentChipRegs: () => currentChipRegs
            })
        });
        
        initScroller(() => currentScrollerText, () => isEcoMode); 
        
        // INTERAKTIVE SKEUOMORPHIC LED KOPPLUNG (AMIGA)
        document.getElementById('chip-hud').addEventListener('click', (e) => {
            if (e.target && e.target.id === 'amiga-led-pwr') {
                // Sendet den Umschalt-Zyklus (Auto -> Force ON -> Force OFF -> Auto) an das Worklet
                const paulaNode = getPaulaNode();
                if (paulaNode) {
                    paulaNode.port.postMessage({ type: 'CYCLE_FILTER' });
                }
            }
        });

        setTheme('theme-c64');
    });
}

if (document.readyState === 'loading') document.addEventListener("DOMContentLoaded", initApp);
else initApp();

function formatTime(frames) {
    if (!frames) return "00:00";
    let totalSeconds = Math.floor(frames / 50);
    let mins = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    let secs = (totalSeconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
}

function updateTimelineUI() {
    if (!isPlaying || trackData.length === 0) return;
    if (!isUserDragging) {
        document.getElementById('time-current').innerText = formatTime(lastKnownFrame);
        document.getElementById('time-total').innerText = formatTime(trackData.length);
        document.getElementById('progress-slider').value = (lastKnownFrame / trackData.length) * 100;
    }
}

const progressSlider = document.getElementById('progress-slider');
progressSlider.addEventListener('mousedown', () => { isUserDragging = true; });
progressSlider.addEventListener('mouseup', () => { isUserDragging = false; });
progressSlider.addEventListener('touchstart', () => { isUserDragging = true; });
progressSlider.addEventListener('touchend', () => { isUserDragging = false; });

progressSlider.addEventListener('input', (e) => {
    if (trackData.length === 0) return;
    const targetPercent = parseFloat(e.target.value);
    const targetFrame = Math.floor((targetPercent / 100) * trackData.length);
    document.getElementById('time-current').innerText = formatTime(targetFrame);
});

progressSlider.addEventListener('change', (e) => {
    if (trackData.length === 0) return;
    const targetPercent = parseFloat(e.target.value);
    const targetFrame = Math.floor((targetPercent / 100) * trackData.length);
    
    lastKnownFrame = targetFrame;
    previousFrame = targetFrame;

    const seekMsg = { type: 'SEEK_TRACK', frame: targetFrame };
    const paulaNode = getPaulaNode();
    const sidNode = getSidNode();
    const ymNode = getYmNode();

    if (activeSystem === 'amiga' && paulaNode) {
        paulaNode.port.postMessage(seekMsg);
    } else if (activeSystem === 'c64' && sidNode) {
        sidNode.port.postMessage(seekMsg);
    } else if (ymNode) {
        ymNode.port.postMessage(seekMsg);
    }
});

function handleWorkletMessage(e) {
    if (e.data && e.data.constructor && e.data.constructor.name === 'Float32Array') {
        const view = e.data;
        const systemId = view[0];
        const isPlayingVal = view[1] === 1;
        const frameVal = view[2];
        currentOscValue = view[3];

        if (!currentChipRegs) {
            currentChipRegs = new Uint8Array(32);
        }
        
        for (let i = 0; i < 32; i++) {
            currentChipRegs[i] = view[4 + i];
            // === AUSLESEN DER EINZELNEN KANAL-LAUTSTÄRKEN FÜR RASTER-BARS ===
            channelVolumes[0] = view[34];
            channelVolumes[1] = view[35];
            channelVolumes[2] = view[36];
            channelVolumes[3] = view[37];            
        }

        // === THERMISCHES FEEDBACK FÜR DEN SID-FILTER ===
        if (systemId === 0) {
            const tempVal = Math.round(view[33]);
            currentChipRegs[29] = tempVal; // In virtuellem Register 29 parken für HUD
        }


        // AUSSCHNITT 1: Der Klick-Event-Listener im boot-screen-Block (ca. Zeile 80)
        document.getElementById('chip-hud').addEventListener('click', (e) => {
            if (e.target && e.target.id === 'amiga-led-pwr') {
                // Sendet den Umschalt-Zyklus (Auto -> Force ON -> Force OFF -> Auto) an das Worklet
                const paulaNode = getPaulaNode();
                if (paulaNode) {
                    paulaNode.port.postMessage({ type: 'CYCLE_FILTER' });
                }
            }
        });


        // AUSSCHNITT 2: Der Message-Port-Receiver in handleWorkletMessage(e) (ca. Zeile 200)
        if (systemId === 1) {
            const ledState = Math.round(view[33]);
            const overrideState = Math.round(view[38]); // Auslesen des 3-Stufen-Status (0: Auto, 1: Force ON, 2: Force OFF)
            currentChipRegs[29] = ledState; 
            currentChipRegs[30] = overrideState; 
            
            const pwrLed = document.getElementById('amiga-led-pwr');
            if (pwrLed) {
                if (ledState === 0) { // Filter ist AUS -> LED leuchtet HELL!
                    pwrLed.classList.add('on');
                    pwrLed.style.background = '#ff0000';
                    pwrLed.style.boxShadow = '0 0 8px #ff0000';
                } else { // Filter ist AN -> LED ist GEDIMMT!
                    pwrLed.classList.remove('on');
                    pwrLed.style.background = '#440000';
                    pwrLed.style.boxShadow = 'none';
                }
            }

            // === DYNAMISCHES OVERRIDE LABEL UPDATE ===
            // Schaltet sich vollautomatisch ab, wenn wir wieder im Auto-Modus (0) angekommen sind!
            const pwrLedOverride = document.getElementById('amiga-led-override');
            if (pwrLedOverride) {
                pwrLedOverride.style.display = overrideState > 0 ? 'block' : 'none';
            }
        }

        previousFrame = lastKnownFrame;
        lastKnownFrame = frameVal;

        if (isPlaying && trackData.length > 0) {
            if (previousFrame > trackData.length - 20 && lastKnownFrame < 10) {
                if (performance.now() - lastTrackChangeTime > 2000) {
                    lastTrackChangeTime = performance.now(); 
                    
                    if (activeSystem === 'c64' && trackData.isSidFile) {
                        const totalSongs = trackData.metadata.songs || 1;
                        if (currentSubsongIndex < totalSongs) {
                            changeC64Subsong(currentSubsongIndex + 1);
                            return; 
                        }
                    }

                    let nextIdx = (currentTrackIndex + 1) % trackRegistry[activeSystem].length;
                    selectAndPlayTrack(nextIdx, activeSystem);
                }
            }
        }
        return; 
    }

    if (e.data.type === 'VISUAL_DATA') {
        currentOscValue = e.data.value;
        previousFrame = lastKnownFrame;
        lastKnownFrame = e.data.frame || 0; 
        currentChipRegs = e.data.regs; 
    }
    
    if (e.data.type === 'DEBUG') {
        if (isEcoMode) return; 

        let match = e.data.msg.match(/Drum (\d+)/);
        let drumNo = match ? "SMP #" + match[1] : "TRIG";
        
        const led = document.getElementById('hud-digi-led');
        const val = document.getElementById('digi-g-val'); 
        
        if (led && val) {
            val.innerText = drumNo;
            val.style.color = '#ffffff';
            val.style.textShadow = '0 0 10px #ffffff';
            led.style.background = '#ff0000';
            led.style.boxShadow = '0 0 12px #ff0000';
            
            if (val.timeoutId) clearTimeout(val.timeoutId);
            val.timeoutId = setTimeout(() => { 
                led.style.background = '#440000'; 
                led.style.boxShadow = 'none';
                val.style.color = ''; 
                val.style.textShadow = 'none';
                val.innerText = '--'; 
            }, 120);
        }
    }
}

function changeC64Subsong(subsongId) {
    const sidNode = getSidNode();
    if (activeSystem === 'c64' && trackData && trackData.isSidFile && sidNode) { 
        sidNode.port.postMessage({ 
            type: 'CHANGE_SUBSONG', 
            frame: subsongId,
            length: trackData.length 
        });
        currentSubsongIndex = subsongId;

        let sldbLengths = trackData.lengths || [180];
        let songLengthSeconds = sldbLengths[subsongId - 1] || sldbLengths[0] || 180;
        trackData.length = songLengthSeconds * 50; 

        lastKnownFrame = 0;
        previousFrame = 0;
        document.getElementById('time-current').innerText = "00:00";
        document.getElementById('time-total').innerText = formatTime(trackData.length);
        document.getElementById('progress-slider').value = 0;

        const subsongDisplay = document.getElementById('subsong-display');
        if (subsongDisplay) {
            subsongDisplay.innerText = `[SUB ${subsongId}/${trackData.metadata.songs}]`;
        }

        let meta = trackData.metadata;
        currentScrollerText = `+++ BOOM! SWITCHED TO SUBSONG ${subsongId} OF ${meta.songs} +++ NOW PLAYING: ${meta.name.toUpperCase()} (TRACK ${subsongId}) BY ${meta.author.toUpperCase()} +++ `;
    }    
}

function startPlayback() {
    if (isPlaying || trackData.length === 0) return;
    resumeAudioContext().catch(e=>console.log(e));

    isPlaying = true;
    
    let isAmiga = (trackData[0] && trackData[0].isAmiga) || trackData.isAmigaFile;
    let isC64 = (trackData[0] && trackData[0].isC64) || trackData.isSidFile;
    
    const paulaNode = getPaulaNode();
    const sidNode = getSidNode();
    const ymNode = getYmNode();
    
    if (isAmiga) {
        if (paulaNode) paulaNode.port.postMessage({ type: 'PLAY_TRACK', track: trackData });
    } else if (isC64) {
        if (sidNode) {
            if (trackData.isSidFile) {
                sidNode.port.postMessage(trackData); 
            } else {
                sidNode.port.postMessage({ type: 'PLAY_TRACK', track: trackData });
            }
        }
    } else {
        if (ymNode) {
            ymNode.port.postMessage({ 
                type: 'PLAY_TRACK', 
                track: trackData, 
                digidrums: trackData.digidrums 
            });
        }
    }
}

function resumePlayback() {
    if (isPlaying || trackData.length === 0) return;
    resumeAudioContext().catch(e=>console.log(e));
    isPlaying = true;
    
    const paulaNode = getPaulaNode();
    const sidNode = getSidNode();
    const ymNode = getYmNode();

    if (activeSystem === 'amiga' && paulaNode) paulaNode.port.postMessage({ type: 'RESUME_TRACK' });
    else if (activeSystem === 'c64' && sidNode) sidNode.port.postMessage({ type: 'RESUME_TRACK' });
    else if (ymNode) ymNode.port.postMessage({ type: 'RESUME_TRACK' });
}

function stopPlayback() {
    if (!isPlaying) return;
    isPlaying = false;
    
    const paulaNode = getPaulaNode();
    const sidNode = getSidNode();
    const ymNode = getYmNode();

    if (ymNode) ymNode.port.postMessage({ type: 'STOP_TRACK' });
    if (paulaNode) paulaNode.port.postMessage({ type: 'STOP_TRACK' });
    if (sidNode) sidNode.port.postMessage({ type: 'STOP_TRACK' });
}

function setTheme(themeName) {
    document.body.className = themeName;
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
        tab.classList.remove('active');
        if (tab.getAttribute('data-theme') === themeName) tab.classList.add('active');
    });

    activeSystem = themeName === 'theme-atari' ? 'atari' : themeName === 'theme-amiga' ? 'amiga' : 'c64';
    
    const tempContainer = document.getElementById('temp-control-container');
    if (tempContainer) {
        if (activeSystem === 'c64') tempContainer.classList.remove('hidden');
        else tempContainer.classList.add('hidden');
    }

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

    const hudBody = document.getElementById('hud-body');
    if (hudBody) hudBody.classList.add('hidden');
    
    const hudMain = document.getElementById('chip-hud'); 
    if (hudMain) hudMain.classList.add('collapsed');     
    
    const hudToggleBtn = document.getElementById('btn-hud-toggle');
    if (hudToggleBtn) hudToggleBtn.innerText = '[+]';
    
    const infoBtn = document.getElementById('btn-hud-info');
    if (infoBtn) infoBtn.classList.add('hidden');

    trackData = [];
    currentTrackIndex = 0;
    currentChipRegs = null;
    
    resetHUD();
    
    document.getElementById('progress-slider').value = 0;
    document.getElementById('progress-slider').disabled = true;
    document.getElementById('time-current').innerText = "00:00";
    document.getElementById('time-total').innerText = "00:00";
    
    const subsongDisplay = document.getElementById('subsong-display');
    if (subsongDisplay) {
        subsongDisplay.classList.add('hidden');
        subsongDisplay.innerText = "";
    }
    
    renderCoreSelector(activeSystem);
}

function renderCoreSelector(system) {
    const select = document.getElementById('core-selector');
    select.innerHTML = '';
    workletRegistry[system].forEach((core, index) => {
        const opt = document.createElement('option');
        opt.value = index;
        let cpuLoad = core.cpu || 1;
        let meter = '';
        for (let i = 1; i <= 4; i++) {
            meter += (i <= cpuLoad) ? '■' : '□';
        }
        opt.text = `${core.name} • CPU:${meter}`;
        select.appendChild(opt);
    });
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
    lastTrackChangeTime = performance.now();

    if (getAudioContext() && getAudioContext().state === 'suspended') {
        resumeAudioContext().catch(e => console.log("AudioContext resume blockiert:", e));
    }

    // === REPARIERT: Auslesen der Songliste des aktiven Systems ===
    const songs = trackRegistry[system]; 
    if (!songs || !songs[index]) return;

    // === SOFORTIGER RESET DES OVERRIDE-LABELS BEI TRACKWECHSEL ===
    const pwrLedOverride = document.getElementById('amiga-led-override');
    if (pwrLedOverride) pwrLedOverride.style.display = 'none';

    stopPlayback();
    currentTrackIndex = index;
    const selectedSong = songs[index];
    
    lastKnownFrame = 0;
    previousFrame = 0; 
    
    resetHUD();

    document.getElementById('progress-slider').disabled = false;
    renderTracklist(system); 

    if (selectedSong.loadAsync) {
        const isAmigaSystem = (system === 'amiga');
        const isC64System = (system === 'c64');
        
        currentScrollerText = isAmigaSystem 
            ? "+++ DOWNLOADING AND PARSING BINARY AMIGA MODULE... +++"
            : (isC64System ? "+++ DOWNLOADING AND PARSING BINARY C64 PSID FILE... +++" : "+++ DOWNLOADING AND PARSING BINARY YM FILE... +++");
        
        try {
            let parsedFile = await selectedSong.loadAsync();
            
            if (isC64System) {
                trackData = parsedFile; 
                currentSubsongIndex = parsedFile.startSong || 1; 
                
                let sldbLengths = trackData.lengths || [180];
                let songLengthSeconds = sldbLengths[currentSubsongIndex - 1] || sldbLengths[0] || 180;
                trackData.length = songLengthSeconds * 50; 
                
                const subsongDisplay = document.getElementById('subsong-display');
                if (subsongDisplay) {
                    subsongDisplay.innerText = `[SUB ${currentSubsongIndex}/${parsedFile.metadata.songs}]`;
                    subsongDisplay.classList.remove('hidden');
                }
            } else {
                const subsongDisplay = document.getElementById('subsong-display');
                if (subsongDisplay) {
                    subsongDisplay.classList.add('hidden');
                    subsongDisplay.innerText = "";
                }

                if (parsedFile.isSequenced) {
                    trackData = parsedFile; 
                } else {
                    trackData = parsedFile.frames; 
                    trackData.digidrums = parsedFile.digidrums || [];
                }
                
                if (isAmigaSystem) {
                    trackData.isAmigaFile = true; 
                    
                    const paulaNode = getPaulaNode();
                    if (parsedFile.samples && paulaNode) {
                        for (let sampleName in parsedFile.samples) {
                            paulaNode.port.postMessage({
                                type: 'UPLOAD_SAMPLE',
                                name: sampleName,
                                data: parsedFile.samples[sampleName]
                            });
                        }
                    }
                } else {
                    trackData.isYmFile = true;
                }
            }

            let meta = parsedFile.metadata;
            currentScrollerText = isAmigaSystem
                ? `+++ BOOM! SUCCESSFULLY DECODED AMIGA MODULE +++ NOW PLAYING: ${meta.name.toUpperCase()} BY ${meta.author.toUpperCase()} +++ FORMAT: ${meta.type} +++ THIS IS PURE PROTRACKER MAGIC +++ `
                : (isC64System
                    ? `+++ BOOM! SUCCESSFULLY CRACKED OPEN BINARY PSID FILE +++ NOW PLAYING: ${meta.name.toUpperCase()} BY ${meta.author.toUpperCase()} +++ FORMAT: ${meta.type} +++ CRANK UP THE VOLUME AND LET THE ANALOG SID FILTERS SHINE +++ `
                    : `+++ BOOM! SUCCESSFULLY CRACKED OPEN BINARY FILE +++ NOW PLAYING: ${meta.name.toUpperCase()} BY ${meta.author.toUpperCase()} +++ COMMENT ALONG THE RIDE: ${meta.comment.toUpperCase() || "NO COMMENT"} +++ CRANK UP THE GAIN AND LET THE YM2149 MELT YOUR SPEAKERS +++ `);

// === js/app.js (Ausschnitt: selectAndPlayTrack ab ca. Zeile 435) ===
// ... [Dateianalyse-Logik] ...

            let techInfo = "";
            if (isAmigaSystem) {
                techInfo += `<p><strong>File Signature:</strong> ${meta.type}</p>`;
                techInfo += `<p><strong>Size in Memory:</strong> ${meta.fileSize.toLocaleString('de-DE')} Bytes</p>`;
                techInfo += `<p><strong>Structure:</strong> ${meta.patternCount} Patterns, ${meta.instrumentCount} Synthesized Amiga Instruments</p>`;
                techInfo += `<p><strong>Paula Configuration:</strong> 4 Channels, Direct DMA emulation</p>`;
            } else if (isC64System) {
                techInfo += `<p><strong>File Signature:</strong> ${meta.type}</p>`;
                techInfo += `<p><strong>Size in Memory:</strong> ${meta.fileSize.toLocaleString('de-DE')} Bytes</p>`;
                techInfo += `<p><strong>SID Address Space:</strong> Load: ${meta.loadAddress} | Init: ${meta.initAddress} | Play: ${meta.playAddress}</p>`;
                techInfo += `<p><strong>Song Data:</strong> ${meta.songs} Subsong(s) detected, starting with Song ${meta.startSong}</p>`;
                techInfo += `<p><strong>SID Core:</strong> 6502 Emulator, MOS SID 6581, 3 Voices, Analog SVF filtering</p>`;
            } else {
                techInfo = `<p><strong>File Signature:</strong> ${meta.type} (De-interleaved)</p>`;
                techInfo += `<p><strong>Length:</strong> ${trackData.length} Frames @ 50Hz VBLANK</p>`;
                
                if (meta.digidrumCount > 0) {
                    techInfo += `<p style="margin-top: 5px;"><strong>PCM Data:</strong> ${meta.digidrumCount} Digidrum(s) detected!</p>`;
                    let sizes = meta.digidrumSizes.map(s => s.toLocaleString('de-DE') + ' Bytes').join(' / ');
                    techInfo += `<p style="font-size: 0.9em; margin-left: 10px; color: var(--text-color); opacity: 0.8;">&gt; Sample sizes: [ ${sizes} ]</p>`;
                } else {
                    techInfo += `<p style="margin-top: 5px;"><strong>PCM Data:</strong> None. 100% pure synthesized chip magic.</p>`;
                }
            }

            let dynamicHTML = `
                <div style="margin-top: 15px; padding: 10px 15px; background: rgba(0,0,0,0.2); border-left: 4px solid var(--highlight-color); position: relative;">
                    <p style="color: var(--highlight-color); margin-bottom: 8px;"><strong>[ BINARY FILE ANALYSIS ]</strong></p>
                    ${techInfo}
                </div>
            `;

            const systemText = (typeof systemDescriptions !== 'undefined' && systemDescriptions[system]) 
                ? systemDescriptions[system] 
                : '<p style="color: var(--text-color);">[ Museumdatenarchiv geladen, Beschreibung temporär nicht verfügbar ]</p>';

            // --- NEU: Zusammenführen von Composer-Metadata und technischer Analyse ---
            document.getElementById('info-text').innerHTML = `
                <div style="margin-bottom: 20px;">
                    <h2 style="color: var(--highlight-color);">&gt; NOW PLAYING:</h2>
                    <p style="font-size: 1.2em; padding-top: 5px;">${selectedSong.title}</p>
                </div>
                ${selectedSong.composerInfo ? `<div style="margin-bottom: 15px; line-height:1.6;">${selectedSong.composerInfo}</div>` : ''}
                ${dynamicHTML}
                <div style="margin-top: 30px; padding-top: 15px;">
                    ${systemText}
                </div>
                <p class="blinking-cursor" style="margin-top: 15px;">_</p>
            `;
            startPlayback();
            
        } catch (err) {
            alert("FEHLER BEIM LADEN: " + err.message);
            currentScrollerText = "+++ ERROR LOADING FILE +++";
        }
    } else {
        const systemText = (typeof systemDescriptions !== 'undefined' && systemDescriptions[system]) 
            ? systemDescriptions[system] 
            : '<p style="color: var(--text-color);">[ Museumdatenarchiv geladen ]</p>';

        document.getElementById('info-text').innerHTML = `
            <div style="margin-bottom: 20px;">
                <h2 style="color: var(--highlight-color);">&gt; NOW PLAYING:</h2>
                <p style="font-size: 1.2em; padding-top: 5px;">${selectedSong.title}</p>
            </div>
            ${selectedSong.composerInfo}
            <div style="margin-top: 30px; padding-top: 15px;">
                ${systemText}
            </div>
            <p class="blinking-cursor" style="margin-top: 15px;">_</p>
        `;
        currentScrollerText = "+++ NOW PLAYING: " + selectedSong.title + " +++";
        trackData = selectedSong.generator();
        startPlayback();
    }
}

function enterPseudoFullscreen(visualZone) {
    visualZone.classList.add('pseudo-fullscreen');
    document.getElementById('btn-fullscreen').innerText = '[ EXIT ]';
    document.body.style.overflow = 'hidden'; 
    document.body.appendChild(visualZone);
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
}

function exitPseudoFullscreen(visualZone) {
    visualZone.classList.remove('pseudo-fullscreen');
    document.getElementById('btn-fullscreen').innerText = '[ ⛶ ]';
    document.body.style.overflow = ''; 
    const demoContainer = document.getElementById('demo-container');
    const playbackBar = document.getElementById('playback-bar');
    if (demoContainer && playbackBar) {
        demoContainer.insertBefore(visualZone, playbackBar);
    }
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
}

function toggleFullscreen() {
    const visualZone = document.getElementById('visual-zone');
    if (visualZone.classList.contains('pseudo-fullscreen')) {
        exitPseudoFullscreen(visualZone);
        return;
    }

    if (document.fullscreenElement || document.webkitFullscreenElement) {
        if (document.exitFullscreen) document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        return;
    }

    try {
        if (visualZone.requestFullscreen) {
            let promise = visualZone.requestFullscreen();
            if (promise && typeof promise.catch === 'function') {
                promise.catch((err) => {
                    console.log("Native fullscreen rejected, triggering iOS Fallback.", err);
                    enterPseudoFullscreen(visualZone);
                });
            }
        } else if (visualZone.webkitRequestFullscreen) {
            visualZone.webkitRequestFullscreen();
            setTimeout(() => {
                if (!document.webkitFullscreenElement && !visualZone.classList.contains('pseudo-fullscreen')) {
                    enterPseudoFullscreen(visualZone);
                }
            }, 200);
        } else {
            enterPseudoFullscreen(visualZone);
        }
    } catch (err) {
        enterPseudoFullscreen(visualZone);
    }
}

function handleFullscreenChange() {
    const btn = document.getElementById('btn-fullscreen');
    const isNativeFS = !!(document.fullscreenElement || document.webkitFullscreenElement);
    if (isNativeFS) {
        btn.innerText = '[ EXIT ]';
    } else {
        const visualZone = document.getElementById('visual-zone');
        if (visualZone && !visualZone.classList.contains('pseudo-fullscreen')) {
            btn.innerText = '[ ⛶ ]';
        }
    }
    window.dispatchEvent(new Event('resize'));
}

const noSleepVideo = document.createElement('video');
noSleepVideo.setAttribute('playsinline', '');
noSleepVideo.setAttribute('muted', '');
noSleepVideo.setAttribute('loop', '');
noSleepVideo.src = 'data:video/mp4;base64,AAAAHGZ0eXBtcDQyAAAAAG1wNDJpc29tYXZjMQAAAz5tb292AAAAbG12aGQAAAAA/8f/3v/H/+QAAALuAAAC7gABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAGGlvZHMAAAAAE//H/+QAAALuAAAC7gABAAAAAAABAAAAMXRyYWsAAABcdGtoZAAAAAD/x//e/8f/5AAAAAEAAAAAAAAC7gAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAgAAAAIAAAAgZWR0cwAAABBlbHN0AAAAAQAAAu4AAAAAAAEAAAAAAixtZGlhAAAAIG1kaGQAAAAA/8f/3v/H/+QAAALuAAAC7gABAAAAAAAxAAAAAAAvaGRscgAAAAAAAAAAdmlkZQAAAAAAAAAAAAAAAFZpZGVvSGFuZGxlcgAAAAIcbWluZgAAABR2bWhkAAAAAQAAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAcRzdGJsAAAAp3N0c2QAAAAAAAAAAQAAAJNhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAgACAEgAAABIAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAR//8AAAAxYXZjQwH0AAr/4QAZZ/QACq608AUBzgAAAwAABgAAAwivDxgXoAAAAQAAABhzdHRzAAAAAAAAAAEAAAABAAAC7gAAAABzdHNzAAAAAAAAAAEAAAABAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAABAAAAHHN0c3oAAAAAAAAAAAAAAAEAAAAeAAAAFHN0Y28AAAAAAAAAAQAAADAAAAA0dWR0YQAAACxtZXRhAAAAAAAAAABoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAA';

let wakeLock = null;

async function enableEcoMode() {
    noSleepVideo.play().catch(e => console.warn('iOS Video-Hack blockiert:', e));
    isEcoMode = true;
    document.getElementById('eco-overlay').classList.remove('hidden');
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log('[SYSTEM] Wake Lock aktiv. Bildschirm bleibt an.');
        }
    } catch (err) {
        console.warn(`Wake Lock API blockiert. Fallback läuft.`);
    }
}

async function disableEcoMode() {
    isEcoMode = false;
    document.getElementById('eco-overlay').classList.add('hidden');
    if (wakeLock !== null) {
        await wakeLock.release();
        wakeLock = null;
    }
    noSleepVideo.pause();
    window.dispatchEvent(new Event('resize'));
}

document.getElementById('btn-play').addEventListener('click', () => {
    resumeAudioContext().catch(e=>console.log(e));
    if (isPlaying) {
        stopPlayback(); 
    } else {
        trackData.length === 0 ? selectAndPlayTrack(0, activeSystem) : resumePlayback();
    }
});

document.getElementById('btn-next').addEventListener('click', () => {
    resumeAudioContext().catch(e=>console.log(e));
    if (activeSystem === 'c64' && trackData && trackData.isSidFile) {
        const totalSongs = trackData.metadata.songs || 1;
        if (currentSubsongIndex < totalSongs) {
            changeC64Subsong(currentSubsongIndex + 1);
            return; 
        }
    }
    selectAndPlayTrack((currentTrackIndex + 1) % trackRegistry[activeSystem].length, activeSystem);
});

document.getElementById('btn-prev').addEventListener('click', () => {
    resumeAudioContext().catch(e=>console.log(e));
    if (activeSystem === 'c64' && trackData && trackData.isSidFile) {
        if (currentSubsongIndex > 1) {
            changeC64Subsong(currentSubsongIndex - 1);
            return;
        }
    }
    let prevIdx = currentTrackIndex - 1;
    if (prevIdx < 0) prevIdx = trackRegistry[activeSystem].length - 1;
    selectAndPlayTrack(prevIdx, activeSystem);
});

document.getElementById('volume-slider').addEventListener('input', (e) => {
    const masterGain = getMasterGain();
    if (masterGain) masterGain.gain.value = e.target.value;
});

document.getElementById('btn-hud-info').addEventListener('click', () => {
    const legend = document.getElementById('hud-legend');
    legend.innerHTML = chipCheatSheets[activeSystem]; 
    legend.classList.toggle('hidden');
});

document.getElementById('btn-hud-toggle').addEventListener('click', (e) => {
    const hud = document.getElementById('chip-hud'); 
    const body = document.getElementById('hud-body');
    const infoBtn = document.getElementById('btn-hud-info'); 
    const isHidden = body.classList.contains('hidden');
    
    if (isHidden) {
        body.classList.remove('hidden');
        infoBtn.classList.remove('hidden'); 
        hud.classList.remove('collapsed'); 
        e.target.innerText = '[-]'; 
    } else {
        body.classList.add('hidden');
        infoBtn.classList.add('hidden'); 
        hud.classList.add('collapsed'); 
        e.target.innerText = '[+]'; 
        const legend = document.getElementById('hud-legend');
        if (legend) legend.classList.add('hidden');
    }
});

document.getElementById('core-selector').addEventListener('change', async (e) => {
    stopPlayback();
    const coreIndex = e.target.value;
    const coreConfig = workletRegistry[activeSystem][coreIndex];
    document.getElementById('hud-content') ? document.getElementById('hud-content').innerText = "RE-WIRING DSP..." : null;
    await loadEmuCore(activeSystem, coreConfig, handleWorkletMessage);
    startPlayback(); 
});

// Kopplung des neuen, interaktiven analogen Temperaturreglers (Ohne Auto-Reset-Konflikt!)
document.getElementById('temp-slider').addEventListener('input', (e) => {
    const tempVal = parseInt(e.target.value);
    document.getElementById('temp-display').innerText = `${tempVal}°C`;
    
    const sidNode = getSidNode();
    if (sidNode) {
        sidNode.port.postMessage({ type: 'SET_TEMPERATURE', value: tempVal });
    }
});

document.getElementById('btn-eco').addEventListener('click', async () => {
    await resumeAudioContext();
    if (isEcoMode) {
        await disableEcoMode(); 
    } else {
        await enableEcoMode();  
    }
});

document.getElementById('btn-eco-off').addEventListener('click', async () => {
    await disableEcoMode();
});

document.getElementById('btn-fullscreen').addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', handleFullscreenChange);
document.addEventListener('webkitfullscreenchange', handleFullscreenChange);