import { execFileSync, execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { Color, log, Program } from 'termkit'

// jrd runs outside `npm run`, so unlike the fleet's old npm-script-based
// wrappers it never gets npm's automatic node_modules/.bin PATH prepending —
// eas-cli is often installed globally, but this makes a local install win too.
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

export const command = Program.command('update', '<profile>')
  .description('Publish an EAS update for the current directory — bumps otaVersion, then eas update --branch/--environment <profile>')
  .option('f', 'file', '[file]', 'Path to release file for the otaVersion bump (default: src/constants/release.ts)')
  .action(async (options) => {
    const cwd = process.cwd()
    const profile = options.profile
    validateProfile(profile, cwd)

    runVerify(cwd)

    // Captured before bump-ota's own commit, so this is the app's real last
    // commit — not the "otaVersion N -> N+1" commit bump-ota is about to make.
    const message = execSync('git log -1 --pretty=%B', { cwd }).toString().trim()

    exec(`jrd ship bump-ota${options.file ? ` --file ${options.file}` : ''}`, cwd)

    const nonInteractive = profile !== 'development'
    const args = ['update', '--branch', profile, '--environment', profile, '--message', message]
    if (nonInteractive) args.push('--non-interactive')

    const display = args.map((arg) => (/[\s"]/.test(arg) ? JSON.stringify(arg) : arg)).join(' ')
    console.log(Color.faint(`$ eas ${display}`))
    execFileSync('eas', args, { stdio: 'inherit', cwd, env: withLocalBin(cwd) })

    log.succeed('Update published.')
  })
