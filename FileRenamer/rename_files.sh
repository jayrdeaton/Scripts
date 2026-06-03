#!/bin/bash

# Usage: ./rename_files.sh <season_number> [directory]
# Example: ./rename_files.sh 2
# Example: ./rename_files.sh 3 /path/to/folder

if [ -z "$1" ]; then
    echo "Usage: $0 <season_number> [directory]"
    echo "Example: $0 2"
    echo "Example: $0 3 /path/to/folder"
    exit 1
fi

SEASON=$1
DIR=${2:-.}

if [ ! -d "$DIR" ]; then
    echo "Error: Directory '$DIR' does not exist"
    exit 1
fi

counter=1

for file in "$DIR"/*; do
    if [ -f "$file" ]; then
        extension="${file##*.}"
        filename=$(basename "$file")
        
        # Skip hidden files (starting with .)
        if [[ "$filename" == .* ]]; then
            continue
        fi
        
        # Format counter with leading zero (01, 02, etc.)
        episode=$(printf "%02d" $counter)
        
        # Create new filename
        if [ "$extension" != "$filename" ]; then
            newname="${SEASON}x${episode}.${extension}"
        else
            # File has no extension
            newname="${SEASON}x${episode}"
        fi
        
        newpath="$DIR/$newname"
        
        # Avoid overwriting if file already exists
        if [ "$file" != "$newpath" ]; then
            echo "Renaming: $filename -> $newname"
            mv "$file" "$newpath"
            ((counter++))
        fi
    fi
done

echo "Done! Renamed $((counter-1)) files."
