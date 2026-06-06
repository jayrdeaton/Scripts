import { execSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { Color, Program, Spinner } from 'termkit'

function getGitStatus(dir) {
  try {
    const out = execSync('git status --porcelain', {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8'
    })
    const lines = out.split('\n').filter(Boolean)
    const dirty = lines.filter((l) => !l.startsWith('??'))
    const untracked = lines.filter((l) => l.startsWith('??'))

    let unpushed = 0
    try {
      const ahead = execSync('git rev-list --count @{u}..HEAD', {
        cwd: dir,
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8'
      }).trim()
      unpushed = parseInt(ahead, 10) || 0
    } catch {
      // no upstream configured
    }

    return { isRepo: true, dirty, untracked, unpushed }
  } catch {
    return { isRepo: false }
  }
}

export const command = Program.command('repo-status')
  .description('Report dirty and untracked files across repos in a directory')
  .variable('[dir]')
  .action(async (args) => {
    const root = resolve(args.dir ?? '.')

    let entries
    try {
      entries = readdirSync(root)
    } catch {
      console.error(Color.red(`Could not read directory: ${root}`))
      process.exit(1)
    }

    const spinner = new Spinner({ text: 'Checking repos...' })
    spinner.start()

    const repos = entries
      .filter((name) => {
        try {
          return statSync(join(root, name)).isDirectory()
        } catch {
          return false
        }
      })
      .map((name) => {
        spinner.message(name)
        return { name, ...getGitStatus(join(root, name)) }
      })
      .filter((r) => r.isRepo)

    const dirty = repos.filter((r) => r.dirty.length > 0)
    const untracked = repos.filter((r) => r.untracked.length > 0)
    const unpushed = repos.filter((r) => r.unpushed > 0)
    const clean = repos.filter((r) => r.dirty.length === 0 && r.untracked.length === 0 && r.unpushed === 0)

    if (dirty.length === 0 && untracked.length === 0 && unpushed.length === 0) {
      spinner.succeed(`All ${clean.length} repos are clean.`)
      return
    }

    spinner.stop()

    if (dirty.length > 0) {
      console.log(Color.bold.red(`\nDirty (${dirty.length})`))
      for (const repo of dirty) {
        console.log(`  ${Color.red(repo.name)}  ${Color.faint(`${repo.dirty.length} change${repo.dirty.length !== 1 ? 's' : ''}`)}`)
      }
    }

    if (untracked.length > 0) {
      console.log(Color.bold.yellow(`\nUntracked (${untracked.length})`))
      for (const repo of untracked) {
        console.log(`  ${Color.yellow(repo.name)}  ${Color.faint(`${repo.untracked.length} file${repo.untracked.length !== 1 ? 's' : ''}`)}`)
      }
    }

    if (unpushed.length > 0) {
      console.log(Color.bold.cyan(`\nUnpushed (${unpushed.length})`))
      for (const repo of unpushed) {
        console.log(`  ${Color.cyan(repo.name)}  ${Color.faint(`${repo.unpushed} commit${repo.unpushed !== 1 ? 's' : ''} ahead`)}`)
      }
    }

    console.log(Color.faint(`\n${clean.length} of ${repos.length} repos clean`))
  })
