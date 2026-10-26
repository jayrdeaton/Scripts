import { execFileSync, execSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative, resolve } from 'node:path'

import { Color, log } from 'termkit'

import { BUILDS_DIR, checkLockfile, exec, formatTimestamp, recordBuild, requireCleanTree, runVerify } from './ship.mjs'

// `jrd ship build` for an Electron app packaged by electron-builder (Lumber-Desktop): a project with an
// electron-builder.yml. Its profiles are its own pack scripts, so the commands stay runnable without jrd.
//   development  npm run pack          an unsigned local build to run on this Mac
//   mas-dev      npm run pack:mas-dev  the Mac App Store build, development signed, to run sandboxed here
//   mas          npm run pack:mas      the Mac App Store build for upload, a .pkg handed to Transporter
export const ELECTRON_PROFILES = { development: 'pack', 'mas-dev': 'pack:mas-dev', mas: 'pack:mas' }

const CONFIG = 'electron-builder.yml'

export const isElectronProject = (cwd) => existsSync(join(cwd, CONFIG))

const fail = (message) => {
  log.fail(message)
  process.exit(1)
}

const run = (cmd, args, options = {}) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...options }).toString()

// A command's stdout and stderr together, whatever its exit status (codesign -dvv and pkgutil report there)
const report = (cmd, args) => {
  const { stdout, stderr } = spawnSync(cmd, args)
  return `${stdout}${stderr}`
}

const git = (cwd, ...args) => run('git', args, { cwd }).trim()

// The few electron-builder.yml values this needs, read by line: a top-level key, or a key in a top-level
// block (mas, masDev, directories). Enough for the flat config electron-builder uses, without a YAML parser.
export function configValue(source, key, block) {
  const unquote = (value) => value.trim().replace(/^(['"])(.*)\1$/, '$2') || null
  if (!block) return unquote(source.match(new RegExp(`^${key}:(.*)$`, 'm'))?.[1] ?? '')
  const body = source.match(new RegExp(`^${block}:\\n((?:[ \\t]+.*\\n?|[ \\t]*#.*\\n?|\\n)*)`, 'm'))?.[1] ?? ''
  return unquote(body.match(new RegExp(`^[ \\t]+${key}:(.*)$`, 'm'))?.[1] ?? '')
}

// The web app the export script bundles (`cd ../Lumber && npx expo export ...`), whose working tree ends up
// in the build, so it has to be checked and recorded like the shell's own
function webSource(cwd, scripts) {
  const dir = scripts.export?.match(/^cd\s+(\S+)\s*&&/)?.[1]
  return dir ? resolve(cwd, dir) : null
}

const identities = (policy) => run('security', ['find-identity', '-v', ...(policy ? ['-p', policy] : [])])

const MAKE_CERTIFICATE = 'Make one in Xcode: Settings, Accounts, Manage Certificates.'

// The Mac App Store certificates are .p12 files here, not in the login keychain: there, Xcode takes the Apple
// Distribution one for an iPhone build's generic "iPhone Distribution" identity, and `eas build --local` fails
// because EAS's profile doesn't include it. electron-builder imports the files (CSC_LINK, CSC_INSTALLER_LINK) into
// a keychain of its own for the build and deletes it after. Both share one password, kept in the login keychain.
export const SIGNING_DIR = join(homedir(), '.config', 'jrd', 'signing')
const SIGNING_SERVICE = 'jrd Mac App Store signing'
const SIGNING_FILES = [
  { file: 'apple-distribution.p12', name: 'Apple Distribution', types: ['Apple Distribution', '3rd Party Mac Developer Application'], link: 'CSC_LINK', passwordEnv: 'CSC_KEY_PASSWORD' },
  { file: 'mac-installer-distribution.p12', name: 'Mac Installer Distribution', types: ['3rd Party Mac Developer Installer'], link: 'CSC_INSTALLER_LINK', passwordEnv: 'CSC_INSTALLER_KEY_PASSWORD' }
]
const shown = (path) => path.replace(homedir(), '~')

const signingPassword = () => {
  const { status, stdout } = spawnSync('security', ['find-generic-password', '-s', SIGNING_SERVICE, '-w'])
  return status === 0 ? stdout.toString().replace(/\n$/, '') : null
}

// A .p12's certificate names and whether it holds a key, or null if the password doesn't open it. macOS's own
// LibreSSL: Keychain Access exports certificates with RC2, which OpenSSL 3 won't read without -legacy.
function readP12(path, password) {
  const { status, stdout, stderr } = spawnSync('/usr/bin/openssl', ['pkcs12', '-in', path, '-info', '-nokeys', '-passin', 'env:JRD_P12_PASSWORD'], { env: { ...process.env, JRD_P12_PASSWORD: password } })
  return status === 0 ? { names: stdout.toString(), hasKey: stderr.toString().includes('Shrouded Keybag') } : null
}

// Before a long build: the certificates and profile the target signs with. Returns the environment that hands
// electron-builder the Mac App Store certificates.
export function checkSigning(cwd, config, profile) {
  if (profile === 'mas-dev') {
    const qualifier = configValue(config, 'identity', 'masDev') ?? ''
    const found = identities('codesigning')
      .split('\n')
      .some((line) => /"(Apple Development|Mac Developer):/.test(line) && line.includes(qualifier))
    if (!found) fail(`No Apple Development certificate in the keychain. ${MAKE_CERTIFICATE}`)
    return {}
  }
  const identity = configValue(config, 'identity', 'mas')
  const profileFile = configValue(config, 'provisioningProfile', 'mas')
  if (!identity) fail(`${CONFIG} names no mas.identity (the team's certificate name, like "Infinite Token LLC (6J8NCZC8G6)").`)
  if (!profileFile || !existsSync(join(cwd, profileFile))) fail(`The Mac App Store provisioning profile ${profileFile ?? '(mas.provisioningProfile)'} isn't here. Make one in the developer portal (Profiles, Mac App Store Connect) and save it there.`)
  const password = signingPassword()
  if (!password) fail(`No "${SIGNING_SERVICE}" password in the keychain. Add the .p12 files' password (it asks for it): security add-generic-password -a "$USER" -s "${SIGNING_SERVICE}" -w`)
  const env = {}
  for (const { file, name, types, link, passwordEnv } of SIGNING_FILES) {
    const path = join(SIGNING_DIR, file)
    if (!existsSync(path)) fail(`No ${shown(path)}. Export the ${name} certificate for ${identity} from Keychain Access's My Certificates as a .p12 and save it there. ${MAKE_CERTIFICATE}`)
    const p12 = readP12(path, password)
    if (!p12) fail(`${shown(path)} doesn't open with the "${SIGNING_SERVICE}" password.`)
    if (!p12.hasKey || !types.some((type) => p12.names.includes(`${type}: ${identity}`))) fail(`${shown(path)} holds no ${name} certificate and key for ${identity}.`)
    env[link] = path
    env[passwordEnv] = password
  }
  return env
}

const newest = (paths) => paths.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null

// The newest build folder for the profile in electron-builder's output (out/mac-arm64, out/mas-dev-arm64,
// out/mas-arm64) that holds the app, or null
function buildFolder(outDir, profile, productName) {
  const pattern = { development: /^mac(-|$)/, 'mas-dev': /^mas-dev(-|$)/, mas: /^mas(-(arm64|x64|universal))?$/ }[profile]
  const names = existsSync(outDir) ? readdirSync(outDir) : []
  return newest(names.filter((name) => pattern.test(name) && existsSync(join(outDir, name, `${productName}.app`))).map((name) => join(outDir, name)))
}

const plistJson = (input) => JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', '-'], { input, stdio: ['pipe', 'pipe', 'ignore'] }).toString())

// One value of a plist that as a whole has no JSON form (a provisioning profile's dates and certificate data)
const plistValue = (input, keyPath) => {
  const { status, stdout } = spawnSync('plutil', ['-extract', keyPath, 'json', '-o', '-', '-'], { input })
  return status === 0 ? JSON.parse(stdout.toString()) : null
}

const entitlements = (path) => {
  const xml = spawnSync('codesign', ['-d', '--entitlements', '-', '--xml', path]).stdout
  return xml.length ? plistJson(xml) : {}
}

// Every executable in the bundle: the app, Electron's helpers, the login helper
const executables = (app) =>
  run('find', [app, '-type', 'f', '-perm', '-u+x'])
    .split('\n')
    .filter((path) => path && /Mach-O.*executable/.test(run('file', ['-b', path])))

// What App Store Connect would refuse (or a broken local build), caught before anything goes anywhere: run on
// the app electron-builder just made and, for mas, its .pkg. Returns the problems, empty when there are none.
export function checkBuild({ app, pkg, profile, appId, version, build, team }) {
  const problems = []
  const info = plistJson(readFileSync(join(app, 'Contents', 'Info.plist')))
  const signature = spawnSync('codesign', ['--verify', '--deep', '--strict', app])
  if (signature.status !== 0) problems.push(`its signature doesn't verify: ${signature.stderr.toString().trim()}`)
  if (appId && info.CFBundleIdentifier !== appId) problems.push(`its bundle id is ${info.CFBundleIdentifier}, not ${appId}`)
  if (version && info.CFBundleShortVersionString !== version) problems.push(`its version is ${info.CFBundleShortVersionString}, not package.json's ${version}`)
  if (profile === 'development') return problems

  for (const path of executables(app)) {
    if (!entitlements(path)['com.apple.security.app-sandbox']) problems.push(`${relative(app, path)} isn't sandboxed`)
  }
  if (profile === 'mas-dev') return problems

  if (build && info.CFBundleVersion !== build) problems.push(`its build number is ${info.CFBundleVersion}, not ${build}`)
  const signer = report('codesign', ['-dvv', app])
  if (!/Authority=(Apple Distribution|3rd Party Mac Developer Application):/.test(signer)) problems.push("it isn't signed with an Apple Distribution certificate")
  if (team && !signer.includes(`TeamIdentifier=${team}`)) problems.push(`it isn't signed for team ${team}`)
  const applicationId = entitlements(app)['com.apple.application-identifier']
  if (team && appId && applicationId !== `${team}.${appId}`) problems.push(`its application identifier is ${applicationId ?? 'missing'}, not ${team}.${appId}`)
  const embedded = join(app, 'Contents', 'embedded.provisionprofile')
  if (!existsSync(embedded)) problems.push('it carries no provisioning profile')
  else if (team && !plistValue(spawnSync('security', ['cms', '-D', '-i', embedded]).stdout, 'TeamIdentifier')?.includes(team)) problems.push(`its provisioning profile isn't team ${team}'s`)
  if (!pkg) problems.push('electron-builder made no .pkg')
  else if (!report('pkgutil', ['--check-signature', pkg]).includes('3rd Party Mac Developer Installer:')) problems.push(`${relative(process.cwd(), pkg)} isn't signed with a Mac Installer Distribution certificate`)
  return problems
}

export function buildElectron(cwd, profile) {
  const script = ELECTRON_PROFILES[profile]
  if (!script) fail(`"${profile}" isn't an Electron build profile. Valid profiles: ${Object.keys(ELECTRON_PROFILES).join(', ')}`)
  const pkgJson = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
  const scripts = pkgJson.scripts ?? {}
  if (!scripts[script]) fail(`package.json has no "${script}" script for ${profile}.`)

  const configPath = join(cwd, CONFIG)
  const config = readFileSync(configPath, 'utf8')
  const productName = configValue(config, 'productName') ?? pkgJson.productName ?? pkgJson.name
  const appId = configValue(config, 'appId')
  const outDir = join(cwd, configValue(config, 'output', 'directories') ?? 'dist')
  const web = webSource(cwd, scripts)
  const store = profile === 'mas'

  // What gets uploaded has to be a commit of each: the shell and the web app it bundles
  if (store) {
    requireCleanTree(cwd)
    if (web) requireCleanTree(web)
  }
  checkLockfile(cwd)
  if (scripts.verify) exec('npm run verify', cwd)
  if (web) runVerify(web)
  const signingEnv = profile === 'development' ? {} : checkSigning(cwd, config, profile)
  if (profile === 'mas-dev') log.info('Signing asks the keychain for the Apple Development key. If macOS prompts, Allow covers one file, Always Allow the rest of this build and later ones.')

  // The build number App Store Connect takes once per version: raised for the build, and committed only once
  // the package passes its checks, so a failed build leaves nothing behind
  const current = store ? configValue(config, 'buildVersion') : null
  if (store && !/^\d+$/.test(current ?? '')) fail(`${CONFIG} needs a numeric top-level buildVersion (CFBundleVersion) to raise.`)
  const next = store ? String(Number(current) + 1) : null
  if (store) writeFileSync(configPath, config.replace(/^(buildVersion:\s*)(['"]?)\d+\2/m, `$1$2${next}$2`))
  const restore = () => store && execSync(`git checkout -- ${CONFIG}`, { cwd, stdio: 'ignore' })
  const team = store ? (config.match(/^\s+ElectronTeamID:\s*['"]?([A-Z0-9]{10})/m)?.[1] ?? configValue(config, 'identity', 'mas')?.match(/\(([A-Z0-9]{10})\)$/)?.[1]) : null

  let dir, app, pkg, problems
  try {
    exec(`npm run ${script}`, cwd, signingEnv)
    dir = buildFolder(outDir, profile, productName)
    if (!dir) throw new Error(`Found no ${productName}.app for ${profile} in ${relative(cwd, outDir)}.`)
    app = join(dir, `${productName}.app`)
    pkg = store
      ? newest(
          readdirSync(dir)
            .filter((name) => name.endsWith('.pkg'))
            .map((name) => join(dir, name))
        )
      : null
    problems = checkBuild({ app, pkg, profile, appId, version: pkgJson.version, build: next, team })
  } catch (e) {
    restore()
    fail(e.status != null ? `npm run ${script} failed.` : e.message)
  }
  if (problems.length) {
    restore()
    console.error(problems.map((problem) => `  ${problem}`).join('\n'))
    fail(`The ${profile} build of ${productName} has problems.`)
  }

  if (!store) {
    log.succeed(`${productName}.app (${profile}) checked, in ${relative(cwd, dir)}`)
    console.log(Color.faint(`$ open "${relative(cwd, app)}"`))
    return
  }

  execSync(`git add ${CONFIG}`, { cwd })
  execSync(`git commit -m "buildVersion ${current} -> ${next}"`, { cwd, stdio: 'ignore' })
  mkdirSync(BUILDS_DIR, { recursive: true })
  const destPath = join(BUILDS_DIR, `${productName}-${formatTimestamp(new Date())}.pkg`)
  copyFileSync(pkg, destPath)
  // platform: the Mac App Store build can share the iPhone app's bundle id, and `jrd ship status` reads iOS builds
  recordBuild({ app: productName, bundleId: appId, platform: 'macos', profile, version: pkgJson.version, build: next, sha: git(cwd, 'rev-parse', 'HEAD'), dirty: false, ...(web && { web: relative(cwd, web), webSha: git(web, 'rev-parse', 'HEAD') }), file: destPath, createdAt: Date.now() })
  log.succeed(`${productName} ${pkgJson.version} (${next}) checked and saved to ${destPath}, buildVersion ${current} -> ${next} committed`)

  execFileSync('open', ['-a', 'Transporter', destPath])
  log.info('Opened in Transporter: click Deliver to upload it to App Store Connect.')
}
