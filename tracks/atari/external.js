import { loadYmFile } from './ym-parser.js';

// HIER EINFACH ALLE DATEINAMEN EINTRAGEN, DIE IN DEINEM ORDNER LIEGEN!
const myYmFiles = [
    "thalion_loader.ym",           // Dein erster Test-Song
    "turrican1_world_1_1.ym",      // Lade hier deine entpackten Lieblingstracks rein...
    "WINGLEV1.ym",               // ...
    "GOLDRUN.ym",
    "spherical_intro.ym"
];

// Wir generieren mit .map() automatisch für jeden Namen einen fertigen Track-Eintrag!
export const externalYmTracks = myYmFiles.map((filename, index) => {
    return {
        title: `${index + 3}. LOAD ORIGINAL: ${filename}`,
        composerInfo: `
            <h3>Der YM-Binär-Parser</h3>
            <p>Dieser Track ist eine echte, de-interleaved <code>.ym</code> Datei, die direkt in den RAM des Emulators geladen wird.</p>
            <p><strong>Datei:</strong> <code>tracks/atari/${filename}</code></p>
        `,
        generator: function() { return []; },
        loadAsync: async function() {
            return await loadYmFile(`tracks/atari/${filename}`);
        }
    };
});