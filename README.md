# @jayrdeaton/scripts

Personal dev CLI. Invoked as `jrd`.

## Install

```sh
npm install -g @jayrdeaton/scripts
```

## Commands

Commands are grouped into namespaces (`gh`, `expo`, `npm`, `dev`); general-purpose utilities live at the top level. Run `jrd help`, or `jrd <namespace> help`, to see the tree.

## `gh` — GitHub

### `jrd gh rulesets`

Show your GitHub repos (owner included) and their ruleset status — each repo lists its rulesets with enforcement status and target, or is flagged as having none. By default it shows your personally-owned repos; pass `--org <name>` to target an organization instead. Results stream as they are fetched. Archived repos are skipped. Requires `gh auth login`.

```
jrd gh rulesets [options]

Options:
  -o, --org <org>         Target an organization instead of your personal repos
  -a, --access <access>   Which repos to include: all, private, or public (default: public)
  -m, --missing           Only show repos that have no ruleset
```

### `jrd gh rulesets apply`

Apply a ruleset (from a JSON file) to many repos at once. By default it targets your personally-owned repos; pass `--org <name>` to target an organization instead, or pass an explicit list of repos. A bare repo name resolves to your account (or to `--org` when given); use the `owner/repo` form to target anything else. Streams results as it goes. By default it skips any repo that already has a ruleset of the same name; pass `--overwrite` to update those in place instead. Runs as a dry run unless you pass `--apply`. The JSON file is the create-ruleset body — read-only fields (`id`, `source`, `created_at`, …) are stripped, so a ruleset exported via `gh api /repos/OWNER/REPO/rulesets/ID` can be reused directly. Requires `gh auth login`.

```
jrd gh rulesets apply [repos...] [options]

Options:
  -f, --file <file>       Path to the ruleset JSON file (required)
  -o, --org <org>         Target an organization instead of your personal repos
  -a, --access <access>   Visibility when using selectors: all, private, or public (default: public)
  -O, --overwrite         Update repos that already have a ruleset of this name, instead of skipping
  -A, --apply             Actually create the rulesets (default is a dry run)
```

Example: `jrd gh rulesets apply --file ruleset.json` previews against your personal repos; add `--apply` to write.

### `jrd gh repos`

List your repos with visibility and archived state. Requires `gh auth login`.

```
jrd gh repos [options]

Options:
  -o, --org <org>         Target an organization instead of your personal repos
  -a, --access <access>   Filter by visibility: all, private, or public (default: all)
  -s, --sort <field>      Sort field: name, created, updated, pushed (default: name)
  -d, --desc              Reverse sort order
  -A, --archived          Show only archived repos
  -f, --forks             Include forks (excluded by default)
```

### `jrd gh archive`

Archive repos, and optionally make them private. By default it targets your personally-owned public repos; pass `--org <name>` to target an organization instead, or pass an explicit list of repos. A bare repo name resolves to your account (or to `--org` when given); use the `owner/repo` form to target anything else. Repos that are already archived (and already private when `--privatize` is given) are skipped. Archived repos are read-only on GitHub, so if a repo is already archived but still public and you pass `--privatize`, the command transparently unarchives, sets it private, then re-archives. Runs as a dry run unless you pass `--apply`. Requires `gh auth login`.

```
jrd gh archive [repos...] [options]

Options:
  -o, --org <org>         Target an organization instead of your personal repos
  -a, --access <access>   Visibility to list: all, private, or public (default: public)
  -p, --privatize         Also make each repo private before archiving
  -y, --apply             Actually make the changes (default is a dry run)
```

Example: `jrd gh archive` previews archiving all your public repos; add `--apply` to write.

### `jrd gh privatize`

Make repos private, and optionally archive them. By default it targets your personally-owned repos; pass `--org <name>` to target an organization instead, or pass an explicit list of repos. A bare repo name resolves to your account (or to `--org` when given); use the `owner/repo` form to target anything else. The main use case: hide archived repos that still show on your profile by making them private (`--archived`). Archived repos are read-only on GitHub, so for each one the command transparently unarchives, sets it private, then re-archives — preserving the archived state. Use `--archive` to also archive repos that aren't archived yet. Repos already in the desired state are skipped. Runs as a dry run unless you pass `--apply`. Requires `gh auth login`.

```
jrd gh privatize [repos...] [options]

Options:
  -o, --org <org>         Target an organization instead of your personal repos
  -a, --access <access>   Visibility to list: all, private, or public (default: public)
  -r, --archived          Only target repos that are currently archived
  -A, --archive           Also archive each repo after making it private
  -y, --apply             Actually make the changes (default is a dry run)
```

Example: `jrd gh privatize --archived` previews making all your archived repos private; add `--apply` to write.

## `expo` — Expo projects

### `jrd expo bump-ota`

Bumps `otaVersion` in `src/constants/release.ts` and auto-commits the change. Requires a clean working directory.

```
jrd expo bump-ota [options]

Options:
  -f, --file <file>   Path to release file (default: src/constants/release.ts)
```

### `jrd expo new`

Bootstrap a new Expo project from the boilerplate repo. Clones or updates the boilerplate, copies it to `~/Developer/<Name>`, rewrites `package.json` and `app.json` with the derived name/slug/bundle identifiers, and creates an initial git commit.

```
jrd expo new [options]

Options:
  -n, --name <name>   Project name (required)
```

Example: `jrd expo new --name MyApp`

### `jrd expo update-boilerplate`

Update the Expo boilerplate repo — clones it if absent, runs `jrd npm update`, lint-fixes, type-checks, tests, then commits and pushes the result.

```
jrd expo update-boilerplate
```

## `npm` — npm packages

### `jrd npm downloads`

List all your npm packages sorted by total downloads.

```
jrd npm downloads [options]

Options:
  -u, --user <name>      npm username (defaults to npm whoami)
  -p, --period <period>  last-day | last-week | last-month | last-year (default: last-month)
  -m, --mtd              Use month-to-date instead of rolling 30 days
```

### `jrd npm namer`

Check npm package name availability. Automatically checks nospace, hyphenated, and underscored variants.

```
jrd npm namer <name> [options]

Options:
  -s, --synonyms   Also check synonyms of the name
```

### `jrd npm update`

Update all npm dependencies of the project in the current directory to `@latest`. Automatically runs `npx expo install --fix` if the project uses Expo. Skips any dependency whose version is not a plain version number — `file:`, `yalc:`, `link:`, `workspace:`, and similar non-registry entries are left untouched.

```
jrd npm update [options]

Options:
  -d, --dev      Only update devDependencies
  -p, --prod     Only update dependencies
  -l, --legacy   Pass --legacy-peer-deps to npm install
```

## `dev` — Across your Developer folder

Commands that operate over the projects in `~/Developer` (override with `--dir` where supported).

### `jrd dev find-dep`

Find projects in a directory that use any of the given dependencies (searches `dependencies`, `devDependencies`, and `peerDependencies`).

```
jrd dev find-dep <deps...> [options]

Options:
  -d, --dir <dir>   Root directory to scan (default: ~/Developer)
```

Example: `jrd dev find-dep react-native expo`

### `jrd dev find-overrides`

Find projects in a directory that have an `overrides` field in their `package.json`.

```
jrd dev find-overrides [options]

Options:
  -d, --dir <dir>   Root directory to scan (default: ~/Developer)
```

### `jrd dev find-script`

Find projects in a directory whose `package.json` scripts contain an exact command value.

```
jrd dev find-script <command> [options]

Options:
  -d, --dir <dir>   Root directory to scan (default: ~/Developer)
```

Example: `jrd dev find-script "eslint . --fix"`

### `jrd dev including`

Find projects in a directory that contain a given file.

```
jrd dev including <file> [options]

Options:
  -d, --dir <dir>   Root directory to scan (default: ~/Developer)
```

Example: `jrd dev including PLAN.md`

### `jrd dev missing`

Find projects in a directory that are missing a given file.

```
jrd dev missing <file> [options]

Options:
  -d, --dir <dir>   Root directory to scan (default: ~/Developer)
```

Example: `jrd dev missing README.md`

### `jrd dev yalc-check`

Find projects in a directory that have yalc dependencies (version entries starting with `file:.yalc/` or a `yalc.lock` present).

```
jrd dev yalc-check [options]

Options:
  -d, --dir <dir>   Root directory to scan (default: ~/Developer)
```

### `jrd dev check-scripts`

Compare `package.json` scripts across projects for consistency. Highlights scripts whose values differ from the most common value (or a reference project).

```
jrd dev check-scripts [scripts...] [options]

Options:
  -d, --dir <dir>   Root directory to scan (default: ~/Developer)
  -r, --ref <ref>   Reference project name to compare against
  -a, --all         Show all scripts, including matching ones
  -f, --flat        Show one line per project instead of grouping by value
```

### `jrd dev sync-peers`

Sync `@rific` package `peerDependency` floors and `devDependency` versions to match Expo-Starter. Dry run by default.

```
jrd dev sync-peers [options]

Options:
  -s, --starter <path>   Path to Expo-Starter project (default: ~/Developer/Expo-Starter)
  -r, --root <path>      Root directory containing @rific packages (default: ~/Developer)
  -d, --dry              Preview changes without writing
  -i, --install          Run npm install in each changed repo
  -t, --test             Run npm test in each changed repo (implies --install)
```

### `jrd dev clean-builds`

Delete build artifacts (`build`, `dist`, `ios`, `android`) across one or more repos. Dry run by default.

```
jrd dev clean-builds [dir...] [options]

Options:
  -m, --modules   Also delete node_modules
  -D, --delete    Actually delete (default is dry run)
```

### `jrd dev clean-junk`

Delete files and directories matching given criteria.

```
jrd dev clean-junk [dir] [options]

Options:
  -i, --includes <str>    Delete items whose name includes this string
  -e, --excludes <str>    Delete items whose name excludes this string
      --extension <str>   Delete files with this extension
  -s, --size <mb>         Delete items under this size in MB
  -r, --recursive         Scan directories recursively
  -f, --force             Skip confirmation
  -v, --verbose           Show matched items before deleting
```

Example: `jrd dev clean-junk --includes .DS_Store -r`

### `jrd dev count`

Count lines of code by file extension across one or more paths.

```
jrd dev count [paths...] [options]

Options:
  -i, --ignore <types...>   Ignore files or file types (e.g. .json)
  -r, --recursive           Scan folders recursively
```

### `jrd dev repo-status`

Scan a directory of git repos and report which ones have dirty files, untracked files, or unpushed commits.

```
jrd dev repo-status [dir]
```

## `data` — Encode / decode

### `jrd data base64`

Encode or decode base64 strings and files.

```
jrd data base64 encode <value> [options]
jrd data base64 decode <value> [options]

Options:
  -f, --file   Treat value as a file path
  -c, --copy   Copy result to clipboard
```

### `jrd data binary`

Encode a file to a binary string, or restore a binary string back to its original file.

```
jrd data binary encode <file> [options]
jrd data binary decode <file> <destination>

Options (encode):
  -c, --copy           Copy result to clipboard
  -o, --output <dest>  Write result to a file
```

## Top-level utilities

### `jrd check-domains`

Check domain availability via RDAP using a wildcard pattern where `?` matches any letter. Supports `.com`, `.net`, `.org`, and `.io`.

```
jrd check-domains <pattern> [options]

Options:
  -c, --concurrency <n>   Concurrent requests (default: 5)
  -o, --output <file>     Write available domains to a file
```

Example: `jrd check-domains ??fu.com`

### `jrd focus`

Bring an application to the front using AppleScript.

```
jrd focus [app]
```

Default app is `Terminal`.

### `jrd folder-sizes`

List all subdirectories sorted by size, largest first.

```
jrd folder-sizes [dir]
```

## Requirements

Node >= 20
