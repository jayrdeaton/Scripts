import { readdirSync, renameSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'

import cosmetic from 'cosmetic'
import { command as createCommand } from 'termkit'

export const command = createCommand('rename-season')
  .description('Rename files in a directory to SxEE format for TV library pickup')
  .variable('<season> [dir]')
  .action(async (args) => {
    const { season, dir = '.' } = args

    let files
    try {
      files = readdirSync(dir)
    } catch {
      console.error(cosmetic.red(`Could not read directory: ${dir}`))
      process.exit(1)
    }

    let counter = 1
    let renamed = 0

    for (const file of files) {
      if (file.startsWith('.')) continue

      const filePath = join(dir, file)
      if (!statSync(filePath).isFile()) continue

      const ext = extname(file)
      const episode = counter.toString().padStart(2, '0')
      const newName = `${season}x${episode}${ext}`
      const newPath = join(dir, newName)

      if (filePath !== newPath) {
        console.log(`${cosmetic.faint(file)} -> ${cosmetic.cyan(newName)}`)
        renameSync(filePath, newPath)
        renamed++
      }

      counter++
    }

    console.log(cosmetic.bold.green(`\nDone. Renamed ${renamed} files.`))
  })
