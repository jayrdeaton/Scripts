import { execSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

import { log, Program } from 'termkit'

import { buildElectron, isElectronProject } from '../../lib/electron.mjs'
import { BUILDS_DIR, exec, formatTimestamp, ipaInfo, recordBuild, runVerify, validateProfile } from '../../lib/ship.mjs'

// eas-cli asks about export compliance on an iOS build whose app.json has no ios.infoPlist.ITSAppUsesNonExemptEncryption,
// and its questions read backwards: Yes to "iOS app only uses standard/exempt encryption?" writes false into app.json before
// the upload, so the build claims exempt encryption. An app that encrypts user data itself (Lumber) leaves the key out on
// purpose, since true needs the ITSEncryptionExportComplianceCode Apple issues for approved documentation or the upload
// is refused (ITMS-90592), and answers No, then Yes, so App Store Connect asks on the build instead. Lumber's build 16 went
// out with false that way (2026-11-01). The key's value, or null for a project with no iOS app in app.json.
function encryptionKey(cwd) {
  const path = join(cwd, 'app.json')
  if (!existsSync(path)) return null
  const { expo } = JSON.parse(readFileSync(path, 'utf8'))
  return expo?.ios ? { value: expo.ios.infoPlist?.ITSAppUsesNonExemptEncryption } : null
}

function remindEncryption(before) {
  if (!before || before.value !== undefined) return
  log.warn('app.json has no ITSAppUsesNonExemptEncryption, so an iOS build asks about encryption. If the app encrypts user data itself: No to "iOS app only uses standard/exempt encryption?", then Yes to "Are you sure your app uses non-exempt encryption?" (its annual report warning is out of date). Yes to the first writes false into app.json and into this build.')
}

function checkEncryption(cwd, before) {
  if (!before || before.value !== undefined) return
  const after = encryptionKey(cwd)
  if (after?.value === undefined) return
  log.fail(`eas-cli wrote ITSAppUsesNonExemptEncryption: ${after.value} into app.json, and this build carries it. If the app encrypts user data itself, don't submit it: git checkout app.json, then build again answering No, then Yes.`)
  process.exitCode = 1
}

export const command = Program.command('build', '<profile>')
  .description('Build the app in the current directory. Expo: development (or any profile with --local) builds locally and moves the artifact to ~/Downloads/Builds, other profiles build in the EAS cloud. Electron (an electron-builder.yml): development, mas-dev or mas (Mac App Store: mas-dev to run sandboxed here, mas to upload), or direct (the direct download, signed with Developer ID and notarized), each checked once built, mas then saved to ~/Downloads/Builds and opened in Transporter, direct saved there as a DMG')
  .option('l', 'local', null, 'Build on this Mac instead of the EAS cloud (development always builds locally; Expo only)')
  .action(async (options) => {
    const cwd = process.cwd()
    const profile = options.profile
    if (isElectronProject(cwd)) {
      buildElectron(cwd, profile)
      return
    }
    validateProfile(profile, cwd)

    runVerify(cwd)

    const encryption = encryptionKey(cwd)
    remindEncryption(encryption)

    if (profile !== 'development' && !options.local) {
      exec(`eas build --profile ${profile}`, cwd)
      checkEncryption(cwd, encryption)
      return
    }

    const { expo } = JSON.parse(readFileSync(join(cwd, 'app.json'), 'utf8'))
    const projectName = expo.name
    // Before prebuild, whose generated folders would count as changes in a repo that doesn't ignore them.
    const sha = execSync('git rev-parse HEAD', { cwd }).toString().trim()
    const dirty = execSync('git status --porcelain', { cwd }).toString().trim() !== ''

    exec('expo prebuild --clean', cwd)
    exec(`eas build --profile ${profile} --local`, cwd)
    checkEncryption(cwd, encryption)

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

    mkdirSync(BUILDS_DIR, { recursive: true })

    const destPath = join(BUILDS_DIR, `${projectName}-${formatTimestamp(new Date(artifact.epoch))}.${artifact.ext}`)
    copyFileSync(join(cwd, artifact.name), destPath)
    unlinkSync(join(cwd, artifact.name))

    // Kept after the .ipa is installed and deleted: `jrd ship status` matches a phone's version and
    // build number to it to know what code and native fingerprint the phone is running.
    const info = artifact.ext === 'ipa' ? ipaInfo(destPath) : null
    if (info) recordBuild({ app: projectName, bundleId: expo.ios?.bundleIdentifier, profile, ...info, sha, dirty, file: destPath, createdAt: artifact.epoch })

    log.succeed(`Build saved to ${destPath}`)
  })
