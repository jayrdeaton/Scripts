import { execSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { Color, log, Program } from 'termkit'

const NON_SEMVER = /^(file:|link:|workspace:|git\+|github:|https?:|\/)/

const RUNTIME_PATTERNS = [/^react$/, /^react-dom$/, /^react-native/, /^expo(-|$)/, /^@expo\//, /^@gorhom\//, /^@shopify\//, /^@reduxjs\//]

function isRuntimeDep(name) {
  return RUNTIME_PATTERNS.some((p) => p.test(name))
}

function stripRange(raw) {
  return raw.replace(/^[\^~>=<\s]+/, '').trim()
}

function toFloor(raw) {
  if (NON_SEMVER.test(raw.trim())) return null
  const clean = stripRange(raw)
  if (!/^\d/.test(clean)) return null
  const parts = clean.split('.')
  const major = parseInt(parts[0], 10) || 0
  const minor = parseInt(parts[1], 10) || 0
  return `>=${major}.${minor}.0`
}

function isSemver(raw) {
  return !NON_SEMVER.test(raw.trim()) && /^\d/.test(stripRange(raw))
}

function sortedDeps(deps) {
  return Object.fromEntries(Object.entries(deps).sort(([a], [b]) => a.localeCompare(b)))
}

function readPkg(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

export const command = Program.command('sync-peers')
  .description('Sync @rific peerDependency floors and devDependency versions to match Expo-Starter')
  .option('s', 'starter', '[starter]', 'Path to Expo-Starter project (default: ~/Developer/Expo-Starter)')
  .option('r', 'root', '[root]', 'Root directory containing @rific packages (default: ~/Developer)')
  .option('d', 'dry', null, 'Preview changes without writing')
  .option('i', 'install', null, 'Run npm install in each changed repo')
  .option('t', 'test', null, 'Run npm test in each changed repo (implies --install)')
  .action(async (options) => {
    const starterPath = resolve(options.starter ?? join(homedir(), 'Developer', 'Expo-Starter'))
    const rootPath = resolve(options.root ?? join(homedir(), 'Developer'))
    const isDry = !!options.dry
    const shouldTest = !!options.test
    const shouldInstall = !!options.install || shouldTest

    const starterPkg = readPkg(starterPath)
    if (!starterPkg) {
      log.fail(`No package.json found at: ${starterPath}`)
      process.exit(1)
    }

    const starterDeps = { ...starterPkg.dependencies, ...starterPkg.devDependencies }
    const expoVersion = starterDeps.expo ? stripRange(starterDeps.expo) : 'unknown'
    log.info(`Expo SDK floor: ${expoVersion}`)

    const entries = readdirSync(rootPath).filter((name) => {
      try {
        return statSync(join(rootPath, name)).isDirectory()
      } catch {
        return false
      }
    })

    const rificPkgs = entries
      .map((name) => {
        const dir = join(rootPath, name)
        const pkg = readPkg(dir)
        if (!pkg?.name?.startsWith('@rific/')) return null
        return { name, dir, pkg }
      })
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name))

    log.info(`Found ${rificPkgs.length} @rific packages\n`)

    let totalChanges = 0

    for (const { name, dir, pkg } of rificPkgs) {
      const peerUpdates = {}
      const devUpdates = {}

      for (const [dep, current] of Object.entries(pkg.peerDependencies ?? {})) {
        if (!(dep in starterDeps)) continue
        const floor = toFloor(starterDeps[dep])
        if (!floor || floor === current) continue
        peerUpdates[dep] = { from: current, to: floor }
      }

      for (const [dep, current] of Object.entries(pkg.devDependencies ?? {})) {
        if (!isRuntimeDep(dep) || !(dep in starterDeps)) continue
        const next = starterDeps[dep]
        if (!isSemver(next) || next === current) continue
        devUpdates[dep] = { from: current, to: next }
      }

      const hasChanges = Object.keys(peerUpdates).length > 0 || Object.keys(devUpdates).length > 0

      if (!hasChanges) {
        console.log(`${Color.bold(name)}  ${Color.faint('no changes')}`)
        continue
      }

      console.log(Color.bold(name))

      if (Object.keys(peerUpdates).length > 0) {
        console.log(Color.faint('  peerDependencies'))
        for (const [dep, { from, to }] of Object.entries(peerUpdates)) {
          console.log(`    ${dep}`)
          console.log(`      ${Color.red(from)} → ${Color.green(to)}`)
          totalChanges++
        }
      }

      if (Object.keys(devUpdates).length > 0) {
        console.log(Color.faint('  devDependencies'))
        for (const [dep, { from, to }] of Object.entries(devUpdates)) {
          console.log(`    ${dep}`)
          console.log(`      ${Color.red(from)} → ${Color.green(to)}`)
          totalChanges++
        }
      }

      if (!isDry) {
        const updated = { ...pkg }
        if (Object.keys(peerUpdates).length > 0) {
          updated.peerDependencies = sortedDeps({ ...pkg.peerDependencies, ...Object.fromEntries(Object.entries(peerUpdates).map(([d, { to }]) => [d, to])) })
        }
        if (Object.keys(devUpdates).length > 0) {
          updated.devDependencies = sortedDeps({ ...pkg.devDependencies, ...Object.fromEntries(Object.entries(devUpdates).map(([d, { to }]) => [d, to])) })
        }
        writeFileSync(join(dir, 'package.json'), JSON.stringify(updated, null, 2) + '\n')
        if (shouldInstall) {
          console.log(Color.faint('  npm install'))
          execSync('npm install', { cwd: dir, stdio: 'inherit' })
        }
        if (shouldTest) {
          console.log(Color.faint('  npm test'))
          execSync('npm test', { cwd: dir, stdio: 'inherit' })
        }
      }

      console.log()
    }

    if (totalChanges === 0) {
      log.succeed('All dependencies already aligned.')
    } else if (isDry) {
      log.info(`${totalChanges} change${totalChanges !== 1 ? 's' : ''} pending — run without --dry to apply`)
    } else {
      log.succeed(`Applied ${totalChanges} change${totalChanges !== 1 ? 's' : ''}.`)
    }
  })
