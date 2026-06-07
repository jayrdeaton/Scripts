# @jayrdeaton/scripts

Personal dev CLI. Invoked as `jrd`.

## Install

```sh
npm install -g @jayrdeaton/scripts
```

## Commands

### `jrd base64`

Encode or decode base64 strings and files.

```
jrd base64 encode <value> [options]
jrd base64 decode <value> [options]

Options:
  -f, --file   Treat value as a file path
  -c, --copy   Copy result to clipboard
```

---

### `jrd binary`

Encode a file to a binary string, or restore a binary string back to its original file.

```
jrd binary encode <file> [options]
jrd binary decode <file> <destination>

Options (encode):
  -c, --copy           Copy result to clipboard
  -o, --output <dest>  Write result to a file
```

---

### `jrd bump-ota`

Bumps `otaVersion` in `src/constants/release.ts` and auto-commits the change. Requires a clean working directory.

```
jrd bump-ota [options]

Options:
  -f, --file <file>   Path to release file (default: src/constants/release.ts)
```

---

### `jrd check-domains`

Check domain availability via RDAP using a wildcard pattern where `?` matches any letter. Supports `.com`, `.net`, `.org`, and `.io`.

```
jrd check-domains <pattern> [options]

Options:
  -c, --concurrency <n>   Concurrent requests (default: 5)
  -o, --output <file>     Write available domains to a file
```

Example: `jrd check-domains ??fu.com`

---

### `jrd check-scripts`

Compare `package.json` scripts across projects for consistency. Highlights scripts whose values differ from the most common value (or a reference project).

```
jrd check-scripts [scripts...] [options]

Options:
  -d, --dir <dir>   Root directory to scan (default: ~/Developer)
  -r, --ref <ref>   Reference project name to compare against
  -a, --all         Show all scripts, including matching ones
  -f, --flat        Show one line per project instead of grouping by value
```

---

### `jrd clean-builds`

Delete build artifacts (`build`, `dist`, `ios`, `android`) across one or more repos. Dry run by default.

```
jrd clean-builds [dir...] [options]

Options:
  -m, --modules   Also delete node_modules
  -D, --delete    Actually delete (default is dry run)
```

---

### `jrd clean-junk`

Delete files and directories matching given criteria.

```
jrd clean-junk [dir] [options]

Options:
  -i, --includes <str>    Delete items whose name includes this string
  -e, --excludes <str>    Delete items whose name excludes this string
      --extension <str>   Delete files with this extension
  -s, --size <mb>         Delete items under this size in MB
  -r, --recursive         Scan directories recursively
  -f, --force             Skip confirmation
  -v, --verbose           Show matched items before deleting
```

Example: `jrd clean-junk --includes .DS_Store -r`

---

### `jrd code-count`

Count lines of code by file extension across one or more paths.

```
jrd code-count [paths...] [options]

Options:
  -i, --ignore <types...>   Ignore files or file types (e.g. .json)
  -r, --recursive           Scan folders recursively
```

---

### `jrd find-dep`

Find projects in a directory that use any of the given dependencies (searches `dependencies`, `devDependencies`, and `peerDependencies`).

```
jrd find-dep <deps...> [options]

Options:
  -d, --dir <dir>   Root directory to scan (default: ~/Developer)
```

Example: `jrd find-dep react-native expo`

---

### `jrd focus`

Bring an application to the front using AppleScript.

```
jrd focus [app]
```

Default app is `Terminal`.

---

### `jrd folder-sizes`

List all subdirectories sorted by size, largest first.

```
jrd folder-sizes [dir]
```

---

### `jrd new-expo-project`

Bootstrap a new Expo project from the boilerplate repo. Clones or updates the boilerplate, copies it to `~/Developer/<Name>`, rewrites `package.json` and `app.json` with the derived name/slug/bundle identifiers, and creates an initial git commit.

```
jrd new-expo-project [options]

Options:
  -n, --name <name>   Project name (required)
```

Example: `jrd new-expo-project --name MyApp`

---

### `jrd npm-downloads`

List all your npm packages sorted by total downloads.

```
jrd npm-downloads [options]

Options:
  -u, --user <name>      npm username (defaults to npm whoami)
  -p, --period <period>  last-day | last-week | last-month | last-year (default: last-month)
  -m, --mtd              Use month-to-date instead of rolling 30 days
```

---

### `jrd npm-namer`

Check npm package name availability. Automatically checks nospace, hyphenated, and underscored variants.

```
jrd npm-namer <name> [options]

Options:
  -s, --synonyms   Also check synonyms of the name
```

---

### `jrd rename-season`

Rename files in a directory to `SxEE` format for TV library pickup (e.g. `1x01.mkv`, `1x02.mkv`).

```
jrd rename-season <season> [dir]
```

---

### `jrd repo-status`

Scan a directory of git repos and report which ones have dirty files, untracked files, or unpushed commits.

```
jrd repo-status [dir]
```

---

### `jrd update-boilerplate`

Update the Expo boilerplate repo — clones it if absent, runs `jrd update-deps`, lint-fixes, type-checks, tests, then commits and pushes the result.

```
jrd update-boilerplate
```

---

### `jrd update-deps`

Update all npm dependencies to `@latest`. Automatically runs `npx expo install --fix` if the project uses Expo.

```
jrd update-deps [options]

Options:
  -d, --dev      Only update devDependencies
  -p, --prod     Only update dependencies
  -l, --legacy   Pass --legacy-peer-deps to npm install
```

## Requirements

Node >= 20
