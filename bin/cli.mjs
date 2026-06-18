#!/usr/bin/env node
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { Program, Shell, configure } from 'termkit'

configure({ color: '#8B5CF6' })

const __dir = dirname(fileURLToPath(import.meta.url))
const commandsDir = resolve(__dir, '../src/commands')

const program = Program.command('jrd').description('Personal dev scripts')

const load = async (file) => (await import(pathToFileURL(file).href)).command

// Build the command tree from the directory layout:
//  - a `.mjs` file is a leaf command (exports `command`)
//  - a directory is a namespace; its `index.mjs` defines the parent command
//    (a description-only group, or a parent that also has its own action), and
//    its remaining entries become subcommands — nested to any depth.
async function build(dir) {
  const commands = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'index.mjs') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      const indexPath = join(full, 'index.mjs')
      const parent = existsSync(indexPath) ? await load(indexPath) : Program.command(entry.name)
      parent.commands(await build(full))
      commands.push(parent)
    } else if (entry.name.endsWith('.mjs')) {
      commands.push(await load(full))
    }
  }
  return commands
}

program.commands(await build(commandsDir))

try {
  if (process.argv.length <= 2) {
    await new Shell(program, { mode: 'free', prompt: 'jrd' }).run()
  } else {
    // Parse from the root command directly — Program.parse() relies on a global
    // that points at the last-created command, not this one.
    await program.parse(process.argv)
  }
} catch (err) {
  console.error(err.message)
  process.exit(1)
}
