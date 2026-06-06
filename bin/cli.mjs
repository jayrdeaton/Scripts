#!/usr/bin/env node
import { readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Program } from 'termkit'

const __dir = dirname(fileURLToPath(import.meta.url))
const commandsDir = resolve(__dir, '../src/commands')

// Must be created first so termkit registers this as the root command
const program = Program.command('jrd').description('Personal dev scripts')

const files = readdirSync(commandsDir).filter((f) => f.endsWith('.mjs'))
const mods = await Promise.all(files.map((f) => import(`../src/commands/${f}`)))

program.commands(mods.map((m) => m.command))

try {
  await Program.parse(process.argv)
} catch (err) {
  console.error(err.message)
  process.exit(1)
}
