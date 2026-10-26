import { execFileSync, execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { Color, log } from 'termkit'

// Shared by the `ship` commands. Lives outside src/commands because the CLI
// turns every .mjs file there into a command.

// jrd runs outside `npm run`, so unlike the fleet's old npm-script-based
// wrappers it never gets npm's automatic node_modules/.bin PATH prepending -
// expo (unlike eas-cli, often installed globally) only resolves locally, and
// this makes a local eas-cli install win too.
export function withLocalBin(cwd) {
  return { ...process.env, PATH: `${join(cwd, 'node_modules', '.bin')}:${process.env.PATH}` }
}

// env adds to the command's environment without being echoed (signing passwords)
export function exec(cmd, cwd, env) {
  console.log(Color.faint(`$ ${cmd}`))
  execSync(cmd, { stdio: 'inherit', cwd, env: { ...withLocalBin(cwd), ...env } })
}

export function validateProfile(profile, cwd) {
  const easJsonPath = join(cwd, 'eas.json')
  if (!existsSync(easJsonPath)) {
    log.fail(`No eas.json found at ${easJsonPath}`)
    process.exit(1)
  }

  const easJson = JSON.parse(readFileSync(easJsonPath, 'utf8'))
  const validProfiles = Object.keys(easJson.build ?? {})

  if (!validProfiles.includes(profile)) {
    log.fail(`"${profile}" is not a build profile in eas.json.`)
    console.error(`Valid profiles: ${validProfiles.join(', ') || '(none defined)'}`)
    process.exit(1)
  }
}

export function requireCleanTree(cwd) {
  if (execSync('git status --porcelain', { cwd }).toString().trim()) {
    log.fail('Working directory is not clean. Commit or stash changes first.')
    process.exit(1)
  }
}

// CI (infinitetoken/Workflows npm-ci.yml), EAS cloud builds and the tag deploys all start with
// npm ci, which refuses a package-lock.json that's out of sync with package.json. --dry-run checks
// just that, in a second or two, without touching node_modules.
export function checkLockfile(cwd) {
  if (!existsSync(join(cwd, 'package-lock.json'))) return

  const cmd = 'npm ci --dry-run --ignore-scripts'
  console.log(Color.faint(`$ ${cmd}`))
  try {
    execSync(cmd, { cwd, stdio: 'pipe', env: withLocalBin(cwd) })
  } catch (err) {
    const stderr = err.stderr?.toString() ?? ''
    // npm's "Missing: x from lock file" / "Invalid: lock file's x does not satisfy y" lines.
    const drift = stderr.split('\n').filter((line) => /^npm error (Missing|Invalid):/.test(line))
    if (drift.length === 0) {
      console.error(stderr.trim())
      log.fail(`${cmd} failed.`)
      process.exit(1)
    }
    console.error(drift.map((line) => line.replace(/^npm error /, '  ')).join('\n'))
    log.fail('package-lock.json is out of sync with package.json, so npm ci in CI would fail. Run npm install and commit the lockfile.')
    process.exit(1)
  }
}

export function runVerify(cwd) {
  checkLockfile(cwd)

  const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
  const scripts = pkg.scripts ?? {}

  if (scripts.verify) {
    exec('npm run verify', cwd)
    return
  }

  log.warn('No "verify" script found, falling back to lint/test/typecheck individually.')

  for (const name of ['lint', 'test', 'typecheck']) {
    if (!scripts[name]) {
      log.warn(`No "${name}" script found, skipping.`)
      continue
    }
    exec(`npm run ${name}`, cwd)
  }
}

// Where `jrd ship build` leaves local build artifacts, and its record of each one. An artifact usually
// gets deleted once it's installed; the record outlives it, so `jrd ship status` can still tell which
// build a phone has and what native code is in it.
export const BUILDS_DIR = join(homedir(), 'Downloads', 'Builds')
export const BUILD_LOG = join(homedir(), '.config', 'jrd', 'builds.json')

// A build artifact's name stamp, 2026-10-26_08-15-00
export function formatTimestamp(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
}

export function readBuildLog() {
  try {
    return JSON.parse(readFileSync(BUILD_LOG, 'utf8'))
  } catch {
    return []
  }
}

export function recordBuild(entry) {
  mkdirSync(dirname(BUILD_LOG), { recursive: true })
  writeFileSync(BUILD_LOG, `${JSON.stringify([...readBuildLog(), entry], null, 2)}\n`)
}

// What an iOS app bundle says about itself: version, build number, the update channel (its EAS
// profile's) and the native fingerprint expo-updates embedded at build time. readEntry(path) returns
// a file inside the .app as a Buffer, or null.
export function appBundleInfo(readEntry) {
  const plist = (entry) => {
    const data = readEntry(entry)
    if (!data?.length) return {}
    try {
      return JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', '-'], { input: data, stdio: ['pipe', 'pipe', 'ignore'] }).toString())
    } catch {
      return {}
    }
  }
  const info = plist('Info.plist')
  return {
    version: info.CFBundleShortVersionString,
    build: info.CFBundleVersion,
    channel: plist('Expo.plist').EXUpdatesRequestHeaders?.['expo-channel-name'],
    fingerprint: readEntry('EXUpdates.bundle/fingerprint')?.toString().trim() || null
  }
}

// appBundleInfo for an .ipa, or null when it isn't one.
export function ipaInfo(path) {
  const unzip = (...args) => {
    try {
      return execFileSync('unzip', args, { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 })
    } catch {
      return null
    }
  }
  // macOS's unzip has no -W, so a Payload/*.app/ pattern would also match an embedded app's files:
  // find the app's own folder first.
  const app = unzip('-Z1', path)
    ?.toString()
    .match(/^Payload\/[^/]+\.app\//m)?.[0]
  return app ? appBundleInfo((entry) => unzip('-p', path, app + entry)) : null
}
