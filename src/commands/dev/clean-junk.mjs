import { readdirSync, rmSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'

import { Color, Program, Spinner } from 'termkit'

function prompt(question) {
  return new Promise((res) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, (answer) => {
      rl.close()
      res(answer)
    })
  })
}

function getItems(dir, recursive) {
  const items = []
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      items.push(full)
      if (recursive && entry.isDirectory()) items.push(...getItems(full, recursive))
    }
  } catch {}
  return items
}

function getItemSize(itemPath) {
  let total = 0
  try {
    const stat = statSync(itemPath)
    if (!stat.isDirectory()) return stat.size
    for (const entry of readdirSync(itemPath, { withFileTypes: true })) {
      const full = join(itemPath, entry.name)
      if (entry.isSymbolicLink()) continue
      total += entry.isDirectory() ? getItemSize(full) : statSync(full).size
    }
  } catch {}
  return total
}

export const command = Program.command('clean-junk')
  .description('Delete files and directories matching given criteria')
  .variable('[dir]')
  .option('i', 'includes', '<str>', 'Delete items whose name includes this string')
  .option('e', 'excludes', '<str>', 'Delete items whose name excludes this string')
  .option(null, 'extension', '<str>', 'Delete files with this extension')
  .option('s', 'size', '<mb>', 'Delete items under this size in MB')
  .option('r', 'recursive', null, 'Scan directories recursively')
  .option('f', 'force', null, 'Skip confirmation')
  .option('v', 'verbose', null, 'Show matched items before deleting')
  .action(async (options) => {
    let { extension, force, verbose } = options
    const dir = resolve(options.dir ?? '.')
    const { includes, excludes, recursive, size } = options

    if (extension && !extension.startsWith('.')) extension = `.${extension}`

    if (!includes && !excludes && !extension && !size) {
      console.error(Color.red('Requires at least one filter: --includes, --excludes, --extension, or --size'))
      process.exit(1)
    }

    const spinner = new Spinner({ text: 'Scanning...' })
    spinner.start()
    const items = getItems(dir, recursive)
    spinner.stop()

    const sizeBytes = size ? size * 1_048_576 : null
    const targets = []

    const filterSpinner = new Spinner({ text: 'Filtering...' })
    filterSpinner.start()

    for (const item of items) {
      const name = basename(item)
      let match = true
      if (includes && !name.includes(includes)) match = false
      if (excludes && name.includes(excludes)) match = false
      if (extension && extname(item) !== extension) match = false
      if (sizeBytes !== null && getItemSize(item) > sizeBytes) match = false
      if (match) targets.push(item)
    }

    filterSpinner.stop()

    if (targets.length === 0) {
      console.log(Color.green('No junk items found.'))
      return
    }

    if (verbose) {
      for (const item of targets) console.log(`  ${item}`)
    }

    if (!force) {
      const answer = await prompt(`Delete ${targets.length} item${targets.length !== 1 ? 's' : ''}? (Y/n) `)
      if (answer.toLowerCase() !== 'y') {
        console.log('Aborted.')
        return
      }
    }

    const deleteSpinner = new Spinner({ text: 'Deleting...' })
    deleteSpinner.start()

    let deleted = 0
    for (const item of targets) {
      deleteSpinner.update(basename(item))
      try {
        rmSync(item, { recursive: true, force: true })
        deleted++
      } catch (err) {
        deleteSpinner.log(`  Failed: ${item} — ${err.message}`, Color.red('✗'))
      }
    }

    deleteSpinner.succeed(`Deleted ${deleted} item${deleted !== 1 ? 's' : ''}`)
  })
