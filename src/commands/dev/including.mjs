import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { Color, Program, Spinner } from 'termkit'

export const command = Program.command('including', '[file]')
  .description('Find projects in a directory that contain a given file')
  .option('d', 'dir', '[dir]', 'Root directory to scan (default: ~/Developer)')
  .action(async (options) => {
    const file = options.file

    if (!file) {
      console.error(Color.red('Provide a file name to search for.'))
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

    const found = []

    for (const name of entries) {
      const dir = join(root, name)
      try {
        if (!statSync(dir).isDirectory()) continue
      } catch {
        continue
      }

      spinner.update(name)

      if (!existsSync(join(dir, 'package.json'))) continue
      if (existsSync(join(dir, file))) found.push(name)
    }

    if (!found.length) {
      spinner.succeed(`No projects found containing: ${file}`)
      return
    }

    spinner.stop()

    console.log(Color.bold(`\n${found.length} project${found.length !== 1 ? 's' : ''} containing ${Color.cyan(file)}:\n`))

    for (const name of found) {
      console.log(`  ${Color.green(name)}`)
    }

    console.log()
  })
