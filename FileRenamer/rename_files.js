#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length === 0) {
    console.log('Usage: node rename_files.js <season_number> [directory]');
    console.log('Example: node rename_files.js 2');
    console.log('Example: node rename_files.js 3 /path/to/folder');
    process.exit(1);
}

const season = args[0];
const directory = args[1] || '.';

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

    let counter = 1;
    let renamed = 0;

    files.forEach(file => {
        const filePath = path.join(directory, file);
        
        // Skip hidden files (starting with .)
        if (file.startsWith('.')) {
            return;
        }
        
        // Check if it's a file (not a directory)
        if (fs.statSync(filePath).isFile()) {
            const ext = path.extname(file);
            const episode = counter.toString().padStart(2, '0');
            const newName = `${season}x${episode}${ext}`;
            const newPath = path.join(directory, newName);

            // Avoid overwriting if file already exists with same name
            if (filePath !== newPath) {
                console.log(`Renaming: ${file} -> ${newName}`);
                fs.renameSync(filePath, newPath);
                renamed++;
            }
            counter++;
        }
    });

    console.log(`Done! Renamed ${renamed} files.`);
});
