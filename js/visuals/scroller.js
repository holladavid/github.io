// =========================================================
// RETRO DOUBLE-SINE TEXT SCROLLER MODULE
// High-performance canvas rendering with 50Hz aesthetics
// =========================================================

/**
 * Initialisiert den doppelwelligen Retro-Text-Scroller auf dem Canvas.
 * 
 * @param {Function} getScrollerText - Closure-Funktion, die den aktuellen dynamischen Song-Text liefert
 * @param {Function} getEcoMode - Closure-Funktion, die den aktiven Pure Audio (ECO) Status liefert
 */
export function initScroller(getScrollerText, getEcoMode) {
    const canvas = document.getElementById('scroller-canvas');
    if (!canvas) {
        console.warn('[SCROLLER] Canvas-Element #scroller-canvas nicht gefunden.');
        return;
    }
    
    const ctx = canvas.getContext('2d');
    
    // Logische Canvas-Abmessungen an die physikalischen CSS-Grenzen anpassen
    canvas.width = canvas.clientWidth; 
    canvas.height = canvas.clientHeight;

    // Canvas-Dimensionen bei Größenänderungen des Browserfensters automatisch anpassen
    window.addEventListener('resize', () => {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
    });
    
    let offset = 0;          
    const speed = 2.5; // Pixel-Vorschub pro Animations-Frame
    
    // Klassische Demoszene-Grüße (Greets), die an das Ende jedes Songtextes gehängt werden
    const baseGreets = " +++ AT LAST, THE ULTIMATE HTML5 MUSIC DISK IS COMPLETE +++ CODE & DSP MAGIK RUNNING AT A SOLID 50 HZ VBLANK +++ DEEP CHIP EMULATION VIA AUDIOWORKLETS +++ NO MP3, NO BULLSHIT, JUST PURE MATHEMATICS +++ GREETS FLY OUT TO ALL THE PIXEL PUSHERS, CYCLE CRUNCHERS AND WAVEFORM WIZARDS OUT THERE +++ TO EVERYONE WHO STILL KEEPS THE SPIRIT OF THE 8-BIT AND 16-BIT ERA ALIVE +++ TO THE TRUE LOVERS OF DEMOSCENE ART AND CHIPTUNE MAGIC +++ LET THE ANALOG FILTERS BURN +++ WRAP AROUND +++ ";
    
    function draw() {
        // GPU- & CPU-Entlastung: Wenn PURE AUDIO (ECO) aktiv ist, stoppen wir das Rendern vollständig
        if (getEcoMode()) {
            requestAnimationFrame(draw);
            return; 
        }

        // Frame leeren und schwarzen Hintergrund zeichnen
        ctx.fillStyle = '#000000'; 
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Aktives System-Theme über die DOM-Klassenstruktur ermitteln
        const isAmiga = document.body.classList.contains('theme-amiga');
        const isAtari = document.body.classList.contains('theme-atari');
        
        // Systemgetreue Farbwahl und Fonts deklarieren
        ctx.fillStyle = isAtari ? '#55ff55' : isAmiga ? '#ff8800' : '#6c5eb5';
        ctx.font = isAmiga || isAtari ? "32px 'VT323', monospace" : "24px 'Press Start 2P', monospace";
        ctx.textBaseline = "middle";
        
        // VT323-Metrik-Kompensation (zieht die tiefhängende Schrift sachte nach oben, um Clipping zu verhindern)
        const fontMetricOffset = (isAmiga || isAtari) ? -(canvas.height * 0.08) : 0;

        // Dynamischen Text über den Getter einholen und mit den Greets verschmelzen
        const fullText = getScrollerText() + baseGreets;
        const charWidth = ctx.measureText("A").width;
        let startX = canvas.width - offset;
        
        // Durch jeden Buchstaben loopen und Wellenverschiebung berechnen
        for (let i = 0; i < fullText.length; i++) {
            let x = startX + (i * charWidth);
            
            // Nur Zeichen rendern, die sich aktuell im sichtbaren Viewport-Bereich befinden
            if (x > -50 && x < canvas.width + 50) {
                // Mathematische Doppel-Sinus-Auslenkung (auf max 16% und 6% der Canvas-Höhe gedämpft)
                // Das lässt den Text perfekt zentriert schwingen, ohne oben oder unten anzustoßen
                let wave1 = Math.sin((x * 0.01) + (offset * 0.04)) * (canvas.height * 0.16);
                let wave2 = Math.cos((x * 0.02) + (offset * 0.07)) * (canvas.height * 0.06);
                
                ctx.fillText(fullText[i], x, (canvas.height / 2) + wave1 + wave2 + fontMetricOffset);
            }
        }
        
        // Offset zurücksetzen, wenn der Text einmal durchgelaufen ist (Überlaufschutz)
        offset = (offset + speed) > (charWidth * fullText.length + canvas.width) ? 0 : offset + speed;
        requestAnimationFrame(draw);
    }
    
    draw();
}