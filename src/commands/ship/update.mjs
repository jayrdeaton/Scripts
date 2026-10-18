import { execFileSync, execSync } from 'node:child_process'

import { Color, log, Program } from 'termkit'

import { exec, requireCleanTree, runVerify, validateProfile, withLocalBin } from '../../lib/ship.mjs'

export const command = Program.command('update', '<profile>')
  .description('Publish an EAS update for the current directory: bumps otaVersion, then eas update --branch/--environment <profile>')
  .option('f', 'file', '[file]', 'Path to release file for the otaVersion bump (default: src/constants/release.ts)')
  .action(async (options) => {
    const cwd = process.cwd()
    const profile = options.profile
    validateProfile(profile, cwd)

    // bump-ota refuses a dirty tree too, but only after verify has run. Checking first means verify
    // tests exactly what eas update ships.
    requireCleanTree(cwd)
    runVerify(cwd)

    // Captured before bump-ota's own commit, so this is the app's real last
    // commit - not the "otaVersion N -> N+1" commit bump-ota is about to make.
    const message = execSync('git log -1 --pretty=%B', { cwd }).toString().trim()

    exec(`jrd ship bump-ota${options.file ? ` --file ${options.file}` : ''}`, cwd)

    const nonInteractive = profile !== 'development'
    const args = ['update', '--branch', profile, '--environment', profile, '--message', message]
    if (nonInteractive) args.push('--non-interactive')

    const display = args.map((arg) => (/[\s"]/.test(arg) ? JSON.stringify(arg) : arg)).join(' ')
    console.log(Color.faint(`$ eas ${display}`))
    execFileSync('eas', args, { stdio: 'inherit', cwd, env: withLocalBin(cwd) })

    log.succeed('Update published.')
  })
