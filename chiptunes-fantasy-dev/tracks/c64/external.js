import { loadSidFile } from '../../js/parsers/sid-parser.js';

const mySidFiles = [
    "Commando.sid",
    "Monty_on_the_Run.sid",
    "Delta.sid"
];

// Automatische Generierung der Playlist-Einträge
export const externalSidTracks = mySidFiles.map((filename, index) => {
    return {
        title: `${index + 3}. LOAD SID: ${filename}`,
        composerInfo: ``, // Wird dynamisch im Museum gefüllt
        generator: function() { return []; },
        loadAsync: async function() {
            return await loadSidFile(`tracks/c64/${filename}`);
        }
    };
});