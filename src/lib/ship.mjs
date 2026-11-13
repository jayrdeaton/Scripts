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

// unzip's output as a Buffer, or null when it fails (no such archive or entry)
function unzip(...args) {
  try {
    return execFileSync('unzip', args, { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 })
  } catch {
    return null
  }
}

// appBundleInfo for an .ipa, or null when it isn't one.
export function ipaInfo(path) {
  // macOS's unzip has no -W, so a Payload/*.app/ pattern would also match an embedded app's files:
  // find the app's own folder first.
  const app = unzip('-Z1', path)
    ?.toString()
    .match(/^Payload\/[^/]+\.app\//m)?.[0]
  return app ? appBundleInfo((entry) => unzip('-p', path, app + entry)) : null
}

// A protobuf message's fields in order, as [number, value]: a varint as a Number, a length-delimited
// field (a string or a message) as a Buffer.
function protoFields(buf) {
  const fields = []
  let i = 0
  const varint = () => {
    let value = 0
    for (let shift = 0; ; shift += 7) {
      const byte = buf[i++] ?? 0
      value += (byte & 0x7f) * 2 ** shift
      if (!(byte & 0x80)) return value
    }
  }
  while (i < buf.length) {
    const key = varint()
    const type = key % 8
    const field = Math.floor(key / 8)
    if (type === 0) fields.push([field, varint()])
    else if (type === 2) {
      const length = varint()
      fields.push([field, buf.subarray(i, i + length)])
      i += length
    } else if (type === 1) i += 8
    else if (type === 5) i += 4
    else throw new Error(`Unknown protobuf wire type ${type}`)
  }
  return fields
}

// An .aab's manifest (base/manifest/AndroidManifest.xml) is aapt2's protobuf XML, an XmlElement from
// its Resources.proto: name 3, attribute 4 (an XmlAttribute: name 2, value 3, the value as written,
// which aapt2 keeps beside the compiled one), child 5 (an XmlNode, element 1 unless it's text).
function protoXmlElement(buf) {
  const element = { name: '', attributes: {}, children: [] }
  for (const [field, value] of protoFields(buf)) {
    if (field === 3) element.name = value.toString()
    else if (field === 4) {
      const attribute = Object.fromEntries(protoFields(value))
      if (attribute[2]) element.attributes[attribute[2].toString()] = attribute[3]?.toString() ?? ''
    } else if (field === 5) {
      const node = Object.fromEntries(protoFields(value))
      if (node[1]) element.children.push(protoXmlElement(node[1]))
    }
  }
  return element
}

// A binary XML string pool (ResStringPool): offsets after the header, then each string, UTF-8 (two
// lengths, characters then bytes) or UTF-16 (a length in units), a length taking a second byte or
// unit when its top bit is set.
function stringPool(chunk) {
  const count = chunk.readUInt32LE(8)
  const utf8 = (chunk.readUInt32LE(16) & 0x100) !== 0
  const start = chunk.readUInt32LE(20)
  return Array.from({ length: count }, (_, n) => {
    let at = start + chunk.readUInt32LE(chunk.readUInt16LE(2) + n * 4)
    if (utf8) {
      const length = () => {
        const byte = chunk[at++]
        return byte & 0x80 ? ((byte & 0x7f) << 8) | chunk[at++] : byte
      }
      length()
      const bytes = length()
      return chunk.toString('utf8', at, at + bytes)
    }
    const unit = () => {
      const value = chunk.readUInt16LE(at)
      at += 2
      return value
    }
    const first = unit()
    const units = first & 0x8000 ? ((first & 0x7fff) << 16) | unit() : first
    return chunk.toString('utf16le', at, at + units * 2)
  })
}

// An .apk's manifest is Android's binary XML (ResXMLTree): a string pool, then a flat run of chunks,
// each starting with its type and its size. A start element (0x0102) lists its attributes, 20 bytes
// each: name at 4, the value as written at 8 (or none), then the compiled value's type at 15 and data
// at 16 (an integer like versionCode is only compiled). An end element (0x0103) closes the newest.
function binaryXmlElement(buf) {
  let strings = []
  const stack = [{ children: [] }]
  let at = buf.readUInt16LE(2)
  while (at + 8 <= buf.length) {
    const type = buf.readUInt16LE(at)
    const size = buf.readUInt32LE(at + 4)
    if (size < 8) break
    if (type === 0x0001) strings = stringPool(buf.subarray(at, at + size))
    else if (type === 0x0102) {
      const element = { name: strings[buf.readUInt32LE(at + 20)], attributes: {}, children: [] }
      const first = at + 16 + buf.readUInt16LE(at + 24)
      const attributeSize = buf.readUInt16LE(at + 26)
      for (let n = 0; n < buf.readUInt16LE(at + 28); n++) {
        const a = first + n * attributeSize
        const raw = buf.readUInt32LE(a + 8)
        const data = buf.readInt32LE(a + 16)
        const valueType = buf[a + 15]
        element.attributes[strings[buf.readUInt32LE(a + 4)]] = raw !== 0xffffffff ? strings[raw] : valueType === 0x03 ? strings[data] : valueType === 0x12 ? String(data !== 0) : String(data)
      }
      stack.at(-1).children.push(element)
      stack.push(element)
    } else if (type === 0x0103 && stack.length > 1) stack.pop()
    at += size
  }
  return stack[0].children[0] ?? null
}

// What an Android build says about itself: its package, version (versionName), build number
// (versionCode, set by EAS's remote version counter rather than app.json), the update channel (its EAS
// profile's) and the native fingerprint expo-updates embedded at build time. Read from the archive
// itself, so it needs no Android SDK tools: an .aab keeps its manifest and assets under base/, an .apk
// at the top. null when it isn't one.
export function androidInfo(path) {
  const bundle = path.endsWith('.aab')
  const root = bundle ? 'base/' : ''
  const data = unzip('-p', path, bundle ? 'base/manifest/AndroidManifest.xml' : 'AndroidManifest.xml')
  if (!data?.length) return null
  let manifest
  try {
    manifest = bundle ? protoXmlElement(Object.fromEntries(protoFields(data))[1]) : binaryXmlElement(data)
  } catch {
    return null
  }
  if (manifest?.name !== 'manifest' || !manifest.attributes.versionCode) return null

  const metaData = manifest.children.find((child) => child.name === 'application')?.children.filter((child) => child.name === 'meta-data') ?? []
  const headers = metaData.find((meta) => meta.attributes.name === 'expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY')?.attributes.value
  let channel
  try {
    channel = headers ? JSON.parse(headers)['expo-channel-name'] : undefined
  } catch {
    channel = undefined
  }
  return {
    package: manifest.attributes.package,
    version: manifest.attributes.versionName,
    build: manifest.attributes.versionCode,
    channel,
    fingerprint: unzip('-p', path, `${root}assets/fingerprint`)?.toString().trim() || null
  }
}
