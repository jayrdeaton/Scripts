import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { Color, confirm, log, Spinner } from 'termkit'

import { configValue, isElectronProject, webSource } from './electron.mjs'

// Shared by `jrd ship draft` and `jrd ship publish`: an Electron app's direct downloads, released on GitHub in the
// repo electron-builder.yml's publish block names (Lumber-Desktop's infinitetoken/Lumber-Releases), where
// electron-updater finds them and the download links point. Lives outside src/commands because the CLI turns every
// .mjs file there into a command.

export const fail = (message) => {
  log.fail(message)
  process.exit(1)
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const MAX_BUFFER = 64 * 1024 * 1024
export const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    .toString()
    .trim()
export const gh = (args, cwd) => execFileSync('gh', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: MAX_BUFFER }).toString()
export const ghJson = (args, cwd) => JSON.parse(gh(args, cwd))
// gh's own words from a failed call
export const ghError = (e) => e.stderr?.toString().trim() || e.message
export const shown = (path) => path.replace(homedir(), '~')

// Runs gh with its output on the terminal, echoed like ship's other commands (paths shortened)
export function ghLoud(args, cwd) {
  console.log(Color.faint(`$ gh ${args.map((arg) => (/[\s"]/.test(arg) ? JSON.stringify(shown(arg)) : shown(arg))).join(' ')}`))
  execFileSync('gh', args, { cwd, stdio: 'inherit' })
}

// What draft and publish need to know about the app in cwd: where its releases go (GitHub, as
// electron-builder.yml's publish block says), the version it releases (package.json's, tagged v<version>, as
// electron-updater's GitHub provider expects), its output folder and the web app it bundles
export function releaseTarget(cwd) {
  if (!isElectronProject(cwd)) fail("No electron-builder.yml here: ship draft and ship publish release an Electron app's direct downloads.")
  const config = readFileSync(join(cwd, 'electron-builder.yml'), 'utf8')
  const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
  const [provider, owner, repo] = ['provider', 'owner', 'repo'].map((key) => configValue(config, key, 'publish'))
  if (provider !== 'github' || !owner || !repo) fail("electron-builder.yml's publish block doesn't name a GitHub repo (provider: github, owner, repo), which is where the releases go.")
  return {
    config,
    pkg,
    productName: configValue(config, 'productName') ?? pkg.productName ?? pkg.name,
    version: pkg.version,
    tag: `v${pkg.version}`,
    slug: `${owner}/${repo}`,
    outDir: join(cwd, configValue(config, 'output', 'directories') ?? 'dist'),
    web: webSource(cwd, pkg.scripts ?? {})
  }
}

// major.minor.patch, a prerelease below its release, as electron-updater orders them. Negative when a is older.
export function compareVersions(a, b) {
  const parse = (version) => {
    const [core, pre] = version.replace(/^v/, '').split('-')
    return { parts: core.split('.').map(Number), pre }
  }
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < 3; i++) if ((x.parts[i] ?? 0) !== (y.parts[i] ?? 0)) return (x.parts[i] ?? 0) - (y.parts[i] ?? 0)
  if (x.pre === y.pre) return 0
  if (!x.pre) return 1
  if (!y.pre) return -1
  return x.pre < y.pre ? -1 : 1
}

// The repo's releases, drafts included
export const listReleases = (slug) => ghJson(['release', 'list', '--repo', slug, '--limit', '100', '--json', 'tagName,isDraft,isLatest,isPrerelease'])

// A release by its tag, a draft too (gh finds a draft by the tag it will get)
export const viewRelease = (slug, tag) => ghJson(['release', 'view', tag, '--repo', slug, '--json', 'tagName,name,body,isDraft,url,assets'])

// The release every copy updates from now, and whose files releases/latest/download/<name> leads to, or null before the first
export function latestRelease(slug, releases) {
  const published = releases.filter((release) => !release.isDraft && !release.isPrerelease)
  const latest = published.find((release) => release.isLatest) ?? published.sort((a, b) => compareVersions(b.tagName, a.tagName))[0]
  return latest ? viewRelease(slug, latest.tagName) : null
}

// An electron-builder update feed (latest-mac.yml, latest-linux.yml, latest-linux-arm64.yml): its version, and each
// file's name, sha512 and size. Read by line, since its layout is fixed and jrd has no YAML parser.
export function readFeed(path) {
  const unquote = (value) => value.trim().replace(/^(['"])(.*)\1$/, '$2')
  const feed = { version: null, path: null, sha512: null, files: [] }
  let file = null
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const item = line.match(/^\s+-\s+url:(.*)$/)
    const field = line.match(/^\s+(sha512|size):(.*)$/)
    const top = line.match(/^(version|path|sha512):(.*)$/)
    if (item) {
      file = { url: unquote(item[1]) }
      feed.files.push(file)
    } else if (field && file) {
      file[field[1]] = field[1] === 'size' ? Number(field[2]) : unquote(field[2])
    } else if (top) {
      feed[top[1]] = unquote(top[2])
      file = null
    }
  }
  return feed
}

export const isFeed = (name) => /^latest.*\.yml$/.test(name)

// A file's size and hashes: sha512 (base64) as electron-builder's feeds list it, sha256 (hex) as GitHub reports
// a release asset's digest
export function describeFile(path) {
  return new Promise((resolve, reject) => {
    const sha256 = createHash('sha256')
    const sha512 = createHash('sha512')
    createReadStream(path)
      .on('data', (chunk) => {
        sha256.update(chunk)
        sha512.update(chunk)
      })
      .on('error', reject)
      .on('end', () => resolve({ size: statSync(path).size, sha256: sha256.digest('hex'), sha512: sha512.digest('base64') }))
  })
}

// A feed and the files it lists, as the release will carry them: each file checked against the feed's sha512 and
// size (electron-updater checks the same after downloading, so a mismatch is an update that never installs), its
// blockmap added when electron-builder made one (for differential downloads), and the feed's version checked against
// the one being released, which is what every copy compares its own with. since: when the build started, so a file
// an earlier build left in the folder is caught. from: where the files came from, for the list and the problems.
// Problems are pushed onto problems.
export async function feedFiles(dir, name, { version, since, from }, problems) {
  const where = `${from}'s ${name}`
  const path = join(dir, name)
  if (!existsSync(path)) {
    problems.push(`${from} has no ${name}`)
    return []
  }
  const feed = readFeed(path)
  if (feed.version !== version) problems.push(`${where} is for ${feed.version ?? 'no version'}, not ${version}`)
  if (!feed.files.length) problems.push(`${where} lists no files`)
  const main = feed.files.find((file) => file.url === feed.path)
  if (feed.path && (!main || main.sha512 !== feed.sha512)) problems.push(`${where}'s path and sha512 don't match its files`)

  const files = [{ name, path, from, ...(await describeFile(path)) }]
  for (const entry of feed.files) {
    const file = join(dir, entry.url)
    if (!existsSync(file)) {
      problems.push(`${where} lists ${entry.url}, which isn't there`)
      continue
    }
    const described = await describeFile(file)
    if (described.sha512 !== entry.sha512) problems.push(`${entry.url} isn't the file ${where} lists: their sha512 hashes differ`)
    if (described.size !== entry.size) problems.push(`${entry.url} is ${described.size} bytes, not the ${entry.size} ${where} lists`)
    files.push({ name: entry.url, path: file, from, ...described })
    const blockmap = `${file}.blockmap`
    if (existsSync(blockmap)) files.push({ name: `${entry.url}.blockmap`, path: blockmap, from, ...(await describeFile(blockmap)) })
  }
  if (since) for (const file of files) if (statSync(file.path).mtimeMs < since) problems.push(`${shown(file.path)} is left from an earlier build`)
  return files
}

// File names across releases. Lumber-Desktop's downloads carry their version from 1.3.0 on (Lumber-1.3.0-arm64.dmg;
// Jay, 2026-11-11), and its site picks each one from the latest release through GitHub's API; SlingScan-Desktop's DMG
// keeps a fixed name, which its links reach through releases/latest/download/<name>. Either way: no two files share a
// name, a name that carries a version carries this one (anything else is left from an earlier build), and a fixed name
// the latest release has and this one drops is said, since releases/latest/download/<name> stops working for it.
const VERSION_IN_NAME = /\d+\.\d+\.\d+/g
export function checkNames(names, version, previous, problems) {
  for (const name of new Set(names.filter((name, i) => names.indexOf(name) !== i))) problems.push(`two files are named ${name}`)
  const core = version.split('-')[0]
  for (const name of names) {
    const other = name.match(VERSION_IN_NAME)?.find((found) => found !== core)
    if (other) problems.push(`${name} is named for ${other}, not ${version}, so it's left from an earlier build`)
  }
  if (!previous) return
  const dropped = previous.assets.map((asset) => asset.name).filter((name) => !name.match(VERSION_IN_NAME) && !names.includes(name))
  if (dropped.length) log.warn(`${previous.tagName} has ${dropped.join(', ')}, which this release doesn't, so releases/latest/download/<name> stops working for ${dropped.length === 1 ? 'it' : 'them'}. That's expected when the names take on versions.`)
}

// A release's files as GitHub holds them, against the files uploaded: every one there, fully uploaded, the same size
// and the same sha256 (GitHub's digest of what it stored), and nothing else
export function checkAssets(release, files, problems) {
  const assets = new Map(release.assets.map((asset) => [asset.name, asset]))
  for (const file of files) {
    const asset = assets.get(file.name)
    assets.delete(file.name)
    if (!asset) problems.push(`${file.name} isn't on the release`)
    else if (asset.state !== 'uploaded') problems.push(`${file.name} is ${asset.state}, not uploaded`)
    else if (asset.size !== file.size) problems.push(`${file.name} on the release is ${asset.size} bytes, not ${file.size}`)
    else if (!asset.digest) problems.push(`GitHub reports no sha256 for ${file.name}, so it can't be checked`)
    else if (asset.digest !== `sha256:${file.sha256}`) problems.push(`${file.name} on the release isn't the file that was uploaded: their sha256 hashes differ`)
  }
  for (const name of assets.keys()) problems.push(`the release also has ${name}, which wasn't uploaded`)
}

const formatSize = (bytes) => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : bytes >= 1e3 ? `${(bytes / 1e3).toFixed(1)} kB` : `${bytes} B`)
export const totalSize = (files) => formatSize(files.reduce((sum, file) => sum + file.size, 0))

// files: { name, size, from? }
export function printFiles(files) {
  const width = Math.max(...files.map((file) => file.name.length))
  for (const file of files) console.log(`  ${file.name.padEnd(width)}  ${Color.faint(formatSize(file.size).padStart(8))}${file.from ? Color.faint(`  ${file.from}`) : ''}`)
}

// Whether a file answers at its link with this release's copy: null when it does, else what's wrong. A file with a
// version in its name is asked for at releases/download/<tag>/<name>; one without (a feed, or a fixed-name download)
// at releases/latest/download/<name>, which GitHub redirects to the latest release's copy even when no such file
// exists, so the file is asked for too.
async function linkProblem(slug, tag, asset) {
  const latest = !asset.name.match(VERSION_IN_NAME)
  const link = latest ? `releases/latest/download/${asset.name}` : `releases/download/${tag}/${asset.name}`
  try {
    let location = `https://github.com/${slug}/${link}`
    if (latest) {
      const first = await fetch(location, { method: 'HEAD', redirect: 'manual' })
      location = first.headers.get('location') ?? ''
      if (!location.endsWith(`/releases/download/${tag}/${asset.name}`)) return `${link} leads to ${location || `a ${first.status}`}, not ${tag}'s file`
    }
    const file = await fetch(location, { method: 'HEAD' })
    if (!file.ok) return `${link} answers ${file.status}`
    const size = Number(file.headers.get('content-length'))
    return size === asset.size ? null : `${link} is ${size} bytes, not ${asset.size}`
  } catch (e) {
    return `${link} didn't answer: ${e.message}`
  }
}

// After publishing: every file answers at its link with this release's copy. "latest" can lag a little behind
// publishing, so each is tried for up to a minute.
export async function checkLinks(slug, release, problems) {
  for (const asset of release.assets) {
    let problem
    for (let attempt = 0; attempt < 12; attempt++) {
      if (attempt) await sleep(5000)
      problem = await linkProblem(slug, release.tagName, asset)
      if (!problem) break
    }
    if (problem) problems.push(problem)
  }
}

// Where an app keeps its What's New, first found first: Lumber-Desktop's Mac App Store text, or the app's own README
export const WHATS_NEW_FILES = ['store/README.md', 'README.md']

// This version's What's New: a "**What's New** (1.2.0):" line over a fenced block, in one of WHATS_NEW_FILES. Written
// for the public already, and the same version's news. Its • lines become Markdown bullets; other lines (a paragraph
// of prose) stay as they are. Null when there's none.
export function whatsNew(cwd, version) {
  const heading = `\\*\\*What['’]s New\\*\\*[^\\n]*\\(${version.replace(/\./g, '\\.')}\\):?[ \\t]*\\n+`
  for (const file of WHATS_NEW_FILES) {
    const path = join(cwd, file)
    if (!existsSync(path)) continue
    const block = readFileSync(path, 'utf8').match(new RegExp(`${heading}\`\`\`[^\\n]*\\n([\\s\\S]*?)\\n\`\`\``))?.[1]
    if (!block?.trim()) continue
    return block
      .split('\n')
      .map((line) => line.trim().replace(/^[•*-]\s+/, '- '))
      .join('\n')
      .trim()
  }
  return null
}

const ARCH_LABELS = { x86_64: 'x86_64', amd64: 'x86_64', x64: 'x86_64', arm64: 'arm64', aarch64: 'arm64' }
const MAC_LABELS = { arm64: 'Apple silicon', x64: 'Intel', universal: 'Apple silicon and Intel' }

// What a release page says about its downloads: each platform's files, linked to this release's copies, the Mac's
// chip from the zip electron-updater downloads (Lumber-1.2.0-arm64-mac.zip). Null when there's nothing to link.
export function downloadNotes(names, slug, tag) {
  const link = (name, label = name) => `[${label}](https://github.com/${slug}/releases/download/${tag}/${encodeURIComponent(name)})`
  const arch = (name) => ARCH_LABELS[name.match(/(x86_64|amd64|x64|arm64|aarch64)/)?.[1]] ?? name
  // x86_64 first, as most Linux downloads are
  const byArch = (list) => list.sort((a, b) => (arch(a) === 'x86_64' ? -1 : arch(b) === 'x86_64' ? 1 : a.localeCompare(b))).map((name) => link(name, arch(name)))
  const of = (extension) => names.filter((name) => name.endsWith(extension))
  const mac = MAC_LABELS[names.map((name) => name.match(/-(arm64|x64|universal)-mac\.zip$/)?.[1]).find(Boolean)]
  const lines = []
  if (of('.dmg').length)
    lines.push(
      `- **Mac**${mac ? ` (${mac})` : ''}: ${of('.dmg')
        .map((name) => link(name))
        .join(', ')}`
    )
  if (of('.deb').length) lines.push(`- **Linux**, the deb for Debian, Ubuntu and the distributions built on them: ${byArch(of('.deb')).join(', ')}`)
  if (of('.AppImage').length) lines.push(`- **Linux**, the AppImage for other distributions: ${byArch(of('.AppImage')).join(', ')}`)
  if (of('.rpm').length) lines.push(`- **Linux**, the rpm: ${byArch(of('.rpm')).join(', ')}`)
  return lines.length ? `**Downloads**\n\n${lines.join('\n')}\n\nEach one updates itself to newer releases.` : null
}

// The notes a release gets when none are given: this version's What's New, then its downloads
export function releaseNotes(cwd, { version, slug, tag }, names) {
  const news = whatsNew(cwd, version)
  return [news && `**What's new**\n\n${news}`, downloadNotes(names, slug, tag)].filter(Boolean).join('\n\n')
}

// The draft's update feeds, against its files: each for this version, each file it lists there at the size it
// lists, every other file a feed, a listed file or a listed file's blockmap
function checkDraft(slug, release, version, problems) {
  const dir = mkdtempSync(join(tmpdir(), 'jrd-publish-'))
  try {
    if (release.assets.some((asset) => isFeed(asset.name))) gh(['release', 'download', release.tagName, '--repo', slug, '--pattern', 'latest*.yml', '--dir', dir])
    const feeds = readdirSync(dir)
    if (!feeds.length) problems.push('it has no update feed (latest-mac.yml, latest-linux.yml), so no copy would update to it')
    const assets = new Map(release.assets.map((asset) => [asset.name, asset]))
    const accounted = new Set(feeds)
    for (const name of feeds) {
      const feed = readFeed(join(dir, name))
      if (feed.version !== version) problems.push(`${name} is for ${feed.version ?? 'no version'}, not ${version}`)
      for (const file of feed.files) {
        accounted.add(file.url).add(`${file.url}.blockmap`)
        const asset = assets.get(file.url)
        if (!asset) problems.push(`${name} lists ${file.url}, which isn't on the draft`)
        else if (asset.size !== file.size) problems.push(`${file.url} on the draft is ${asset.size} bytes, not the ${file.size} ${name} lists`)
      }
    }
    for (const asset of release.assets) {
      if (asset.state !== 'uploaded') problems.push(`${asset.name} is ${asset.state}, not uploaded`)
      if (!accounted.has(asset.name)) log.warn(`${asset.name} isn't in any feed. It goes up with the rest.`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// The draft for the target's version, checked once more (its feeds against its files, the version newer than the
// latest release, the names), shown, and published only after a yes or with yes: then every file is asked for at
// its link. offered: at the end of `jrd ship draft`, where a no, or no terminal to ask in, leaves the
// draft for `jrd ship publish`. Returns whether it published.
export async function publishDraft({ productName, version, tag, slug }, { yes = false, offered = false } = {}) {
  let release, previous
  try {
    release = viewRelease(slug, tag)
  } catch {
    fail(`${slug} has no draft for ${tag}. Make one with jrd ship draft.`)
  }
  if (!release.isDraft) fail(`${tag} is already published: ${release.url}`)
  try {
    previous = latestRelease(slug, listReleases(slug))
  } catch (e) {
    fail(`Couldn't read ${slug}'s releases: ${ghError(e)}`)
  }

  const problems = []
  if (previous && compareVersions(version, previous.tagName) <= 0) problems.push(`${version} isn't newer than ${previous.tagName}, the latest release, so no copy would update to it`)
  checkDraft(slug, release, version, problems)
  checkNames(
    release.assets.map((asset) => asset.name),
    version,
    previous,
    problems
  )
  if (problems.length) {
    console.error(problems.map((problem) => `  ${problem}`).join('\n'))
    fail(`The ${tag} draft isn't ready to publish. Nothing changed.`)
  }

  console.log(`\n${release.name} (draft): ${release.url}\n`)
  console.log(release.body?.trim() ? release.body.trim().replace(/^/gm, '  ') : '  (no release notes)')
  console.log()
  printFiles(release.assets)
  console.log()
  if (!release.body?.trim()) log.warn(`It has no release notes. Write them on GitHub first, or: gh release edit ${tag} --repo ${slug} --notes-file <file>`)

  if (!yes) {
    if (!process.stdin.isTTY) {
      if (offered) {
        log.info('Check it, then publish it with jrd ship publish.')
        return false
      }
      fail('publish asks before publishing, and there is no terminal to ask in. Run it in a terminal, or pass --yes once the draft is checked.')
    }
    const ok = await confirm(`Publish ${release.name} for everyone? Every copy of ${productName} will update to it.`, { default: false })
    if (!ok) {
      console.log(offered ? 'Not published: it stays a draft. Publish it later with jrd ship publish.' : 'Not published: it stays a draft.')
      return false
    }
  }

  ghLoud(['release', 'edit', tag, '--repo', slug, '--draft=false', '--latest'])
  const published = viewRelease(slug, tag)
  if (published.isDraft) fail(`GitHub still has ${tag} as a draft: ${published.url}`)

  const spinner = new Spinner({ text: 'Checking the download links' })
  spinner.start()
  const linkProblems = []
  await checkLinks(slug, published, linkProblems)
  if (linkProblems.length) {
    spinner.fail(`${published.name} is published, but not every file answers at its link yet:`)
    console.error(linkProblems.map((problem) => `  ${problem}`).join('\n'))
    process.exitCode = 1
    return true
  }
  spinner.succeed(`Published ${published.name}: ${published.url}. Every file answers at its link.`)
  return true
}
