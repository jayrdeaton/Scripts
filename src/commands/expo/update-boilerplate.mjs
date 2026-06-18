import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { Color, log, Program } from 'termkit'

const BOILERPLATE_REPO = 'git@github.com:jayrdeaton/Expo-Boilerplate.git'
const BOILERPLATE_DIR = join(homedir(), 'Developer', 'Expo-Boilerplate')

function exec(cmd, opts = {}) {
  console.log(Color.faint(`$ ${cmd}`))
  execSync(cmd, { stdio: 'inherit', ...opts })
}

export const command = Program.command('update-boilerplate')
  .description('Update Expo boilerplate — clones if absent, updates deps, commits, and pushes')
  .action(async () => {
    if (existsSync(BOILERPLATE_DIR)) {
      log.info('Boilerplate found, pulling latest...')
      exec('git pull', { cwd: BOILERPLATE_DIR })
    } else {
      log.info('Cloning boilerplate...')
      exec(`git clone ${BOILERPLATE_REPO} "${BOILERPLATE_DIR}"`)
    }

    log.info('Updating dependencies...')
    exec('jrd npm update', { cwd: BOILERPLATE_DIR })

    const status = execSync('git status --porcelain', { cwd: BOILERPLATE_DIR }).toString().trim()

    if (!status) {
      log.succeed('Nothing to commit — boilerplate is already up to date.')
      return
    }

    log.info('Running lint fix...')
    exec('npm run fix', { cwd: BOILERPLATE_DIR })

    log.info('Running type check...')
    exec('npm run check', { cwd: BOILERPLATE_DIR })

    log.info('Running tests...')
    exec('npm test', { cwd: BOILERPLATE_DIR })

    log.info('Committing and pushing...')
    exec('git add -A', { cwd: BOILERPLATE_DIR })
    exec('git commit -m "Update dependencies"', { cwd: BOILERPLATE_DIR })
    exec('git push', { cwd: BOILERPLATE_DIR })

    log.succeed('Boilerplate updated.')
  })
