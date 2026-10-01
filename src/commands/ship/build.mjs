import { execSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { Color, log, Program } from 'termkit'

// jrd runs outside `npm run`, so unlike the fleet's old npm-script-based
// wrappers it never gets npm's automatic node_modules/.bin PATH prepending —
// expo (unlike eas-cli, often installed globally) only resolves locally.
function withLocalBin(cwd) {
  return { ...process.env, PATH: `${join(cwd, 'node_modules', '.bin')}:${process.env.PATH}` }
}

function exec(cmd, cwd) {
  console.log(Color.faint(`$ ${cmd}`))
  execSync(cmd, { stdio: 'inherit', cwd, env: withLocalBin(cwd) })
}

function validateProfile(profile, cwd) {
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

function runVerify(cwd) {
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

function formatTimestamp(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
}

export const command = Program.command('build', '<profile>')
  .description('Build an Expo app in the current directory — cloud for preview/production, local prebuild + relocate-artifact for development')
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
