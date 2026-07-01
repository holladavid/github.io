# Chiptunes Fantasy

The Ultimate 8-Bit/16-Bit Bare-Metal Music Disk Emulator. Built with 100% vanilla HTML5, CSS3, and modern Web Audio API. 

No MP3s, no pre-rendered streams — just pure mathematical real-time synthesis running asynchronously inside low-latency AudioWorklets.

---

> **🎉 MILESTONE REACHED: VERSION 1.0.0 [First Cycle]**  
> We have officially hit **Version 1.0.0**! The big three sound chips (MOS SID 6581, MOS Paula 8364, and Yamaha YM2149F) have been fully realized. All platforms now run on custom-crafted, highly accurate, hardware-emulating DSP cores featuring true 1MHz/2MHz locksteps, Zero-Order Hold (ZOH) oversampling, analog-modeled filter cascades, and raw DAC resistance tables.

---

## 🚀 The Vision & Tribute
This project is a love letter to the audio wizards of the 80s and 90s — legends like Jochen Hippel (Mad Max), Rob Hubbard, Chris Hülsbeck, Martin Galway, and Jeroen Tel. They didn't just compose music; they hacked the hardware. They abused CPU timers, manipulated pulse widths, and wrote their own assembly drivers to make simple programmable sound generators sound like entire orchestras.

*Chiptunes-Fantasy* makes these genius programming tricks tangible. We don't just play the music; we expose the guts of the hardware in real-time, honoring the artists, explaining the physics, and educating the nerds.

## 🎛️ Core Emulation Features

### 💻 Commodore 64 (MOS SID 6581)
*   **1MHz Cycle-Exact Lockstep Core:** The 6502 CPU, SID registers, and CIA/VBLANK IRQ timers execute in perfect chronological synchronicity on a clock-by-clock basis (985248 Hz PAL).
*   **255-Tap Polyphase Sinc-FIR Decimator:** Custom windowed Sinc downsampling replaces naive averaging, eliminating high-frequency foldback aliasing on hard-sync leads and preserving raw high-end brilliance.
*   **Asymmetric JFET Filter Saturation:** Modeling the non-linear triode region of the original 6581 VCF feedback path for that warm, resonant "Wizball-Growl".
*   **Sustain-Drop & Pipeline Delay:** True hardware envelope emulation replicating the 1-cycle pipeline freeze on gate toggles and the infamous sustain target-miss bug.
*   **True Analog Wire-AND:** Simulates the pull-down transistor resistance on the 12-bit digital bus when combining waveforms, bringing back the dirty, iconic crunch of mixed states (essential for *Maniacs of Noise* tracks).
*   **Thermal Cutoff Drift:** Live physical modeling of the analog filter temperature drift, manually adjustable via the UI temperature slider.

### 🐨 Commodore Amiga (MOS Paula 8364)
*   **192kHz (4x) Oversampled ZOH DAC:** Samples are rendered as raw analog stair-steps (Zero-Order Hold) at 192 kHz. This preserves the high-frequency mirror images (the legendary "Amiga Shimmer") in the ultrasonic domain before filtering, preventing digital foldback.
*   **Sinc-FIR Decimation:** Smoothly and cleanly downsamples the internal 192 kHz high-res stream to 48 kHz for the audio destination.
*   **High-Res Analog Filter Chain:** The 6dB RC lowpass (4.42 kHz) and the 12dB Butterworth LED filter (3.09 kHz) are calculated directly in the 192 kHz domain to accurately smooth the physical ZOH stair-steps.
*   **100% Hard-Panning & Crosstalk:** Rejects modern software panning commands to enforce the brutal hardware-wired L-R-R-L panning configuration, softened only by a 3.5% inductive motherboard crosstalk.
*   **DMA Word Alignment:** Replicates Paula's 16-bit DMA memory fetches by strictly masking all loop boundaries and sample offsets to even byte boundaries (`& ~1`).

### 🦎 Atari ST (Yamaha YM2149F)
*   **2MHz True Lockstep Core:** Cycle-accurate execution of the Tone (toggle every 8*TP), Noise (shift every 16*NP), and Envelope (step every 8*EP) generators on a 2.0 MHz clock.
*   **32-Step Logarithmic DAC:** Fully emulates the YM2149F's internal 32-step DAC ladder (-1.5dB per step) by translating 4-bit register volume to 5-bit DAC via `(v * 2) + 1` for smoother volume sweeps and authentic "Zipper-Noise".
*   **Zero-Click Hijack Isolation:** Captures PCM Digidrums and completely isolates them from the volume registers to prevent 50Hz DC-popping, holding the DAC state on completion.
*   **Combinational Envelope Logic:** Renders the 5-bit envelope without artificial "flat-spot" loop delays at the peaks and troughs.
*   **Atari ST Motherboard RC Filter:** Simulates the thin, biting frequency response of the Atari ST's physical output stage.

### 📺 Visuals & UX
*   **CRT Vector Oscilloscope:** An analog-looking vector wave with customizable phosphor trail persistence and glowing cathode-ray tube shadow bloom.
*   **Vector Grid Reticle:** A dashed scope grid to mimic retro hardware oscilloscopes and lab equipment.
*   **DSP Debug HUD:** A real-time debugger showing register matrices, custom state LEDs (like the Amiga power-filter LED or YM Digidrum activity), and sparkline mini-scopes per channel.
*   **Pure Audio (ECO) Mode:** Halts the WebGL/Canvas loop and locks the screen wake state to save battery on mobile devices while continuing pure AudioWorklet synthesis.

## 🏗️ Architecture
The engine is highly modular. You can easily plug in new hardware simulator cores or add new binary parsers.

```mermaid
graph TD
    subgraph UI [1. User Interface & Controls]
        A[Playlists, Volume, Custom Sliders & Museum]
    end

    subgraph PARSE [2. Binary Decoders]
        B[Parsers for raw .sid, .ym, .mod and .xm files]
    end

    subgraph SYNTH [3. Real-Time Synthesis]
        C[Low-latency AudioWorklets: SID, Paula & YM Cores]
    end

    subgraph VIS [4. Visual Feedback & GFX]
        D[FFT Spectrum, CRT Oscilloscope & live DSP HUD]
    end

    %% Signal & Data Flow
    A -->|User Selection| B
    B -->|Register Frames| C
    C ==>|16-Bit Audio Signal| Speaker((🔊 Speaker))
    C -.->|Wave & Metric Dumps| D