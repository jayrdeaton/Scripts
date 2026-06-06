import { execSync } from 'node:child_process'
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { Color, log, Program } from 'termkit'

const BOILERPLATE_REPO = 'git@github.com:jayrdeaton/Expo-Boilerplate.git'
const BOILERPLATE_DIR = join(homedir(), 'Developer', 'Expo-Boilerplate')
const DEV_DIR = join(homedir(), 'Developer')

function exec(cmd, opts = {}) {
  console.log(Color.faint(`$ ${cmd}`))
  execSync(cmd, { stdio: 'inherit', ...opts })
}

function parseWords(name) {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[\s\-_]+/)
    .filter(Boolean)
}

export const command = Program.command('new-expo-project')
  .description('Bootstrap a new Expo project from the boilerplate')
  .option('n', 'name', '<name>', 'Project name')
  .action(async (options) => {
    const words = parseWords(options.name)
    const displayName = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    const slug = words.map((w) => w.toLowerCase()).join('-')
    const pascal = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('')
    const lower = words.map((w) => w.toLowerCase()).join('')
    const dirName = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('-')
    const targetDir = join(DEV_DIR, dirName)

    if (existsSync(targetDir)) {
      log.fail(`Directory already exists: ${targetDir}`)
      process.exit(1)
    }

    if (existsSync(BOILERPLATE_DIR)) {
      log.info('Pulling latest boilerplate...')
      exec('git pull', { cwd: BOILERPLATE_DIR })
    } else {
      log.info('Cloning boilerplate...')
      exec(`git clone ${BOILERPLATE_REPO} "${BOILERPLATE_DIR}"`)
    }

    log.info(`Creating ${displayName}...`)
    cpSync(BOILERPLATE_DIR, targetDir, {
      recursive: true,
      filter: (src) => !src.includes('/node_modules/')
    })

    rmSync(join(targetDir, '.git'), { recursive: true, force: true })

    const pkgPath = join(targetDir, 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    pkg.name = slug
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

    const appPath = join(targetDir, 'app.json')
    const app = JSON.parse(readFileSync(appPath, 'utf8'))
    app.expo.name = displayName
    app.expo.slug = slug
    app.expo.scheme = lower
    app.expo.description = `${displayName} app`
    app.expo.ios.bundleIdentifier = `com.infinitetoken.${pascal}`
    app.expo.android.package = `com.infinitetoken.${lower}`
    writeFileSync(appPath, JSON.stringify(app, null, 2) + '\n')

    exec('git init', { cwd: targetDir })
    exec('git add -A', { cwd: targetDir })
    exec('git commit -m "Initial commit"', { cwd: targetDir })

    log.succeed(`${displayName} created at ${targetDir}`)
  })
