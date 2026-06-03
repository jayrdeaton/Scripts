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

        // Check if file contains 'v2' after episode number pattern (1x01v2, 2x03v2, etc.)
        if (!file.match(/\d+x\d+v2/)) {
            return;
        }

        // Remove 'v2' from the filename
        const newName = file.replace(/(\d+x\d+)v2/, '$1');
        const newPath = path.join(directory, newName);

        console.log(`Renaming: ${file} -> ${newName}`);
        fs.renameSync(filePath, newPath);
        renamed++;
    });

    console.log(`Done! Renamed ${renamed} files.`);
});
