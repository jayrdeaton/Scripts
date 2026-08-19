import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { Color, log, Program } from 'termkit'

const NON_SEMVER = /^(file:|link:|workspace:|git\+|github:|https?:|\/)/

function rificPackages(deps = {}) {
  return Object.entries(deps)
    .filter(([name, version]) => name.startsWith('@rific/') && !NON_SEMVER.test(version.trim()))
    .map(([name]) => `${name}@latest`)
}

function exec(cmd, cwd) {
  console.log(Color.faint(`$ ${cmd}`))
  execSync(cmd, { cwd, stdio: 'inherit' })
}

export const command = Program.command('update-rific', '[dirs...]')
  .description('Update detected @rific packages to @latest in one or more projects (default: current directory)')
  .option('l', 'legacy', null, 'Pass --legacy-peer-deps to npm install')
  .option('d', 'dry', null, 'Preview which packages would be updated without installing')
  .action(async (options) => {
    const dirs = options.dirs?.length ? options.dirs : [process.cwd()]
    const legacyFlag = options.legacy ? ' --legacy-peer-deps' : ''
    const isDry = !!options.dry

    let totalPackages = 0

    for (const dir of dirs) {
      const projectDir = resolve(dir)
      const pkgPath = resolve(projectDir, 'package.json')
      let pkg

      try {
        pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      } catch {
        console.error(Color.red(`No package.json found in: ${projectDir}`))
        continue
      }

      const label = pkg.name ? `${projectDir} ${Color.faint(`(${pkg.name})`)}` : projectDir
      const prodDeps = rificPackages(pkg.dependencies)
      const devDeps = rificPackages(pkg.devDependencies)

      if (!prodDeps.length && !devDeps.length) {
        console.log(`${Color.bold(label)}  ${Color.faint('no @rific packages found')}`)
        continue
      }

      console.log(Color.bold(label))

      if (prodDeps.length) {
        console.log(Color.faint('  dependencies'))
        for (const p of prodDeps) console.log(`    ${Color.cyan(p)}`)
        if (!isDry) exec(`npm install${legacyFlag} ${prodDeps.join(' ')}`, projectDir)
      }

      if (devDeps.length) {
        console.log(Color.faint('  devDependencies'))
        for (const p of devDeps) console.log(`    ${Color.cyan(p)}`)
        if (!isDry) exec(`npm install --save-dev${legacyFlag} ${devDeps.join(' ')}`, projectDir)
      }

      totalPackages += prodDeps.length + devDeps.length
      console.log()
    }

    if (totalPackages === 0) {
      log.succeed('No @rific packages needed updating.')
    } else if (isDry) {
      log.info(`${totalPackages} @rific package${totalPackages !== 1 ? 's' : ''} would be updated — run without --dry to apply`)
    } else {
      log.succeed(`Updated ${totalPackages} @rific package${totalPackages !== 1 ? 's' : ''}.`)
    }
  })
