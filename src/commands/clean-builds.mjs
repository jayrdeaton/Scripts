import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { Color, Program, Spinner } from 'termkit'

const BUILD_TARGETS = ['build', 'dist', 'ios', 'android']

function getDirSize(dirPath) {
  let total = 0
  try {
    for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
      const full = join(dirPath, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        total += getDirSize(full)
      } else {
        try {
          total += statSync(full).size
        } catch {}
      }
    }
  } catch {}
  return total
}

function formatSize(bytes) {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} KB`
  return `${bytes} B`
}

function findTargets(projectDir, targets) {
  return targets
    .map((t) => join(projectDir, t))
    .filter((p) => {
      try {
        return statSync(p).isDirectory()
      } catch {
        return false
      }
    })
}

function resolveProjects(dirs) {
  const projects = []
  for (const dir of dirs) {
    const root = resolve(dir)
    if (existsSync(join(root, 'package.json'))) {
      projects.push({ root, path: root })
    } else {
      let entries
      try {
        entries = readdirSync(root, { withFileTypes: true })
      } catch {
        console.error(Color.red(`Could not read directory: ${root}`))
        process.exit(1)
      }
      for (const e of entries) {
        if (e.isDirectory()) projects.push({ root, path: join(root, e.name) })
      }
    }
  }
  return projects
}

export const command = Program.command('clean-builds')
  .description('Delete build artifacts across repos — dry run by default')
  .variable('[dir...]')
  .option('m', 'modules', null, 'Also delete node_modules')
  .option('D', 'delete', null, 'Actually delete (default is dry run)')
  .action(async (options) => {
    const dirs = options.dir?.length ? options.dir : ['.']
    const targets = [...BUILD_TARGETS]
    if (options.modules) targets.push('node_modules')

    const projects = resolveProjects(dirs)

    const spinner = new Spinner({ text: 'Scanning...' })
    spinner.start()

    const toDelete = []
    for (const { root, path: projectDir } of projects) {
      spinner.message(projectDir.split('/').at(-1))
      for (const targetPath of findTargets(projectDir, targets)) {
        const size = getDirSize(targetPath)
        toDelete.push({ root, path: targetPath, size })
      }
    }

    spinner.stop()

    if (toDelete.length === 0) {
      console.log(Color.green('Nothing to clean.'))
      return
    }

    const totalSize = toDelete.reduce((sum, f) => sum + f.size, 0)

    if (!options.delete) {
      console.log(Color.bold.yellow('\nDry run — pass --delete to remove:\n'))
      for (const { root, path, size } of toDelete) {
        const rel = path.replace(root + '/', '')
        console.log(`  ${Color.red(rel)}  ${Color.faint(formatSize(size))}`)
      }
      console.log(Color.faint(`\n${toDelete.length} folder${toDelete.length !== 1 ? 's' : ''}  ${formatSize(totalSize)} total`))
      return
    }

    const deleteSpinner = new Spinner({ text: 'Deleting...' })
    deleteSpinner.start()

    let deleted = 0
    let freed = 0
    for (const { path, size } of toDelete) {
      deleteSpinner.message(path.split('/').slice(-2).join('/'))
      try {
        rmSync(path, { recursive: true, force: true })
        deleted++
        freed += size
      } catch (err) {
        deleteSpinner.stop()
        console.error(Color.red(`  Failed: ${path} — ${err.message}`))
        deleteSpinner.start()
      }
    }

    deleteSpinner.succeed(`Deleted ${deleted} folder${deleted !== 1 ? 's' : ''},  ${formatSize(freed)} freed`)
  })
