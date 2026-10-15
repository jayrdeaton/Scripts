import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { Color, log } from 'termkit'

// Shared by the `ship` commands. Lives outside src/commands because the CLI
// turns every .mjs file there into a command.

// jrd runs outside `npm run`, so unlike the fleet's old npm-script-based
// wrappers it never gets npm's automatic node_modules/.bin PATH prepending -
// expo (unlike eas-cli, often installed globally) only resolves locally, and
// this makes a local eas-cli install win too.
export function withLocalBin(cwd, extra = {}) {
  return { ...process.env, ...extra, PATH: `${join(cwd, 'node_modules', '.bin')}:${process.env.PATH}` }
}

export function exec(cmd, cwd, extraEnv) {
  console.log(Color.faint(`$ ${cmd}`))
  execSync(cmd, { stdio: 'inherit', cwd, env: withLocalBin(cwd, extraEnv) })
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

export function runVerify(cwd) {
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
