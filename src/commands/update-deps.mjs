import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { Color, log, Program } from 'termkit'

function exec(cmd) {
  console.log(Color.faint(`$ ${cmd}`))
  execSync(cmd, { stdio: 'inherit' })
}

function latestPackages(deps = {}) {
  return Object.entries(deps)
    .filter(([, version]) => /^\^?[\d*]/.test(version))
    .map(([name]) => `${name}@latest`)
}

export const command = Program.command('update-deps')
  .description('Update all npm deps to @latest, then run expo install --fix if applicable')
  .option('d', 'dev', null, 'Only update devDependencies')
  .option('p', 'prod', null, 'Only update dependencies')
  .option('l', 'legacy', null, 'Pass --legacy-peer-deps to npm install')
  .action(async (options) => {
    const pkgPath = resolve(process.cwd(), 'package.json')
    let pkg

    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    } catch {
      log.fail('No package.json found in current directory.')
      process.exit(1)
    }

    const prodDeps = latestPackages(pkg.dependencies)
    const devDeps = latestPackages(pkg.devDependencies)
    const legacyFlag = options.legacy ? ' --legacy-peer-deps' : ''

    if (!options.dev && prodDeps.length) {
      log.info('Updating dependencies...')
      exec(`npm install${legacyFlag} ${prodDeps.join(' ')}`)
    }

    if (!options.prod && devDeps.length) {
      log.info('Updating devDependencies...')
      exec(`npm install --save-dev${legacyFlag} ${devDeps.join(' ')}`)
    }

    const hasExpo = pkg.dependencies?.expo !== undefined || pkg.devDependencies?.expo !== undefined

    if (hasExpo) {
      log.info('Fixing Expo managed versions...')
      exec(`npx expo install --fix${options.legacy ? ' -- --legacy-peer-deps' : ''}`)
    }

    log.info('Auditing and fixing vulnerabilities...')
    exec('npm audit --fix')

    log.succeed('Done.')
  })
