import { execFile, execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { Color, padRight, Program, Spinner } from 'termkit'

import { appBundleInfo, BUILDS_DIR, ipaInfo, readBuildLog, withLocalBin } from '../../lib/ship.mjs'

const execFileAsync = promisify(execFile)

const DEVELOPER = join(homedir(), 'Developer')
const PROFILE_LABELS = { production: 'Prod build', preview: 'Preview build', development: 'Dev build' }
const ANDROID_LABELS = { production: 'prod', development: 'dev' }
const UPDATE_BRANCHES = ['production', 'development']
// Where `jrd ship bump-ota` keeps otaVersion.
const RELEASE_FILE = 'src/constants/release.ts'

// stdout, or null when the command fails, times out or isn't installed: every source is optional, and
// one that can't answer is listed under its app instead of stopping the report.
async function run(cmd, args, cwd, timeout = 60_000) {
  try {
    const env = cwd ? withLocalBin(cwd) : process.env
    const { stdout } = await execFileAsync(cmd, args, { cwd, env, maxBuffer: 64 * 1024 * 1024, timeout })
    return stdout
  } catch {
    return null
  }
}

async function runJson(cmd, args, cwd, timeout) {
  const out = await run(cmd, args, cwd, timeout)
  try {
    return out ? JSON.parse(out) : null
  } catch {
    return null
  }
}

const git = async (cwd, ...args) => (await run('git', args, cwd))?.trim() || null

// Commits since `from` that change something besides the otaVersion file: `jrd ship update` commits
// an otaVersion bump right before it publishes, and a bump alone leaves nothing new to ship.
async function commitsSince(cwd, from) {
  const count = await git(cwd, 'rev-list', '--count', `${from}..HEAD`, '--', '.', `:(exclude)${RELEASE_FILE}`)
  return count === null ? null : Number(count)
}

const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null)

const isExpoApp = (dir) => existsSync(join(dir, 'app.json')) && existsSync(join(dir, 'eas.json'))

// Expo apps under ~/Developer that have been released (have a v* tag).
function releasedApps() {
  return readdirSync(DEVELOPER)
    .map((name) => join(DEVELOPER, name))
    .filter((dir) => {
      try {
        if (!statSync(dir).isDirectory() || !isExpoApp(dir)) return false
        return (
          execFileSync('git', ['tag', '-l', 'v*'], { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] })
            .toString()
            .trim() !== ''
        )
      } catch {
        return false
      }
    })
}

// ---------- sources ----------

async function codeState(dir) {
  const pkg = readJson(join(dir, 'package.json')) ?? {}
  const releasePath = join(dir, RELEASE_FILE)
  const ota = existsSync(releasePath) ? readFileSync(releasePath, 'utf8').match(/otaVersion:\s*(\d+)/)?.[1] : undefined

  const [head, porcelain, tag, fingerprint] = await Promise.all([
    git(dir, 'rev-parse', 'HEAD'),
    run('git', ['status', '--porcelain'], dir),
    git(dir, 'describe', '--tags', '--abbrev=0', '--match', 'v*'),
    // The hash EAS builds and updates carry as their runtime version. It covers uncommitted changes too,
    // so it's the native layer a build made right now would have.
    runJson('eas', ['fingerprint:generate', '--platform', 'ios', '--json', '--non-interactive'], dir)
  ])

  return {
    version: pkg.version,
    ota: ota ? Number(ota) : undefined,
    head,
    dirty: porcelain ? porcelain.split('\n').filter((line) => line && !line.startsWith('??')).length : 0,
    tag,
    sinceTag: tag ? await commitsSince(dir, tag) : null,
    fingerprint: fingerprint?.hash ?? null
  }
}

// The newest production deployment on Vercel, and the newest run of the tag-triggered Deploy workflow
// (which shows a failed or still-running deploy that never reached Vercel).
async function webState(dir) {
  if (!existsSync(join(dir, 'vercel.json'))) return null

  const project = readJson(join(dir, '.vercel', 'project.json'))
  const hasWorkflow = existsSync(join(dir, '.github', 'workflows', 'deploy.yml'))
  const [list, runs] = await Promise.all([project ? runJson('vercel', ['ls', project.projectName, '--prod', '--format', 'json', '--scope', project.orgId], dir) : null, hasWorkflow ? runJson('gh', ['run', 'list', '--workflow', 'deploy.yml', '--limit', '1', '--json', 'headBranch,headSha,conclusion,status,createdAt'], dir) : null])

  const deployment = list?.deployments?.find((d) => d.state === 'READY')
  const sha = deployment?.meta?.githubCommitSha
  const tags = sha ? await git(dir, 'tag', '--points-at', sha, '--list', 'v*') : null

  return {
    linked: Boolean(project),
    failed: Boolean(project) && !list,
    sha,
    tag: tags?.split('\n')[0],
    createdAt: deployment?.createdAt,
    behind: sha ? await commitsSince(dir, sha) : null,
    lastRun: runs?.[0] ?? null
  }
}

// Every finished EAS build for a platform (ios or android), newest first, and the profiles of any still
// queued or building.
async function easBuilds(dir, platform) {
  const list = await runJson('eas', ['build:list', '--platform', platform, '--limit', '30', '--json', '--non-interactive'], dir)
  if (!list) return { builds: [], pending: [], failed: true }
  const pending = list.filter((b) => ['NEW', 'IN_QUEUE', 'IN_PROGRESS'].includes(b.status)).map((b) => b.buildProfile)
  const builds = list
    .filter((b) => b.status === 'FINISHED')
    .map((b) => ({
      source: b.isForIosSimulator ? 'EAS simulator' : 'EAS',
      profile: b.buildProfile,
      version: b.appVersion,
      build: b.appBuildVersion,
      fingerprint: b.fingerprint?.hash ?? b.runtime?.version,
      sha: b.gitCommitHash,
      createdAt: Date.parse(b.createdAt)
    }))
  return { builds, pending }
}

const fromLog = (r) => ({ ...r, source: existsSync(r.file) ? `local ${basename(r.file)}` : 'local' })

// Every local iOS build `jrd ship build` made: its records (kept after an .ipa is installed and deleted),
// plus any .ipa in ~/Downloads/Builds from before it kept them.
function localBuilds(name, bundleId) {
  // The records with no platform: Mac App Store builds (which can share the iPhone app's bundle id) are
  // marked macos, and Android builds android
  const records = readBuildLog().filter((r) => !r.platform && (bundleId ? r.bundleId === bundleId : r.app === name))

  const files = existsSync(BUILDS_DIR) ? readdirSync(BUILDS_DIR).filter((file) => file.startsWith(`${name}-`) && file.endsWith('.ipa')) : []
  const unrecorded = files
    .map((file) => join(BUILDS_DIR, file))
    .filter((path) => !records.some((r) => r.file === path))
    .map((path) => {
      const info = ipaInfo(path)
      return info && { ...info, profile: info.channel ?? 'development', file: path, source: `local ${basename(path)}`, createdAt: statSync(path).mtimeMs }
    })
    .filter(Boolean)

  return [...records.map(fromLog), ...unrecorded]
}

// The app as installed on each booted simulator (an `expo run:ios` or simulator build).
async function simulatorInstalls(bundleId) {
  if (!bundleId) return []
  const devices = (await runJson('xcrun', ['simctl', 'list', 'devices', 'booted', '-j']))?.devices ?? {}
  const booted = Object.values(devices).flat()

  const installs = await Promise.all(
    booted.map(async (device) => {
      const path = (await run('xcrun', ['simctl', 'get_app_container', device.udid, bundleId]))?.trim()
      if (!path) return null
      const info = appBundleInfo((entry) => (existsSync(join(path, entry)) ? readFileSync(join(path, entry)) : null))
      return { source: device.name, profile: 'simulator', ...info, createdAt: statSync(path).mtimeMs }
    })
  )
  return installs.filter(Boolean)
}

// The apps on each connected iPhone or iPad, looked up once for every app in the report. devicectl
// can't read an installed app's bundle, so these come with a version and build number but no
// fingerprint: appState fills that in from the build with the same numbers, when there's a record of it.
async function connectedPhones() {
  // Over Wi-Fi, listing a phone's apps takes 5 to 15 seconds alone, and longer while other apps' eas
  // processes are running.
  const devicectl = (...args) => runJson('xcrun', ['devicectl', ...args, '--json-output', '/dev/stdout', '-q'], undefined, 120_000)
  const devices = (await devicectl('list', 'devices'))?.result?.devices ?? []
  const phones = devices.filter((d) => d.hardwareProperties?.reality === 'physical' && d.hardwareProperties?.platform === 'iOS' && d.connectionProperties?.tunnelState === 'connected')
  return Promise.all(phones.map(async (d) => ({ name: d.deviceProperties?.name, apps: (await devicectl('device', 'info', 'apps', '--device', d.identifier))?.result?.apps ?? null })))
}

// The newest iOS update on an EAS Update branch. update:list leaves out the commit and date, so the group
// is looked up again with update:view.
async function latestUpdate(dir, branch) {
  const list = await runJson('eas', ['update:list', '--branch', branch, '--limit', '4', '--json', '--non-interactive'], dir)
  const group = list?.currentPage?.find((u) =>
    u.platforms
      ?.split(',')
      .map((p) => p.trim())
      .includes('ios')
  )?.group
  if (!group) return null

  const view = await runJson('eas', ['update:view', group, '--json'], dir)
  const update = view?.find((u) => u.platform === 'ios')
  if (!update) return null

  return {
    branch,
    message: update.message,
    sha: update.gitCommitHash,
    fingerprint: update.runtimeVersion,
    createdAt: Date.parse(update.createdAt),
    behind: update.gitCommitHash ? await commitsSince(dir, update.gitCommitHash) : null
  }
}

// Newest per profile across EAS and local builds: a local production build counts as much as a cloud one.
const newestPerProfile = (known) => known.filter((b, i) => known.findIndex((x) => x.profile === b.profile) === i)

async function appState(dir, phones) {
  const { expo } = readJson(join(dir, 'app.json'))
  const name = expo.name
  const bundleId = expo.ios?.bundleIdentifier
  const androidPackage = expo.android?.package

  const [code, web, eas, androidEas, simulators, updates] = await Promise.all([codeState(dir), webState(dir), easBuilds(dir, 'ios'), androidPackage ? easBuilds(dir, 'android') : null, simulatorInstalls(bundleId), Promise.all(UPDATE_BRANCHES.map((branch) => latestUpdate(dir, branch)))])
  const known = [...eas.builds, ...localBuilds(name, bundleId)].sort((a, b) => b.createdAt - a.createdAt)

  const builds = newestPerProfile(known)
  for (const b of builds) b.behind = b.sha ? await commitsSince(dir, b.sha) : null

  // Android's builds are kept apart: their fingerprints are Android's, and their build numbers (versionCode)
  // come from a counter of their own, so they'd neither match the iOS fingerprint nor pin down a phone's build.
  const localAndroid = androidPackage ? readBuildLog().filter((r) => r.platform === 'android' && r.package === androidPackage) : []
  const android = newestPerProfile([...(androidEas?.builds ?? []), ...localAndroid.map(fromLog)].sort((a, b) => b.createdAt - a.createdAt))
  for (const b of android) b.behind = b.sha ? await commitsSince(dir, b.sha) : null
  // Only for an app with Android builds to compare it to: most have none
  if (android.length) code.androidFingerprint = (await runJson('eas', ['fingerprint:generate', '--platform', 'android', '--json', '--non-interactive'], dir))?.hash ?? null

  // Build numbers come from one EAS counter shared by every profile, local builds included, so a
  // version and build number pins down which build a phone has.
  const phoneInstalls = []
  const unreadPhones = []
  for (const phone of await phones) {
    if (!phone.apps) {
      unreadPhones.push(phone.name)
      continue
    }
    const app = phone.apps.find((a) => a.bundleIdentifier === bundleId)
    if (!app) continue
    const match = known.find((b) => b.version === app.version && String(b.build) === String(app.bundleVersion))
    phoneInstalls.push({
      source: app.builtByDeveloper === false ? `${phone.name} (TestFlight or App Store)` : phone.name,
      profile: match?.profile,
      version: app.version,
      build: app.bundleVersion,
      fingerprint: match?.fingerprint ?? null,
      sha: match?.sha,
      createdAt: match?.createdAt,
      recorded: Boolean(match),
      behind: match?.sha ? await commitsSince(dir, match.sha) : null
    })
  }

  // A production update matters even with no production build to reach (that's a finding); a
  // development one only when there's a dev build to run it.
  const reachable = updates.filter((u) => u && (u.branch === 'production' || builds.some((b) => b.profile === u.branch)))

  // A source that couldn't answer would otherwise read as having nothing to report.
  const failed = [!code.fingerprint && 'eas fingerprint:generate', android.length && !code.androidFingerprint && 'eas fingerprint:generate --platform android', eas.failed && 'eas build:list', androidEas?.failed && 'eas build:list --platform android', web?.failed && 'vercel ls', ...unreadPhones.map((phone) => `the app list on ${phone}`)].filter(Boolean)

  const pending = [...eas.pending, ...(androidEas?.pending ?? []).map((profile) => `${profile} (Android)`)]
  return { name, dir, code, web, builds, android, pending, simulators, phones: phoneInstalls, updates: reachable, failed }
}

// ---------- verdicts ----------

function nextSteps(app) {
  const { code, web, builds, simulators, phones, updates } = app
  const steps = []
  const prodBuild = builds.find((b) => b.profile === 'production')
  const prodUpdate = updates.find((u) => u.branch === 'production')

  if (code.dirty) steps.push({ level: 'warn', text: `${code.dirty} uncommitted file${code.dirty === 1 ? '' : 's'}: the ship commands want a clean tree.` })

  if (web?.lastRun?.conclusion === 'failure') {
    steps.push({ level: 'bad', text: `Deploy ${web.lastRun.headBranch} failed, so the web is still on ${web.tag ?? 'an older build'}.` })
  } else if (web?.lastRun && web.lastRun.status !== 'completed') {
    steps.push({ level: 'info', text: `Deploy ${web.lastRun.headBranch} is ${web.lastRun.status.replace('_', ' ')}.` })
  } else if (code.tag && web?.sha && web.tag !== code.tag) {
    steps.push({ level: 'bad', text: `${code.tag} is tagged but the web is on ${web.tag ?? web.sha.slice(0, 7)}.` })
  }
  if (web && code.sinceTag) steps.push({ level: 'info', text: `${code.sinceTag} commit${code.sinceTag === 1 ? '' : 's'} since ${code.tag}: jrd ship release patch puts them on the web.` })

  if (prodBuild && code.fingerprint) {
    if (prodBuild.fingerprint !== code.fingerprint) {
      steps.push({ level: 'warn', text: 'Native code changed since the production build, so an update cannot carry it: jrd ship build production.' })
    } else if (!prodUpdate || prodUpdate.fingerprint !== prodBuild.fingerprint) {
      if (prodBuild.behind) steps.push({ level: 'info', text: `${prodBuild.behind} commit${prodBuild.behind === 1 ? '' : 's'} since the production build, all JS: jrd ship update production.` })
    } else if (prodUpdate.behind) {
      steps.push({ level: 'info', text: `${prodUpdate.behind} commit${prodUpdate.behind === 1 ? '' : 's'} since the last production update, all JS: jrd ship update production.` })
    }
  }
  if (prodUpdate && prodBuild && prodUpdate.fingerprint !== prodBuild.fingerprint) {
    steps.push({ level: 'bad', text: 'The newest production update was made for different native code than the newest production build, so that build never gets it.' })
  }

  // An .ipa that's still on disk and matches is the fix for any phone that doesn't; otherwise, if nothing
  // installed or built for development matches, a new dev build is.
  const devBuild = builds.find((b) => b.profile === 'development')
  const installs = [...simulators, ...phones]
  if (code.fingerprint && devBuild?.fingerprint === code.fingerprint && devBuild.file && existsSync(devBuild.file)) {
    for (const phone of phones.filter((p) => p.fingerprint !== code.fingerprint)) {
      steps.push({ level: 'warn', text: `${basename(devBuild.file)} matches the current native code but ${phone.source} has build ${phone.build}: install it.` })
    }
  } else if (code.fingerprint && (devBuild || installs.length) && !phones.some((p) => !p.recorded) && ![devBuild, ...installs].some((b) => b?.fingerprint === code.fingerprint)) {
    // Not said when a phone has a build there's no record of: it may well match.
    steps.push({ level: 'warn', text: 'No dev build or install matches the current native code: jrd ship build development (or npm run ios).' })
  }

  return steps
}

// ---------- output ----------

function ago(ms) {
  if (!ms) return ''
  const minutes = Math.round((Date.now() - ms) / 60_000)
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)}h ago`
  return `${Math.round(minutes / 1440)}d ago`
}

const short = (sha) => (sha ? sha.slice(0, 7) : '')

function behindText(n) {
  if (n === null || n === undefined) return Color.faint('commit not found locally')
  if (n === 0) return Color.green('up to date')
  return Color.yellow(`${n} commit${n === 1 ? '' : 's'} behind`)
}

// current: the checkout's fingerprint for the build's platform
function nativeText(fingerprint, current) {
  if (!fingerprint || !current) return Color.faint('native unknown')
  return fingerprint === current ? Color.green('native matches') : Color.yellow('native differs')
}

// One app's report as text, so it can be printed above the spinner while other apps are still checking.
function formatApp(app) {
  const { code, web, builds, android, pending, simulators, phones, updates } = app
  const lines = []
  const row = (label, ...parts) => lines.push(`  ${padRight(Color.bold(label), 15)} ${parts.filter(Boolean).join(Color.faint(' · '))}`)

  const head = [Color.bold(app.name), code.version && `v${code.version}`, code.ota !== undefined && `ota ${code.ota}`, short(code.head)]
  if (code.tag) head.push(code.sinceTag ? Color.yellow(`${code.sinceTag} unreleased since ${code.tag}`) : Color.green(`released as ${code.tag}`))
  if (code.dirty) head.push(Color.yellow(`${code.dirty} uncommitted`))
  head.push(Color.faint(`native ${code.fingerprint ? short(code.fingerprint) : 'unknown'}`))
  lines.push(head.filter(Boolean).join('  '))

  if (web) {
    if (!web.linked) row('Web', Color.faint('no .vercel/project.json, run vercel link'))
    else if (web.failed) row('Web', Color.faint('unknown'))
    else if (!web.sha) row('Web', Color.faint('no production deployment found'))
    else row('Web', [web.tag, short(web.sha)].filter(Boolean).join(' '), ago(web.createdAt), behindText(web.behind))
  }

  const buildRow = (label, b, current = code.fingerprint) => row(label, `${b.version} (${b.build})`, b.sha && short(b.sha), Color.faint(b.source), ago(b.createdAt), b.sha && behindText(b.behind), nativeText(b.fingerprint, current))
  const updateRow = (label, u) => {
    const target = builds.find((b) => b.profile === u.branch)
    const reaches = !target ? Color.red('no build to run it') : u.fingerprint === target.fingerprint ? Color.green(`runs on ${target.version} (${target.build})`) : Color.red(`not for ${target.version} (${target.build})`)
    row(label, short(u.sha), Color.faint(u.message), ago(u.createdAt), behindText(u.behind), reaches)
  }

  for (const profile of Object.keys(PROFILE_LABELS)) {
    const b = builds.find((x) => x.profile === profile)
    if (b) buildRow(PROFILE_LABELS[profile], b)
    const u = updates.find((x) => x.branch === profile)
    if (u) updateRow(profile === 'production' ? 'Prod update' : 'Dev update', u)
  }
  for (const b of builds.filter((x) => !PROFILE_LABELS[x.profile])) buildRow(`${b.profile} build`, b)
  // An Android row's build number is its version code, and its fingerprint is compared to the checkout's Android one
  for (const b of android) buildRow(`Android ${ANDROID_LABELS[b.profile] ?? b.profile}`, b, code.androidFingerprint)
  if (pending.length) row('Building', pending.join(', '))
  for (const s of simulators) row('Simulator', `${s.version} (${s.build})`, Color.faint(s.source), ago(s.createdAt), nativeText(s.fingerprint, code.fingerprint))
  for (const p of phones) {
    const detail = p.recorded ? [p.sha && behindText(p.behind), nativeText(p.fingerprint, code.fingerprint)] : [Color.faint('no build record')]
    row('Phone', `${p.version} (${p.build})`, p.sha && short(p.sha), Color.faint(p.source), p.profile && Color.faint(p.profile), ago(p.createdAt), ...detail)
  }

  if (app.failed.length) lines.push(`  ${Color.red('!')} Couldn't get ${app.failed.join(', ')}, so anything from ${app.failed.length === 1 ? 'it' : 'them'} is missing or unknown.`)
  for (const step of nextSteps(app)) {
    const mark = { bad: Color.red('!'), warn: Color.yellow('>'), info: Color.cyan('>') }[step.level]
    lines.push(`  ${mark} ${step.text}`)
  }
  return `${lines.join('\n')}\n`
}

export const command = Program.command('status')
  .variable('[dirs...]')
  .description('Compare the web deploy, builds, simulator and phone installs, and EAS updates of each Expo app to its checkout, and say what to ship next (default: this app, else every v*-tagged Expo app under ~/Developer)')
  .option('j', 'json', null, 'Print the gathered data as JSON instead of the report')
  .action(async (options) => {
    const cwd = process.cwd()
    const dirs = options.dirs ? options.dirs.map((d) => resolve(DEVELOPER, d)) : isExpoApp(cwd) ? [cwd] : releasedApps()

    const apps = dirs.filter((dir) => {
      if (isExpoApp(dir)) return true
      console.error(Color.yellow(`Skipping ${dir}: no app.json and eas.json.`))
      return false
    })
    if (!apps.length) {
      console.error(Color.red('No Expo apps to check.'))
      process.exit(1)
    }

    // Started before the spinner and shared: one devicectl lookup covers every app.
    const phones = connectedPhones()
    const spinner = new Spinner({ text: `Checking ${apps.length} app${apps.length === 1 ? '' : 's'}...` })
    spinner.start()

    // A few apps at a time: each one runs several eas, vercel and gh processes at once. Each report
    // prints as soon as it and every app before it are done, so the output keeps the apps' order.
    const results = new Array(apps.length)
    let next = 0
    let done = 0
    let printed = 0
    async function worker() {
      while (next < apps.length) {
        const i = next++
        results[i] = await appState(apps[i], phones)
        spinner.update(`${++done}/${apps.length} ${results[i].name}`)
        if (options.json) continue
        while (results[printed]) spinner.log(formatApp(results[printed++]), '')
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, apps.length) }, worker))
    spinner.stop()

    if (options.json) {
      console.log(
        JSON.stringify(
          results.map((app) => ({ ...app, next: nextSteps(app) })),
          null,
          2
        )
      )
    }
  })
