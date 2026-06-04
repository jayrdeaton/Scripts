# @jayrdeaton/scripts

Personal dev CLI. Invoked as `jrd`.

## Install

```sh
npm install -g @jayrdeaton/scripts
```

## Commands

### `jrd bump-ota`

Bumps `otaVersion` in `src/constants/release.ts` and auto-commits the change. Requires a clean working directory.

```
jrd bump-ota [options]

Options:
  -f, --file <file>   Path to release file (default: src/constants/release.ts)
```

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

### `jrd folder-sizes`

List all subdirectories sorted by size, largest first.

```
jrd folder-sizes [dir]
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
