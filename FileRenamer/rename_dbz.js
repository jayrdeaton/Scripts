#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
const directory = args[0] || '.';

// Check if directory exists
if (!fs.existsSync(directory)) {
    console.error(`Error: Directory '${directory}' does not exist`);
    process.exit(1);
}

// Read all files in directory
fs.readdir(directory, (err, files) => {
    if (err) {
        console.error(`Error reading directory: ${err.message}`);
        process.exit(1);
    }

    let renamed = 0;

    files.forEach(file => {
        const filePath = path.join(directory, file);
        
        // Skip hidden files
        if (file.startsWith('.')) {
            return;
        }
        
        // Check if it's a file (not a directory)
        if (!fs.statSync(filePath).isFile()) {
            return;
        }

        // Only process files that start with 'Dragon.Ball.Recut.'
        if (!file.startsWith('Dragon.Ball.Recut.')) {
            return;
        }

        const ext = path.extname(file);
        const nameWithoutExt = file.slice(0, -ext.length);

        // Remove 'Dragon.Ball.Recut.' prefix
        let remaining = nameWithoutExt.replace('Dragon.Ball.Recut.', '');

        // Extract episode number (E01, E02, etc.)
        const episodeMatch = remaining.match(/^E(\d+)/);
        if (!episodeMatch) {
            console.log(`Skipping ${file}: No episode number found`);
            return;
        }

        const episodeNum = episodeMatch[1];
        const formattedEpisode = `1x${episodeNum}`;

        // Remove episode number from remaining string
        remaining = remaining.replace(/^E\d+\./, '');

        // Replace '.v2.' with ' - '
        remaining = remaining.replace('.v2.', ' - ');

        // Replace all remaining dots with spaces
        remaining = remaining.replace(/\./g, ' ');

        // Create new filename
        const newName = `${formattedEpisode}${remaining}${ext}`;
        const newPath = path.join(directory, newName);

        console.log(`Renaming: ${file} -> ${newName}`);
        fs.renameSync(filePath, newPath);
        renamed++;
    });

    console.log(`Done! Renamed ${renamed} files.`);
});
