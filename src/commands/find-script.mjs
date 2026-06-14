import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { Color, Program, Spinner } from 'termkit'

function findMatches(pkgPath, command) {
  let pkg
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  } catch {
    return null
  }

  if (!pkg.scripts) return null

  const found = Object.entries(pkg.scripts)
    .filter(([, value]) => value === command)
    .map(([key]) => key)

  return found.length ? { projectName: pkg.name, found } : null
}

export const command = Program.command('find-script', '<command>')
  .description('Find projects whose package.json scripts contain an exact command value')
  .option('d', 'dir', '[dir]', 'Root directory to scan (default: ~/Developer)')
  .action(async (options) => {
    const target = options.command

    const root = resolve(options.dir ?? join(homedir(), 'Developer'))

    let entries
    try {
      entries = readdirSync(root)
    } catch {
      console.error(Color.red(`Could not read directory: ${root}`))
      process.exit(1)
    }

    const spinner = new Spinner({ text: 'Scanning projects...' })
    spinner.start()

    const results = []

    for (const name of entries) {
      const dir = join(root, name)
      try {
        if (!statSync(dir).isDirectory()) continue
      } catch {
        continue
      }

      spinner.message(name)
      const match = findMatches(join(dir, 'package.json'), target)
      if (match) results.push({ dir: name, ...match })
    }

    if (!results.length) {
      spinner.succeed(`No projects found with script: ${target}`)
      return
    }

    spinner.stop()

    console.log(Color.bold(`\nFound ${results.length} project${results.length !== 1 ? 's' : ''}:\n`))

    for (const result of results) {
      const label =
        result.projectName && result.projectName !== result.dir
          ? `${Color.bold(result.dir)} ${Color.faint(`(${result.projectName})`)}`
          : Color.bold(result.dir)

      console.log(`  ${label}`)

      for (const key of result.found) {
        console.log(`    ${Color.cyan(key)}`)
      }
    }

    console.log()
  })
