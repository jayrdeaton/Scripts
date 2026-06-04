import { readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import cosmetic from 'cosmetic'
import { command as createCommand } from 'termkit'

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

export const command = createCommand('folder-sizes')
  .description('List folders sorted by size, largest first')
  .variable('[dir]')
  .action(async (args) => {
    const root = resolve(args.dir ?? '.')

    let entries
    try {
      entries = readdirSync(root, { withFileTypes: true })
    } catch {
      console.error(cosmetic.red(`Could not read directory: ${root}`))
      process.exit(1)
    }

    const folders = entries
      .filter((e) => e.isDirectory())
      .map((e) => {
        const size = getDirSize(join(root, e.name))
        return { name: e.name, size }
      })
      .sort((a, b) => b.size - a.size)

    if (folders.length === 0) {
      console.log(cosmetic.faint('No folders found.'))
      return
    }

    const maxName = Math.max(...folders.map((f) => f.name.length))
    const maxSize = Math.max(...folders.map((f) => formatSize(f.size).length))

    for (const folder of folders) {
      const name = folder.name.padEnd(maxName)
      const size = formatSize(folder.size).padStart(maxSize)
      console.log(`  ${cosmetic.cyan(name)}  ${cosmetic.bold(size)}`)
    }
  })
