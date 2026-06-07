import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { Color, Program, Spinner } from 'termkit'

function loadProject(pkgPath) {
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    return { name: pkg.name, scripts: pkg.scripts ?? {} }
  } catch {
    return null
  }
}

function mostCommon(values) {
  const freq = {}
  for (const v of values) freq[v] = (freq[v] ?? 0) + 1
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]
}

export const command = Program.command('check-scripts', '[scripts...]')
  .description('Compare package.json scripts across projects for consistency')
  .option('d', 'dir', '[dir]', 'Root directory to scan (default: ~/Developer)')
  .option('r', 'ref', '[ref]', 'Reference project name to compare against')
  .option('a', 'all', null, 'Show all scripts, including matching ones')
  .option('f', 'flat', null, 'Show one line per project instead of grouping by value')
  .action(async (options) => {
    const root = resolve(options.dir ?? join(homedir(), 'Developer'))
    const filterScripts = options.scripts ?? []

    let entries
    try {
      entries = readdirSync(root)
    } catch {
      console.error(Color.red(`Could not read directory: ${root}`))
      process.exit(1)
    }

    const spinner = new Spinner({ text: 'Scanning projects...' })
    spinner.start()

    const projects = []

    for (const entry of entries) {
      const dir = join(root, entry)
      try {
        if (!statSync(dir).isDirectory()) continue
      } catch {
        continue
      }
      spinner.message(entry)
      const result = loadProject(join(dir, 'package.json'))
      if (result) projects.push({ dir: entry, ...result })
    }

    spinner.stop()

    if (!projects.length) {
      console.log(Color.yellow('No projects with package.json found.'))
      return
    }

    let refProject = null
    if (options.ref) {
      refProject = projects.find((p) => p.dir === options.ref || p.name === options.ref)
      if (!refProject) {
        console.error(Color.red(`Reference project not found: ${options.ref}`))
        process.exit(1)
      }
    }

    const allScriptNames = new Set()
    for (const p of projects) {
      for (const key of Object.keys(p.scripts)) {
        if (!filterScripts.length || filterScripts.includes(key)) {
          allScriptNames.add(key)
        }
      }
    }

    let printed = 0

    for (const scriptName of [...allScriptNames].sort()) {
      const withScript = projects.filter((p) => p.scripts[scriptName] !== undefined)
      if (withScript.length < 2 && !refProject) continue

      const expectedValue = refProject ? refProject.scripts[scriptName] : mostCommon(withScript.map((p) => p.scripts[scriptName]))

      const allMatch = withScript.every((p) => p.scripts[scriptName] === expectedValue) && (!refProject || projects.every((p) => p.scripts[scriptName] !== undefined))

      if (!options.all && allMatch) continue

      console.log(`\n${Color.bold(scriptName)}`)

      if (options.flat) {
        // Per-project lines
        const allRelevant = refProject ? projects : withScript
        for (const p of allRelevant) {
          const value = p.scripts[scriptName]
          const missing = value === undefined
          const matches = !missing && value === expectedValue
          const icon = matches ? Color.green('✓') : Color.red('✗')
          const label = matches ? Color.faint(p.dir) : Color.bold(p.dir)
          const display = missing ? Color.faint('(missing)') : Color.faint(value)
          console.log(`  ${icon} ${label}  ${display}`)
        }
      } else {
        // Grouped by value
        const groups = new Map()
        const allRelevant = refProject ? projects : withScript

        for (const p of allRelevant) {
          const value = p.scripts[scriptName] ?? null
          if (!groups.has(value)) groups.set(value, [])
          groups.get(value).push(p.dir)
        }

        // Sort: expected value first, then others, missing last
        const sorted = [...groups.entries()].sort(([a], [b]) => {
          if (a === expectedValue) return -1
          if (b === expectedValue) return 1
          if (a === null) return 1
          if (b === null) return -1
          return 0
        })

        for (const [value, dirs] of sorted) {
          const matches = value === expectedValue
          const icon = matches ? Color.green('✓') : Color.red('✗')
          const label = matches ? Color.faint(dirs.join(', ')) : Color.bold(dirs.join(', '))
          const display = value === null ? Color.faint('(missing)') : Color.faint(value)
          console.log(`  ${icon} ${label}  ${display}`)
        }
      }

      printed++
    }

    if (!printed) {
      console.log(Color.green('\nAll scripts are consistent across projects.'))
    } else {
      console.log()
    }
  })
