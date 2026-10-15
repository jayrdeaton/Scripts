import { copyFileSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { log, Program } from 'termkit'

import { exec, runVerify, validateProfile } from '../../lib/ship.mjs'

function formatTimestamp(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
}

export const command = Program.command('build', '<profile>')
  .description('Build an Expo app in the current directory: development (or any profile with --local) builds locally and moves the artifact to ~/Downloads/Builds, other profiles build in the EAS cloud')
  .option('l', 'local', null, 'Build on this Mac instead of the EAS cloud (development always builds locally)')
  .action(async (options) => {
    const cwd = process.cwd()
    const profile = options.profile
    validateProfile(profile, cwd)

    runVerify(cwd)

    if (profile !== 'development' && !options.local) {
      exec(`eas build --profile ${profile}`, cwd)
      return
    }

    const { expo } = JSON.parse(readFileSync(join(cwd, 'app.json'), 'utf8'))
    const projectName = expo.name

    exec('expo prebuild --clean', cwd)
    exec(`eas build --profile ${profile} --local`, cwd)

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
