# @jayrdeaton/scripts

Personal dev CLI. Invoked as `jrd`.

## Install

```sh
npm install -g @jayrdeaton/scripts
```

## Commands

Commands are grouped into namespaces (`gh`, `expo`, `ship`, `npm`, `dev`, `data`); general-purpose utilities live at the top level. Run `jrd help`, or `jrd <namespace> help`, to see the tree.

## `gh` - GitHub

### `jrd gh rulesets`

Show your GitHub repos (owner included) and their ruleset status - each repo lists its rulesets with enforcement status and target, or is flagged as having none. By default it shows your personally-owned repos; pass `--org <name>` to target an organization instead. Results stream as they are fetched. Archived repos are skipped. Requires `gh auth login`.

```
jrd gh rulesets [options]

Options:
  -o, --org <org>         Target an organization instead of your personal repos
  -a, --access <access>   Which repos to include: all, private, or public (default: public)
  -m, --missing           Only show repos that have no ruleset
```

### `jrd gh rulesets apply`

Apply a ruleset (from a JSON file) to many repos at once. By default it targets your personally-owned repos; pass `--org <name>` to target an organization instead, or pass an explicit list of repos. A bare repo name resolves to your account (or to `--org` when given); use the `owner/repo` form to target anything else. Streams results as it goes. By default it skips any repo that already has a ruleset of the same name; pass `--overwrite` to update those in place instead. Runs as a dry run unless you pass `--apply`. The JSON file is the create-ruleset body - read-only fields (`id`, `source`, `created_at`, …) are stripped, so a ruleset exported via `gh api /repos/OWNER/REPO/rulesets/ID` can be reused directly. Requires `gh auth login`.

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

Make repos private, and optionally archive them. By default it targets your personally-owned repos; pass `--org <name>` to target an organization instead, or pass an explicit list of repos. A bare repo name resolves to your account (or to `--org` when given); use the `owner/repo` form to target anything else. The main use case: hide archived repos that still show on your profile by making them private (`--archived`). Archived repos are read-only on GitHub, so for each one the command transparently unarchives, sets it private, then re-archives - preserving the archived state. Use `--archive` to also archive repos that aren't archived yet. Repos already in the desired state are skipped. Runs as a dry run unless you pass `--apply`. Requires `gh auth login`.

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

## `expo` - Expo projects

### `jrd expo new`

Bootstrap a new Expo project from the boilerplate repo. Clones or updates the boilerplate, copies it to `~/Developer/<Name>`, rewrites `package.json` and `app.json` with the derived name/slug/bundle identifiers, and creates an initial git commit.

```
jrd expo new [options]

Options:
  -n, --name <name>   Project name (required)
```

Example: `jrd expo new --name MyApp`

### `jrd expo update-boilerplate`

Update the Expo boilerplate repo - clones it if absent, runs `jrd npm update`, lint-fixes, type-checks, tests, then commits and pushes the result.

```
jrd expo update-boilerplate
```

## `ship` - Builds, updates and releases

Run from an app's or package's own directory: `build` for Expo and Electron apps, `update` for Expo apps, `release` for both (an npm package publishes on its tag, an app with a tag-triggered deploy workflow deploys), `draft` and `publish` for an Electron app's direct downloads. All three run what CI runs before anything ships: `npm ci --dry-run` (so an out-of-sync `package-lock.json` is caught locally), then the project's `verify` script (or `lint`, `test` and `typecheck`, whichever exist). `release` does this before bumping, so a failure leaves nothing committed or pushed, and also runs `vercel.json`'s `buildCommand` when there is one (an Expo app's `expo export -p web`), since that's what the tag's web deploy builds. It skips a step something else already runs: `verify` in a `preversion` script or at the start of a `build:web`, or a web build that `verify` already includes. `update` and `release` require a clean working directory up front. `build` and `update` check `<profile>` against `eas.json`'s build profiles.

### `jrd ship build`

Builds the Expo app in the current directory. `development` always builds locally, and so does any other profile given `--local`: `expo prebuild --clean`, then `eas build --profile <profile> --local`, and the artifact is moved to `~/Downloads/Builds/<Name>-<timestamp>.<ext>`. Without `--local`, every other profile builds in the EAS cloud (`eas build --profile <profile>`). A local `production` build uses no EAS build; upload it with `eas submit --path <file>` or Transporter. Each local `.ipa` is also recorded in `~/.config/jrd/builds.json` (version, build number, native fingerprint, commit), which outlives the `.ipa` once it's installed and deleted, so `jrd ship status` can tell which build a phone has.

When `app.json` has no `ios.infoPlist.ITSAppUsesNonExemptEncryption`, eas-cli asks about encryption on an iOS build, and its questions read backwards: Yes to "iOS app only uses standard/exempt encryption?" writes `false` into `app.json` before the upload. So `build` says what to answer first (an app that encrypts user data itself, like Lumber, answers No, then Yes, and App Store Connect asks on the build), and afterwards fails if eas-cli wrote the key, since that build claims exempt encryption.

An Electron app (a directory with an `electron-builder.yml`, like Lumber-Desktop) builds on this Mac through its own pack scripts, so they still work without jrd: `development` runs `npm run pack` (an unsigned local build), `mas-dev` `npm run pack:mas-dev` (the Mac App Store build, development signed, to run sandboxed here) and `mas` `npm run pack:mas` (the Mac App Store build for upload). Each first checks the lockfile and runs the `verify` of the web app its `export` script `cd`s into (`../Lumber`), since that app's working tree is what gets bundled, and the signed profiles check that their certificates (and for `mas`, the provisioning profile) are in place, `mas-dev` saying what to click if the keychain prompts. After the build, the app is checked: its signature, bundle id and version, then for both store profiles a sandbox on every executable, and for `mas` the build number, the Apple Distribution signer and team, the application identifier, the embedded profile and the `.pkg`'s Mac Installer Distribution signature, which is most of what App Store Connect would otherwise refuse after the upload. `mas` also needs a clean tree in both repos, raises `electron-builder.yml`'s `buildVersion` (committed as `buildVersion 1 -> 2` only once the package passes its checks, and put back if anything fails), saves the `.pkg` to `~/Downloads/Builds/<Name>-<timestamp>.pkg`, records it in `builds.json` (marked `platform: 'macos'`, since it can share the iPhone app's bundle id and `status` reads iOS builds) and opens it in Transporter, where Deliver uploads it. The upload stays a click: unattended, `xcrun altool --upload-package` would need an App Store Connect API key on this Mac that can upload without asking.

`mas` signs from `.p12` files, not the login keychain. An Apple Distribution certificate in the login keychain breaks every Expo app's `eas build --local` for iOS: EAS asks Xcode for the generic `iPhone Distribution` identity, Xcode takes the Apple Distribution certificate for it, and EAS's provisioning profile doesn't include that one. Set up once: in Keychain Access (login, My Certificates), export the Apple Distribution and Mac Installer Distribution (3rd Party Mac Developer Installer) certificates as Personal Information Exchange (.p12) with one password, save them as `~/.config/jrd/signing/apple-distribution.p12` and `~/.config/jrd/signing/mac-installer-distribution.p12`, delete the Apple Distribution certificate from the login keychain, and add the password with `security add-generic-password -a "$USER" -s "jrd Mac App Store signing" -w` (it asks for it). `mas` checks that both files open with that password and hold their certificate and key, then hands them to electron-builder (`CSC_LINK`, `CSC_INSTALLER_LINK` and their passwords), which signs from a keychain of its own and deletes it after the build, so nothing asks for keychain access. Run without jrd, `npm run pack:mas` needs those four variables set.

`direct` is the direct download (SlingScan-Desktop), for an app that can't be sandboxed for the Mac App Store: `npm run dist`, a DMG and zip signed with the team's Developer ID Application certificate, with hardened runtime, then notarized and stapled. A Developer ID certificate is the team's, not one app's, so the same one signs any app's direct download. It's a `.p12` like the others, `~/.config/jrd/signing/developer-id-application.p12` under the same password, and only the Account Holder can make one (developer.apple.com, Certificates, Developer ID, Developer ID Application, G2 Sub-CA, from a certificate signing request made in Keychain Access, or Xcode's Manage Certificates, which only offers it to the Account Holder). Notarizing uses an App Store Connect API key saved in notarytool's `jrd-notarization` profile (a Team Key with Developer access, then `xcrun notarytool store-credentials jrd-notarization --key <AuthKey_ID.p8> --key-id <ID> --issuer <Issuer ID>`), which `direct` tries with Apple before building, since electron-builder only warns and skips notarizing without it, and hands to electron-builder as `APPLE_KEYCHAIN_PROFILE`. The app's `electron-builder.yml` names the team's identity in `mac`, so `pack` overrides it back to ad hoc on its command line. After the build, `direct` checks the Developer ID signer and team, hardened runtime, the stapled ticket and Gatekeeper's verdict (`spctl`, "Notarized Developer ID"), then the same for the app inside the DMG and inside the zip (what electron-updater installs), needs a clean tree like `mas`, saves the DMG to `~/Downloads/Builds/<Name>-<timestamp>.dmg` and records it in `builds.json`. Releasing it is `jrd ship draft`'s job, which runs this build itself.

```
jrd ship build <profile> [options]

Options:
  -l, --local   Build on this Mac instead of the EAS cloud (development always builds locally; Expo only)
```

### `jrd ship draft`

Releases an Electron app's direct downloads in one command, for Lumber-Desktop (the Mac, Linux and the Microsoft Store packages) and SlingScan-Desktop (the Mac alone, having no Build workflow): run `jrd ship draft` in the app's directory (Lumber-Desktop) once `package.json`'s `version` is raised and both repos are pushed. It builds and checks everything, makes a draft, shows it, and publishes it on a yes. The release goes in the repo `electron-builder.yml`'s `publish` block names (`infinitetoken/Lumber-Releases`), tagged `v<version>` and titled as the latest release is with the new version in it (`Lumber 1.2.0`, `SlingScan for Mac 1.0.4`; `<productName> <version>` for a first release), which is where electron-updater looks and the download links (`releases/latest/download/<name>`) point.

1. Stops before anything is built when `v<version>` is already released, the version isn't newer than the latest release (no copy would update to it), there's already a draft for it (unless `--replace`), or either tree is dirty (the app's and the web app its `export` script bundles, `../Lumber`).
2. When the app has a `.github/workflows/build.yml` run by hand (Lumber-Desktop's Build, which makes Linux's AppImages and debs and the Microsoft Store packages on GitHub's runners), it starts it on the current branch, giving its input (`lumber_ref`) the web app's full HEAD SHA. The workflow builds the branch as GitHub has it, so the branch has to be exactly what's pushed, and the web app's HEAD has to be pushed, or draft says to push first (it never pushes). A run already building or built for the same two commits, with its artifacts still kept, is used instead of a new one, so running draft again after a failed Mac build doesn't build the rest again.
3. Builds the Mac's DMG and zip meanwhile, as `jrd ship build direct` does (verify in both repos, signed, notarized, stapled, checked).
4. Waits for the workflow (offering to rerun its failed jobs if it fails) and downloads its artifacts into `out/release/`. A Microsoft Store package (`.appx`) is saved to `~/Downloads/Builds/<Name>-<timestamp>-<arch>.appx`, for uploading in Partner Center by hand. An artifact with update feeds (`latest-linux.yml`, `latest-linux-arm64.yml`) joins the release.
5. Checks every file that will go up: each feed (`latest-mac.yml` and the workflow's) is for this version and lists files whose sha512 and size match it (what electron-updater checks after downloading), the Mac's are from this build, the downloads people get by hand (`.dmg`, `.AppImage`, `.deb`) carry no version in their names, and every name the latest release has without its version is there again, so no download link breaks. The files are each feed, the files it lists and their blockmaps (Lumber's are the eleven of v1.1.0).
6. Creates the draft with every file and checks what GitHub stored against what was built: every name, size and sha256 (GitHub's digest). A draft isn't in `releases.atom`, so no copy sees it.
7. Shows the draft (its link, notes and files) and asks whether to publish it, doing what `jrd ship publish` does on a yes. On a no, or with no terminal to ask in, it stays a draft for `jrd ship publish`.

The notes write themselves: this version's What's New from the app's `store/README.md` or else its `README.md` (a `**What's New** (1.2.0):` line over a fenced block: Lumber-Desktop's Mac App Store text, whose `•` lines become bullets, or a paragraph of prose, kept as it is), then a Downloads list linking each platform's files on this release (the Mac's DMG with its chip, the debs and AppImages by architecture). Without a What's New for the version, draft says so before it builds, so it can be written and committed meanwhile, and the notes list only the downloads. `--notes` or `--notes-file` replaces them.

`--dry-run` does everything but the release: it starts the workflow and makes the notarized Mac build, then lists the files and notes it would upload.

```
jrd ship draft [options]

Options:
  -n, --notes <notes>      The release notes (Markdown), in place of the ones it writes
  -F, --notes-file <file>  Read the release notes from a file
  -t, --title <title>      The release title (default: the latest release's with this version)
  -r, --replace            Delete the draft already made for this version, once the new files are built and checked
  -d, --dry-run            Build and check everything, but make no release
```

### `jrd ship publish`

Publishes the draft `draft` made for `package.json`'s version and wasn't told to publish, in the app's directory: for publishing later, since `draft` asks at its end. It checks the draft once more (its feeds against its files' sizes, the version newer than the latest release, the fixed names), shows its title, notes and files, and asks before publishing; with no terminal to ask in it refuses unless given `--yes`. Then it publishes the draft as the latest release and follows every fixed-name link (`releases/latest/download/<name>`) to its file, failing if one doesn't lead to this release's copy yet.

```
jrd ship publish [options]

Options:
  -y, --yes   Publish without asking (only once you've checked the draft)
```

### `jrd ship update`

Publishes an EAS update for the app in the current directory: bumps `otaVersion` (`jrd ship bump-ota`), then `eas update --branch <profile> --environment <profile>` with the app's last commit message. Every profile but `development` runs non-interactively.

```
jrd ship update <profile> [options]

Options:
  -f, --file <file>   Path to release file for the otaVersion bump (default: src/constants/release.ts)
```

### `jrd ship bump-ota`

Bumps `otaVersion` in `src/constants/release.ts` and auto-commits the change. Requires a clean working directory.

```
jrd ship bump-ota [options]

Options:
  -f, --file <file>   Path to release file (default: src/constants/release.ts)
```

### `jrd ship release`

Bumps the version with `npm version <bump> --no-git-tag-version` (so `preversion`, `version` and `postversion` still run), copies the new version into `app.json`'s `expo.version` when there is one, then commits both as one commit named after the version, adds an annotated `v<version>` tag (npm's `tag-version-prefix` and `message` settings apply) and runs `git push --follow-tags`. Requires a clean working directory.

`expo.version` is the store version, so the git tag, the web deploy and the next store build share one number. It isn't part of the app's fingerprint runtime version, so a release never cuts existing builds off from OTA updates. Only that value in `app.json` is rewritten, found by its place in the JSON (a plugin option named `version`, or the same number elsewhere, is left alone), and the rest of the file keeps its formatting; if it can't be found, nothing is committed.

```
jrd ship release <bump>     (major, minor, or patch)
```

### `jrd ship status`

Read-only. Shows where each Expo app stands, everything measured against the local checkout:

- **Web:** the newest Vercel production deployment (`vercel ls --prod`), the tag it was built from, and the last run of the tag-triggered Deploy workflow, so a failed deploy shows up.
- **Builds:** the newest iOS build per EAS profile, whichever is newer: an EAS build or a local build from `jrd ship build` (its record, or an `.ipa` in `~/Downloads/Builds` from before it kept records).
- **Installs:** the app on each booted simulator, and on each connected iPhone or iPad (`devicectl`, over cable or Wi-Fi). A phone's install can't be read directly, so its version and build number are matched to an EAS build or a local build record. Build numbers come from one EAS counter shared by every profile, so the pair identifies the build. A phone build with neither shows as having no build record.
- **Updates:** the newest iOS EAS update on the `production` branch, and on `development` when there's a dev build for it to reach.

Every build is compared to the checkout's iOS fingerprint (`eas fingerprint:generate`, which includes uncommitted changes). The fingerprint is the runtime version an update has to match. A build whose fingerprint matches can get the current code as an update. One that doesn't needs a new build. Each update row also says whether its runtime matches the newest build on its channel. Commit counts skip commits that only touch `src/constants/release.ts`, since an otaVersion bump on its own leaves nothing new to ship. Each app ends with what to run next, for example `jrd ship update production` when only JS changed since the last update, `jrd ship build production` when native code changed, or installing a local `.ipa` that matches the code on a phone running an older build. A source that fails or times out (eas, vercel, devicectl) is named under its app instead of reading as empty.

Dirs resolve against `~/Developer`. With none, it checks the current directory if it's an Expo app (`app.json` and `eas.json`). Otherwise it checks every Expo app under `~/Developer` that has a `v*` tag. Several apps are checked at once, each printed as soon as it and the ones before it are done (about 30 seconds for eight). iOS only. App Store review state isn't visible to it.

```
jrd ship status [dirs...] [options]

Options:
  -j, --json   Print the gathered data as JSON instead of the report
```

## `npm` - npm packages

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

Update all npm dependencies of the project in the current directory to `@latest`. Automatically runs `npx expo install --fix` if the project uses Expo. Skips any dependency whose version is not a plain version number - `file:`, `yalc:`, `link:`, `workspace:`, and similar non-registry entries are left untouched.

```
jrd npm update [options]

Options:
  -d, --dev      Only update devDependencies
  -p, --prod     Only update dependencies
  -l, --legacy   Pass --legacy-peer-deps to npm install
```

### `jrd npm update-rific`

Update any detected `@rific/*` packages to `@latest` across one or more projects. Accepts a list of directories; defaults to the current directory when none are given. Skips any `@rific` dependency whose version is not a plain version number (`file:`, `link:`, `workspace:`, and similar).

```
jrd npm update-rific [dirs...] [options]

Options:
  -l, --legacy   Pass --legacy-peer-deps to npm install
  -d, --dry      Preview which packages would be updated without installing
```

## `dev` - Across your Developer folder

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

## `data` - Encode / decode

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
