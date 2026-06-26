// =========================================================
// HIGH-PERFORMANCE RETROWAVE VISUALIZER MODULE
// Amiga Copperbars, Oscilloscope & Spectrum Analyzer Canvas Loop
// =========================================================

/**
 * Initialisiert das gesamte Visualizer-System auf dem Canvas.
 * 
 * @param {Object} stateGetters - Objekt mit asynchronen Gettern zum Auslesen des App-Zustands
 * @param {Function} stateGetters.getEcoMode - Liefert den aktiven ECO-Status (Pure Audio)
 * @param {Function} stateGetters.getCurrentOscValue - Liefert den aktuellen Oszillator-Pegel
 * @param {Function} stateGetters.getTrackData - Liefert die geladenen Trackdaten
 * @param {Function} stateGetters.getAnalyserNode - Liefert den Web Audio AnalyserNode
 * @param {Function} stateGetters.getIsPlaying - Liefert den aktiven Playback-Status
 * @param {Function} stateGetters.getAudioContext - Liefert den Web Audio Context
 * @param {Object} callbacks - Objekt mit Hooks zur Rückmeldung an den Haupt-Thread
 * @param {Function} callbacks.updateTimelineUI - Hook zur Aktualisierung des Timeline-Sliders
 * @param {Function} callbacks.updateChipHUD - Hook zur Aktualisierung des DSP-HUDs
 */
export function initVisuals(stateGetters, callbacks) {
    const canvas = document.getElementById('demo-canvas');
    if (!canvas) {
        console.warn('[VISUALIZER] Canvas-Element #demo-canvas nicht gefunden.');
        return;
    }

    const ctx = canvas.getContext('2d', { alpha: false }); 
    
    // Dynamischer Puffer-Speicher für das Oszilloskop
    let historyLength = canvas.width;
    let oscHistory = new Float32Array(historyLength).fill(NaN);
    let oscIndex = 0;

    // Passt das Canvas und den Oszilloskop-Puffer bei Größenänderungen an
    function resizeCanvas() {
        const newWidth = canvas.clientWidth;
        const newHeight = canvas.clientHeight;
        
        if (canvas.width !== newWidth) {
            const oldHistory = oscHistory;
            const oldLen = oldHistory ? oldHistory.length : 0;
            
            canvas.width = newWidth; 
            canvas.height = newHeight;
            historyLength = canvas.width;
            
            oscHistory = new Float32Array(historyLength).fill(NaN);
            
            // Alte Welle nahtlos in den neuen Puffer retten! (Verhindert das Flackern/Löschen)
            if (oldLen > 0) {
                const copyLen = Math.min(oldLen, historyLength);
                for (let i = 0; i < copyLen; i++) {
                    const oldVal = oldHistory[(oscIndex - copyLen + i + oldLen) % oldLen];
                    oscHistory[i] = oldVal;
                }
                oscIndex = copyLen % historyLength;
            }
        } else {
            canvas.height = newHeight; // Nur die Höhe hat sich geändert
        }
    }
    
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    const startTime = performance.now();
    let hudCounter = 0; 

    // Cache-Tabelle für den Analyzer vorbereiten
    const activeAnalyser = stateGetters.getAnalyserNode();
    const bufferLength = activeAnalyser ? activeAnalyser.frequencyBinCount : 512;
    const dataArray = new Uint8Array(bufferLength);
    const barCount = 48; 
    const peaks = new Array(barCount).fill(0); 

    // Hilfsfunktion zum Zeichnen der Rasterbars / Copperbars
    function drawCopperBar(yCenter, thickness, color1, color2) {
        const grad = ctx.createLinearGradient(0, yCenter - thickness, 0, yCenter + thickness);
        grad.addColorStop(0, `rgba(0,0,0,0)`); 
        grad.addColorStop(0.2, color1);
        grad.addColorStop(0.5, `rgba(255,255,255, 1)`); 
        grad.addColorStop(0.8, color2);
        grad.addColorStop(1, `rgba(0,0,0,0)`);
        ctx.fillStyle = grad; 
        ctx.fillRect(0, yCenter - thickness, canvas.width, thickness * 2);
    }

    function draw() {
        // CPU/GPU-Schonung: Wenn ECO aktiv ist, zeichnen wir gar nichts!
        if (stateGetters.getEcoMode()) {
            callbacks.updateTimelineUI(); 
            requestAnimationFrame(draw);
            return; 
        }

        const t = (performance.now() - startTime) * 0.001; 
        
        // Sachte Bewegungsschwärzung für Motion-Blur Schweif-Effekte
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)'; 
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        const currentOscValue = stateGetters.getCurrentOscValue();
        let audioPunch = Math.abs(currentOscValue) * 40; 

        // Airbag gegen kurzzeitige NaN-Werte des Audio-Cores
        if (isNaN(audioPunch) || !isFinite(audioPunch)) audioPunch = 0;

        const isAmiga = document.body.classList.contains('theme-amiga');
        const isAtari = document.body.classList.contains('theme-atari');
        
        const pal1 = isAtari ? ['#005500', '#00aa00'] : isAmiga ? ['#0000aa', '#0055ff'] : ['#352879', '#6c5eb5'];
        const pal2 = isAtari ? ['#555500', '#aaaa00'] : isAmiga ? ['#aa5500', '#ff8800'] : ['#aa0055', '#ff00aa'];
        const pal3 = isAtari ? ['#005555', '#00aaaa'] : isAmiga ? ['#5500aa', '#aa00ff'] : ['#555555', '#aaaaaa'];
        const lineColor = isAtari ? '#55ff55' : isAmiga ? '#ff8800' : '#6c5eb5';

        ctx.globalCompositeOperation = "screen"; 
        drawCopperBar((canvas.height / 2) + Math.sin(t * 1.2) * (canvas.height * 0.3), 25 + audioPunch, pal1[0], pal1[1]);
        drawCopperBar((canvas.height / 2) + Math.sin(t * 1.8 + 2.0) * (canvas.height * 0.35), 20 + (audioPunch * 0.8), pal2[0], pal2[1]);
        drawCopperBar((canvas.height / 2) + Math.sin(t * 1.5 + 4.0) * (canvas.height * 0.25), 15 + (audioPunch * 0.5), pal3[0], pal3[1]);
        ctx.globalCompositeOperation = "source-over";

        // --- 3. DAS OSZILLOSKOP ---
        const trackData = stateGetters.getTrackData();
        const trackLength = trackData ? (trackData.length || 0) : 0;
        
        oscHistory[oscIndex] = (trackLength === 0) ? NaN : currentOscValue;
        oscIndex = (oscIndex + 1) % historyLength; 
        
        ctx.beginPath();
        ctx.strokeStyle = lineColor;
        
        let isFirstPoint = true;
        for (let x = 0; x < historyLength; x++) {
            const actualIndex = (oscIndex + x) % historyLength; 
            const val = oscHistory[actualIndex];
            
            if (!isNaN(val)) {
                const y = (canvas.height / 2) - (val * (canvas.height * 0.4)); 
                if (isFirstPoint) {
                    ctx.moveTo(x, y);
                    isFirstPoint = false;
                } else {
                    ctx.lineTo(x, y);
                }
            }
        }
        
        if (!isFirstPoint) {
            ctx.lineWidth = 6; ctx.globalAlpha = 0.3; ctx.stroke();
            ctx.lineWidth = 2; ctx.globalAlpha = 1.0; ctx.stroke();
        }

        // --- SPECTRUM ANALYZER ---
        const activeAnalyser = stateGetters.getAnalyserNode();
        const isPlaying = stateGetters.getIsPlaying();
        const audioCtx = stateGetters.getAudioContext();

        if (activeAnalyser && isPlaying && audioCtx) {
            activeAnalyser.getByteFrequencyData(dataArray);
            const barWidth = (canvas.width / barCount) - 2;
            let x = 0;
            
            const hzPerBin = audioCtx.sampleRate / activeAnalyser.fftSize;
            const minBin = Math.max(1, Math.floor(50 / hzPerBin)); 
            const maxBin = Math.floor(12000 / hzPerBin); 
            let lastEndBin = minBin;
            
            for (let i = 0; i < barCount; i++) {
                const startBin = lastEndBin;
                let endBin = Math.floor(minBin * Math.pow(maxBin / minBin, (i + 1) / barCount));
                if (endBin <= startBin) endBin = startBin + 1;
                lastEndBin = endBin;
                
                let sum = 0;
                for (let b = startBin; b < endBin; b++) sum += dataArray[b];
                const avg = sum / (endBin - startBin);
                
                const heightBoost = 1.0 + (i / barCount) * 0.5;
                const barHeight = ((avg * heightBoost) / 255.0) * (canvas.height * 0.4);
                
                if (barHeight > peaks[i]) peaks[i] = barHeight; 
                else { peaks[i] -= 1.5; if (peaks[i] < 0) peaks[i] = 0; }
                
                ctx.fillStyle = lineColor; 
                ctx.globalAlpha = 0.7;
                ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
                
                if (peaks[i] > 2) {
                    ctx.globalAlpha = 1.0; 
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(x, canvas.height - peaks[i] - 4, barWidth, 2);
                }
                x += barWidth + 2;
            }
            ctx.globalAlpha = 1.0;
        }

        hudCounter++;
        callbacks.updateTimelineUI();
        if (hudCounter % 4 === 0) callbacks.updateChipHUD();
        requestAnimationFrame(draw);
    }
    
    draw();
}