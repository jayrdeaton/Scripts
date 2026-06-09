import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { Color, Program, Spinner } from 'termkit'

const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies']

function findYalcDeps(pkgPath) {
  let pkg
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  } catch {
    return null
  }

  const found = []
  for (const field of DEP_FIELDS) {
    if (!pkg[field]) continue
    for (const [name, version] of Object.entries(pkg[field])) {
      if (typeof version === 'string' && version.startsWith('file:.yalc/')) {
        found.push({ name, version, field })
      }
    }
  }

  return { projectName: pkg.name, found }
}

export const command = Program.command('yalc-check')
  .description('Find projects in a directory that have yalc dependencies')
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

      const hasLock = existsSync(join(dir, 'yalc.lock'))
      const { projectName, found } = findYalcDeps(pkgPath)

      if (found.length || hasLock) {
        results.push({ dir: name, projectName, found, hasLock })
      }
    }

    if (!results.length) {
      spinner.succeed('No projects with yalc dependencies found')
      return
    }

    spinner.stop()

    console.log(Color.bold(`\n${results.length} project${results.length !== 1 ? 's' : ''} with yalc dependencies:\n`))

    for (const result of results) {
      const label =
        result.projectName && result.projectName !== result.dir
          ? `${Color.bold(result.dir)} ${Color.faint(`(${result.projectName})`)}`
          : Color.bold(result.dir)

      const lockNote = result.hasLock && !result.found.length ? Color.yellow('  yalc.lock present') : ''
      console.log(`  ${label}${lockNote}`)

      for (const dep of result.found) {
        const fieldLabel = dep.field === 'dependencies' ? 'dep' : dep.field === 'devDependencies' ? 'dev' : 'peer'
        console.log(`    ${Color.cyan(dep.name)}  ${Color.faint(`${dep.version}  [${fieldLabel}]`)}`)
      }
    }

    console.log()
  })
