import { exec as execAsync, execSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { Color, Program, Spinner } from 'termkit'

const exec = promisify(execAsync)

function discoverProjects(root) {
  let entries
  try {
    entries = readdirSync(root)
  } catch {
    console.error(Color.red(`Could not read directory: ${root}`))
    process.exit(1)
  }

  return entries
    .map((name) => join(root, name))
    .filter((dir) => {
      try {
        return statSync(dir).isDirectory() && existsSync(join(dir, 'package.json'))
      } catch {
        return false
      }
    })
}

function runSequential(cmd, dirs) {
  for (const dir of dirs) {
    console.log(Color.bold(dir))
    try {
      execSync(cmd, { cwd: dir, stdio: 'inherit' })
    } catch (err) {
      console.log(Color.faint(err.status != null ? `(exit ${err.status})` : err.message))
    }
    console.log()
  }
}

async function runConcurrent(cmd, dirs, concurrency) {
  let completed = 0

  const spinner = new Spinner({ text: `0/${dirs.length}` })
  spinner.start()

  let i = 0
  async function worker() {
    while (i < dirs.length) {
      const dir = dirs[i++]
      try {
        const { stdout, stderr } = await exec(cmd, { cwd: dir })
        completed++
        spinner.update(`${completed}/${dirs.length}`)
        spinner.log(`${Color.bold(dir)}\n${(stdout + stderr).trim()}\n`)
      } catch (err) {
        completed++
        spinner.update(`${completed}/${dirs.length}`)
        const note = err.code != null ? Color.faint(`(exit ${err.code})`) : Color.faint(err.message)
        const output = ((err.stdout ?? '') + (err.stderr ?? '')).trim()
        spinner.log(`${Color.bold(dir)} ${note}\n${output}\n`)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, dirs.length) }, worker))
  spinner.stop()
}

export const command = Program.command('run')
  .variable('[dirs...] <command>')
  .description('Run a shell command across multiple projects under ~/Developer. Dirs come first, command last, e.g. `run Scripts Lumber "npm outdated"` — so you can arrow-up and just replace the command. Omit dirs to target every project under ~/Developer. Sequential by default, or concurrent with --concurrency.')
  .option('d', 'dir', '[dir]', 'Root directory projects live under — bare names resolve against this (default: ~/Developer)')
  .option('c', 'concurrency', '<n>', 'Run up to n directories at once concurrently (default: sequential, one at a time)')
  .action(async (options) => {
    const cmd = options.command

    const root = resolve(options.dir ?? join(homedir(), 'Developer'))
    const dirs = options.dirs ? options.dirs.map((d) => resolve(root, d)) : discoverProjects(root)

    if (!dirs.length) {
      console.error(Color.red('No project directories found.'))
      process.exit(1)
    }

    const concurrency = options.concurrency ? Math.max(1, parseInt(options.concurrency, 10)) : 1

    console.log(Color.faint(`$ ${cmd}`), Color.faint(`(${dirs.length} project${dirs.length !== 1 ? 's' : ''}, concurrency ${concurrency})`))
    console.log()

    if (concurrency > 1) await runConcurrent(cmd, dirs, concurrency)
    else runSequential(cmd, dirs)

    console.log(Color.green(`Done — ${dirs.length} project${dirs.length !== 1 ? 's' : ''}.`))
  })
