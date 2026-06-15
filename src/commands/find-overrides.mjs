import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { Color, Program, Spinner } from 'termkit'

function findOverrides(pkgPath) {
  let pkg
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  } catch {
    return null
  }

  const overrides = pkg.overrides ?? {}
  const entries = Object.entries(overrides)

  return { projectName: pkg.name, entries }
}

export const command = Program.command('find-overrides')
  .description('Find projects in a directory that have overrides in their package.json')
  .option('d', 'dir', '[dir]', 'Root directory to scan (default: ~/Developer)')
  .action(async (options) => {
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

      const pkgPath = join(dir, 'package.json')
      if (!existsSync(pkgPath)) continue

      const { projectName, entries: overrideEntries } = findOverrides(pkgPath)

      if (overrideEntries.length) {
        results.push({ dir: name, projectName, overrideEntries })
      }
    }

    if (!results.length) {
      spinner.succeed('No projects with overrides found')
      return
    }

    spinner.stop()

    console.log(Color.bold(`\n${results.length} project${results.length !== 1 ? 's' : ''} with overrides:\n`))

    for (const result of results) {
      const label =
        result.projectName && result.projectName !== result.dir
          ? `${Color.bold(result.dir)} ${Color.faint(`(${result.projectName})`)}`
          : Color.bold(result.dir)

      console.log(`  ${label}`)

      for (const [pkg, version] of result.overrideEntries) {
        console.log(`    ${Color.cyan(pkg)}  ${Color.faint(typeof version === 'string' ? version : JSON.stringify(version))}`)
      }
    }

    console.log()
  })
