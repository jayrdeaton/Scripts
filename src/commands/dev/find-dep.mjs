import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { Color, Program, Spinner } from 'termkit'

const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies']

function findMatches(pkgPath, targets) {
  let pkg
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  } catch {
    return null
  }

  const found = []
  for (const field of DEP_FIELDS) {
    if (!pkg[field]) continue
    for (const target of targets) {
      if (pkg[field][target] !== undefined) {
        found.push({ name: target, version: pkg[field][target], field })
      }
    }
  }

  return found.length ? { projectName: pkg.name, found } : null
}

export const command = Program.command('find-dep', '[deps...]')
  .description('Find projects in a directory that use any of the given dependencies')
  .option('d', 'dir', '[dir]', 'Root directory to scan (default: ~/Developer)')
  .action(async (options) => {
    const targets = options.deps ?? []

    if (!targets.length) {
      console.error(Color.red('Provide at least one dependency name.'))
      process.exit(1)
    }

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

      spinner.update(name)
      const pkgPath = join(dir, 'package.json')
      const match = findMatches(pkgPath, targets)
      if (match) results.push({ dir: name, ...match })
    }

    if (!results.length) {
      spinner.succeed(`No projects found using: ${targets.join(', ')}`)
      return
    }

    spinner.stop()

    console.log(Color.bold(`\nFound ${results.length} project${results.length !== 1 ? 's' : ''}:\n`))

    for (const result of results) {
      const label = result.projectName && result.projectName !== result.dir ? `${Color.bold(result.dir)} ${Color.faint(`(${result.projectName})`)}` : Color.bold(result.dir)

      console.log(`  ${label}`)

      for (const dep of result.found) {
        const fieldLabel = dep.field === 'dependencies' ? 'dep' : dep.field === 'devDependencies' ? 'dev' : 'peer'
        console.log(`    ${Color.cyan(dep.name)}  ${Color.faint(`${dep.version}  [${fieldLabel}]`)}`)
      }
    }

    console.log()
  })
