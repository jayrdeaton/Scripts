import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { log, Program } from 'termkit'

import { exec, runVerify, validateProfile } from '../../lib/ship.mjs'

function formatTimestamp(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
}

// TEMPORARY: delete this block (and its call below) once every app is on Expo
// SDK 58. An app LINKED against the iOS 27 SDK aborts at launch on iOS 27
// unless it adopts the UIScene life cycle, which SDK 57's native template
// doesn't wire (SDK 58's does). One built with Xcode 26 runs fine on iOS 27,
// and each app's eas.json already pins its cloud builds to an Xcode 26 image,
// so a local build of an older app is pointed at an Xcode 26 install in
// /Applications whenever the default Xcode is 27 or newer. It turns itself off
// per app: an app on SDK 58 builds with the default Xcode again.
const SCENE_LIFECYCLE_EXPO_MAJOR = 58

function majorOf(version) {
  return Number(String(version ?? '').match(/\d+/)?.[0])
}

function expoMajor(cwd) {
  try {
    return majorOf(JSON.parse(readFileSync(join(cwd, 'node_modules', 'expo', 'package.json'), 'utf8')).version)
  } catch {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
    return majorOf(pkg.dependencies?.expo)
  }
}

function defaultXcodeMajor() {
  try {
    return majorOf(execFileSync('xcodebuild', ['-version'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString())
  } catch {
    return NaN
  }
}

function xcodeVersion(app) {
  try {
    return execFileSync('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', join(app, 'Contents', 'Info.plist')], { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return null
  }
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff) return diff
  }
  return 0
}

function xcode26Env(cwd) {
  if (process.env.DEVELOPER_DIR) return {}

  const expo = expoMajor(cwd)
  if (!(expo < SCENE_LIFECYCLE_EXPO_MAJOR)) return {}

  const current = defaultXcodeMajor()
  if (!(current >= 27)) return {}

  const xcode26 = readdirSync('/Applications')
    .filter((name) => /^Xcode.*\.app$/.test(name))
    .map((name) => ({ path: join('/Applications', name), version: xcodeVersion(join('/Applications', name)) }))
    .filter(({ version }) => version && majorOf(version) === 26)
    .sort((a, b) => compareVersions(b.version, a.version))[0]

  if (!xcode26) {
    log.warn(`Expo SDK ${expo} with Xcode ${current}: an iOS build made now crashes at launch on iOS 27. Install Xcode 26 in /Applications to avoid that.`)
    return {}
  }

  log.info(`Expo SDK ${expo}: building with Xcode ${xcode26.version} (${xcode26.path}) so the app runs on iOS 27.`)
  return { DEVELOPER_DIR: join(xcode26.path, 'Contents', 'Developer') }
}

export const command = Program.command('build', '<profile>')
  .description('Build an Expo app in the current directory: cloud for preview/production, local prebuild + relocate-artifact for development')
  .action(async (options) => {
    const cwd = process.cwd()
    const profile = options.profile
    validateProfile(profile, cwd)

    runVerify(cwd)

    if (profile !== 'development') {
      exec(`eas build --profile ${profile}`, cwd)
      return
    }

    const { expo } = JSON.parse(readFileSync(join(cwd, 'app.json'), 'utf8'))
    const projectName = expo.name
    const xcodeEnv = xcode26Env(cwd)

    exec('expo prebuild --clean', cwd, xcodeEnv)
    exec(`eas build --profile ${profile} --local`, cwd, xcodeEnv)

    const artifactPattern = /^build-(\d+)\.(ipa|apk|aab|tar\.gz)$/
    const candidates = readdirSync(cwd)
      .map((name) => ({ name, match: name.match(artifactPattern) }))
      .filter(({ match }) => match)
      .map(({ name, match }) => ({ name, epoch: Number(match[1]), ext: match[2] }))

    if (candidates.length === 0) {
      log.fail('Could not find a build-<timestamp> artifact produced by eas build --local.')
      process.exit(1)
    }

    const artifact = candidates.reduce((a, b) => (b.epoch > a.epoch ? b : a))

    const buildsDir = join(homedir(), 'Downloads', 'Builds')
    mkdirSync(buildsDir, { recursive: true })

    const destPath = join(buildsDir, `${projectName}-${formatTimestamp(new Date(artifact.epoch))}.${artifact.ext}`)
    copyFileSync(join(cwd, artifact.name), destPath)
    unlinkSync(join(cwd, artifact.name))

    log.succeed(`Build saved to ${destPath}`)
  })
