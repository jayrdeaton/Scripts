import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { command as createCommand, Spinner } from 'termkit'

export const command = createCommand('bump-ota')
  .description('Bump otaVersion in src/constants/release.ts and commit')
  .option('f', 'file', '[file]', 'Path to release file (default: src/constants/release.ts)')
  .action(async (options) => {
    const filePath = resolve(process.cwd(), options.file ?? 'src/constants/release.ts')
    const spinner = new Spinner({ text: 'Checking git status...' })
    spinner.start()

    try {
      const status = execSync('git status --porcelain').toString().trim()
      if (status) {
        spinner.fail('Working directory is not clean. Commit or stash changes first.')
        process.exit(1)
      }
    } catch (err) {
      spinner.fail(`Failed to check git status: ${err.message}`)
      process.exit(1)
    }

    let source
    try {
      source = readFileSync(filePath, 'utf8')
    } catch {
      spinner.fail(`Could not read file: ${filePath}`)
      process.exit(1)
    }

    const pattern = /(otaVersion:\s*)(\d+)/
    const match = source.match(pattern)

    if (!match) {
      spinner.fail(`Could not find otaVersion in ${filePath}`)
      process.exit(1)
    }

    const current = parseInt(match[2], 10)
    const next = current + 1

    writeFileSync(filePath, source.replace(pattern, `$1${next}`))

    spinner.message('Committing...')
    try {
      execSync(`git add ${filePath}`)
      execSync(`git commit -m "otaVersion ${current} -> ${next}"`)
    } catch (err) {
      spinner.fail(`Auto-commit failed: ${err.message}`)
      process.exit(1)
    }

    spinner.succeed(`otaVersion bumped: ${current} -> ${next}`)
  })
