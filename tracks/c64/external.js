import { loadSidFile } from '../../js/parsers/sid-parser.js';

const mySidFiles = [
    "Commando.sid",
    "Monty_on_the_Run.sid",
    "Delta.sid",
    "Wizball.sid",
    "Great_Giana_Sisters.sid",
    "To_Be_on_Top_PSID.sid",
    "Rambo_First_Blood_Part_II.sid",
    "Mega_Apocalypse_PSID.sid",
    "Bionic_Commando.sid",            // David Whittaker / Tim Follin (1988)
    "Last_Ninja.sid"                  // Ben Daglish / Anthony Lees (1987)
];

// Automatische Generierung der Jukebox-Einträge
export const externalSidTracks = mySidFiles.map((filename, index) => {
    return {
        title: `${index + 1}. LOAD SID: ${filename}`,
        composerInfo: ``,
        generator: function() { return []; },
        loadAsync: async function() {
            return await loadSidFile(`tracks/c64/${filename}`);
        }
    };
});