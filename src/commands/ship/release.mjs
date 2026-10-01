import { execSync } from 'node:child_process'

import { Color, log, Program } from 'termkit'

const BUMPS = ['major', 'minor', 'patch']

function exec(cmd, cwd) {
  console.log(Color.faint(`$ ${cmd}`))
  execSync(cmd, { stdio: 'inherit', cwd })
}

export const command = Program.command('release', '<bump>')
  .description('npm version <bump>, then git push --follow-tags (bump is major, minor, or patch)')
  .action(async (options) => {
    const cwd = process.cwd()
    const bump = options.bump

    if (!BUMPS.includes(bump)) {
      log.fail(`"${bump}" is not a valid bump — use one of: ${BUMPS.join(', ')}`)
      process.exit(1)
    }

    exec(`npm version ${bump}`, cwd)
    exec('git push --follow-tags', cwd)

    log.succeed(`Released ${bump}.`)
  })
