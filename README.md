I love the old Chiptunes from C64, Amiga and Atari ST.  
Finally, with the help of coding assistants, I'm able to reproduce the feeling from the good old times in pure Javascript.
https://holladavid.github.io/Chiptunes-Fantasy/

***

# 🕹️ Chiptunes-Fantasy

**Welcome to the ultimate HTML5/JavaScript demoscene music disk.**

*Chiptunes-Fantasy* is a passion project built to revive the golden era of 8-bit and 16-bit chiptunes using **pure JavaScript and HTML5** — no heavy frameworks, no bloated libraries, and absolutely no pre-recorded MP3s. Just raw binary parsing, cycle-accurate hardware emulation, and pure analog-modeled DSP running at a rock-solid 50Hz VBLANK.

> **🎉 MILESTONE REACHED:**  
> The core architecture for the big three (Amiga, C64, Atari ST) has been fully realized! All platforms now run on custom-crafted, highly accurate emulator and DSP mastering cores.

## 🚀 The Vision & Tribute
This project is a love letter to the audio wizards of the 80s and 90s — legends like Jochen Hippel, Rob Hubbard, Chris Hülsbeck, and Martin Galway. They didn't just compose music; they hacked the hardware. They abused CPU timers, manipulated pulse widths, and wrote their own assembly drivers to make simple programmable sound generators sound like entire orchestras.

*Chiptunes-Fantasy* makes these genius programming tricks tangible. We don't just play the music; we expose the guts of the hardware in real-time, honoring the artists, explaining the physics, and educating the nerds.

## 🎛️ Current Features

### 💻 Commodore 64 (MOS SID 6581)
*   **1MHz Cycle-Exact Lockstep Core:** The 6502 CPU, SID registers, and CIA/VBLANK IRQ timers execute in perfect chronological synchronicity on a clock-by-clock basis.
*   **Audiophile Decimation:** A custom 4-pole Butterworth anti-aliasing lowpass filter running at $985.248\text{ Hz}$ replaces naive averaging, eliminating downsampling aliasing and preserving high-end brilliance.
*   **Physical Modeling:** Non-linear JFET filter saturation (`Math.tanh`) and thermal cutoff drift simulation (controllable via a manual temperature slider).
*   **Hardware Hacks:** Accurate emulation of the infamous 4-bit DC-offset volume leak used by Martin Galway to play digital samples.

### 🐨 Commodore Amiga (MOS Paula 8364)
*   **Dual-Core Architecture:** 
    *   *MOS Paula (Analog Dirt & Sync)*: High-fidelity modeling including analog crosstalk (channel bleed), R-2R ladder DAC saturation, and HSYNC video line background noise.
    *   *MOS Paula (Digital Clean)*: A pure, mathematical representation for clinical, crisp digital summing.
*   **Tracker Compliance:** Support for ProTracker (.mod) and FastTracker II (.xm) sequencers including pitch portamento, linear frequency sliding, default sample panning, volume-column panning (`0xC0`–`0xCF`), and sub-sample phase synchronization.
*   **Transition Integrity:** Precise caching of pattern loops (`E6x`), pattern delays (`EEx`), and safe pattern jump buffering (`Dxx`/`Bxx`) to prevent note dropouts during transitions.

### 🦎 Atari ST (Yamaha YM2149F)
*   **Multi-Core Selectors:** Switch between cycle-exact logarithmic DAC emulators, PolyBLEP anti-aliased cores, and advanced cinematic mastering engines.
*   **Creative Master Cores:** The "Blade Runner" and "Chiptunes Fantasy" editions feature dynamic spatial staging, dual sub-oscillators, tape saturation, and cylindrical room delays.
*   **Digidrum PCM Hacks:** Intercepts and renders CPU-timer PCM hacks directly through the live debugger HUD.

### 📺 Visuals & UX
*   **CRT Vector Oscilloscope:** An analog-looking vector wave with customizable phosphor trail persistence and glowing cathode-ray tube shadow bloom.
*   **Vector Grid Reticle:** A dashed scope grid to mimic retro hardware oscilloscopes and lab equipment.
*   **High-DPI Performance Safety:** Automatic resolution clamping at a maximum logical width of 1280px prevents performance throttling on 4K/Retina screens while giving a gorgeous, authentic upscaled look.
*   **Auto-Cursor Hiding:** The mouse cursor automatically hides after 3 seconds of inactivity in full-screen modes.

## 🏗️ Architecture
The engine is highly modular. You can easily plug in new hardware simulator cores or add new binary parsers.

```mermaid
graph TD
    subgraph UI & Visuals
        UI[Tracklist & Controls]
        MUSEUM[Museum & Chip Info]
        HUD[Live DSP Debug HUD]
        VISUALS[Canvas: FFT Analyzer & Scroller]
    end

    subgraph Engine Core / Main Thread
        APP(app.js - Logic & Routing)
        PARSERS[[Binary Parsers: .ym, .mod, .sid]]
        REGISTRY[(Track Registry)]
    end

    subgraph Web Audio API / Worklets
        YM(ym-worklet.js)
        PAULA(paula-worklet.js)
        SID(sid-worklet.js)
        MASTER((Master Gain & FFT Node))
    end

    %% Data Flow
    REGISTRY -->|Track Selection| APP
    APP -->|Load Binary| PARSERS
    PARSERS -->|Parsed Frame Data| APP
    APP -->|Send Spieldaten| YM
    APP -->|Send Spieldaten| PAULA
    APP -->|Send Spieldaten| SID
    
    %% Audio Flow
    YM ==> MASTER
    PAULA ==> MASTER
    SID ==> MASTER
    MASTER -.->|Audio Output| Speaker((🔊))

    %% Visual Flow
    MASTER -->|Frequency Data| VISUALS
    YM -.->|Live Register Data| HUD
    APP -->|Update Info| MUSEUM