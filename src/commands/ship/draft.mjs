import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

import { Color, confirm, log, Program, Spinner } from 'termkit'

import { buildElectron } from '../../lib/electron.mjs'
import { checkAssets, checkNames, compareVersions, fail, feedFiles, gh, ghError, ghJson, ghLoud, git, isFeed, latestRelease, listReleases, printFiles, publishDraft, releaseNotes, releaseTarget, shown, sleep, totalSize, viewRelease, WHATS_NEW_FILES, whatsNew } from '../../lib/release.mjs'
import { BUILDS_DIR, formatTimestamp, requireCleanTree } from '../../lib/ship.mjs'

// `jrd ship draft`: everything a direct release of an Electron app needs, up to a checked draft on GitHub. The Mac's
// DMG and zip build here (ship build direct); an app with a Build workflow (.github/workflows/build.yml, run by hand)
// gets its other platforms from GitHub's runners: Lumber-Desktop's makes Linux's AppImages and debs, released
// alongside, and the Microsoft Store packages, which are uploaded to Partner Center by hand. `jrd ship publish`
// publishes the draft.

const WORKFLOW = 'build.yml'
// Packages for a store, not this release: saved to ~/Downloads/Builds for uploading by hand
const STORE_PACKAGE = /\.(appx|msix|appxbundle|msixbundle)$/

// A store package's architecture, from its manifest: electron-builder leaves it out of the x64 package's name
// (Lumber 1.2.0.appx beside Lumber 1.2.0 arm64.appx). Null for a bundle, which holds several.
function packageArch(path) {
  try {
    const manifest = execFileSync('unzip', ['-p', path, 'AppxManifest.xml'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString()
    return manifest.match(/<Identity\b[^>]*\bProcessorArchitecture="(\w+)"/)?.[1] ?? null
  } catch {
    return null
  }
}

// The Build workflow, when the app has one: run by hand, and given the web app's commit through its first input
// (Lumber-Desktop's lumber_ref), if it takes one
function buildWorkflow(cwd) {
  const path = join(cwd, '.github', 'workflows', WORKFLOW)
  if (!existsSync(path)) return null
  const source = readFileSync(path, 'utf8')
  if (!/^\s+workflow_dispatch:/m.test(source)) return null
  return { input: source.match(/workflow_dispatch:[ \t]*\n\s+inputs:[ \t]*\n\s+([\w-]+):/)?.[1] ?? null }
}

// The workflow runs on a branch as origin has it, and the Mac builds this checkout, so the two only match when this
// checkout is exactly what's pushed. Returns the branch.
function pushedBranch(cwd) {
  const name = basename(cwd)
  git(cwd, 'fetch', '--quiet', 'origin')
  let branch
  try {
    branch = git(cwd, 'symbolic-ref', '--quiet', '--short', 'HEAD')
  } catch {
    fail(`${name} isn't on a branch, and its Build workflow runs on one.`)
  }
  let remote
  try {
    remote = git(cwd, 'rev-parse', `origin/${branch}`)
  } catch {
    fail(`origin has no ${branch} for the Build workflow to run on. Push it first.`)
  }
  if (git(cwd, 'rev-parse', 'HEAD') !== remote) {
    const [behind, ahead] = git(cwd, 'rev-list', '--left-right', '--count', `origin/${branch}...HEAD`).split(/\s+/).map(Number)
    const state = [ahead && `${ahead} ahead of`, behind && `${behind} behind`].filter(Boolean).join(' and ')
    fail(`${name}'s ${branch} is ${state} origin's. The Build workflow builds origin's ${branch} and the Mac build this checkout, so they have to match: ${ahead ? 'push' : 'pull'} first.`)
  }
  return branch
}

// The web app's commit, which the workflow checks out by its full SHA, so it has to be on GitHub
function pushedCommit(dir) {
  git(dir, 'fetch', '--quiet', 'origin')
  const sha = git(dir, 'rev-parse', 'HEAD')
  if (!git(dir, 'branch', '-r', '--contains', sha)) fail(`${basename(dir)}'s HEAD (${sha.slice(0, 7)}) isn't pushed, so the Build workflow can't check it out. Push it first.`)
  return sha
}

const artifactsOf = (cwd, id) => ghJson(['api', `repos/{owner}/{repo}/actions/runs/${id}/artifacts`, '--jq', '[.artifacts[] | {name, expired}]'], cwd)

// A run of the workflow that built (or is building) these commits, with its artifacts still kept, so running draft
// again after a failed Mac build doesn't build the rest again. The web app's commit is matched in the run's title
// (Lumber-Desktop's run-name carries its input).
function findRun(cwd, sha, webSha) {
  const runs = ghJson(['run', 'list', '--workflow', WORKFLOW, '--event', 'workflow_dispatch', '--limit', '30', '--json', 'databaseId,headSha,displayTitle,status,conclusion,url'], cwd)
  for (const run of runs) {
    if (run.headSha !== sha || (webSha && !run.displayTitle.includes(webSha))) continue
    if (run.status !== 'completed') return { id: run.databaseId, url: run.url }
    if (run.conclusion !== 'success') continue
    const artifacts = artifactsOf(cwd, run.databaseId)
    if (artifacts.length && artifacts.every((artifact) => !artifact.expired)) return { id: run.databaseId, url: run.url }
  }
  return null
}

// A GitHub read tried up to five times, 3 seconds apart: the API can answer a 500 for a run it has only just made.
// Fails with message (and gh's words) after the last, or returns null when there's no message.
async function retried(read, message) {
  for (let attempt = 1; ; attempt++) {
    try {
      return read()
    } catch (e) {
      if (attempt >= 5) {
        if (message) fail(`${message}: ${ghError(e)}`)
        return null
      }
      await sleep(3000)
    }
  }
}

async function dispatch(cwd, workflow, branch, sha, webSha) {
  const args = ['workflow', 'run', WORKFLOW, '--ref', branch]
  if (workflow.input && webSha) args.push('-f', `${workflow.input}=${webSha}`)
  console.log(Color.faint(`$ gh ${args.join(' ')}`))
  let output
  try {
    output = gh(args, cwd)
  } catch (e) {
    fail(`The Build workflow didn't start: ${ghError(e)}`)
  }
  // gh prints the new run's URL when GitHub returns it; otherwise it shows up in the list within seconds
  let id = output.match(/\/actions\/runs\/(\d+)/)?.[1]
  for (let attempt = 0; !id && attempt < 10; attempt++) {
    await sleep(3000)
    id = (await retried(() => findRun(cwd, sha, webSha)))?.id
  }
  if (!id) fail('The Build workflow was started, but its run never showed up.')
  const run = await retried(() => ghJson(['run', 'view', String(id), '--json', 'databaseId,headSha,url'], cwd), `Couldn't read the Build workflow's run ${id}`)
  // Someone pushing between the check and the dispatch
  if (run.headSha !== sha) fail(`The Build workflow's run is building ${run.headSha.slice(0, 7)}, not ${sha.slice(0, 7)}: ${run.url}`)
  return { id: run.databaseId, url: run.url }
}

async function waitForRun(cwd, run) {
  const spinner = new Spinner({ text: `Waiting for the Build workflow: ${run.url}` })
  spinner.start()
  let attempt = null
  let errors = 0
  for (;;) {
    let view
    try {
      view = ghJson(['run', 'view', String(run.id), '--json', 'status,conclusion,jobs,attempt'], cwd)
      errors = 0
    } catch (e) {
      if (++errors >= 5) {
        spinner.fail(`Lost track of the Build workflow: ${run.url}`)
        fail(ghError(e))
      }
    }
    // Right after a rerun, the run still reads as the attempt that failed
    if (view && (attempt === null || view.attempt > attempt)) {
      if (view.status === 'completed' && view.conclusion === 'success') {
        spinner.succeed(`The Build workflow built the other platforms: ${run.url}`)
        return
      }
      if (view.status === 'completed') {
        spinner.fail(`The Build workflow ended ${view.conclusion}: ${run.url}`)
        const failed = view.jobs.filter((job) => job.conclusion !== 'success').map((job) => `${job.name} (${job.conclusion})`)
        if (failed.length) console.error(`  ${failed.join(', ')}`)
        if (!process.stdin.isTTY || !(await confirm('Run its failed jobs again?', { default: true }))) fail("The other platforms aren't built. Running draft again starts a new run.")
        ghLoud(['run', 'rerun', String(run.id), '--failed'], cwd)
        attempt = view.attempt
        spinner.start()
      } else {
        spinner.update(`Waiting for the Build workflow (${view.jobs.map((job) => `${job.name} ${job.status === 'completed' ? job.conclusion : job.status.replace('_', ' ')}`).join(', ') || view.status}): ${run.url}`)
      }
    }
    await sleep(15000)
  }
}

// Each of the run's artifacts in a folder of its own under dir, which is emptied first
function downloadArtifacts(cwd, run, dir) {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  return artifactsOf(cwd, run.id).map(({ name }) => {
    ghLoud(['run', 'download', String(run.id), '--name', name, '--dir', join(dir, name)], cwd)
    return { name, dir: join(dir, name) }
  })
}

export const command = Program.command('draft')
  .description("Draft a GitHub release of the Electron app's direct downloads in the current directory, for package.json's version, in the repo electron-builder.yml's publish block names: builds the Mac's DMG and zip (as ship build direct) while the app's Build workflow, if it has one, builds Linux's AppImages and debs and the Microsoft Store packages (saved to ~/Downloads/Builds for Partner Center), checks every file against its update feed's hash and size and that every name with a version carries this one, uploads them to a draft and checks what GitHub stored. ship publish publishes it")
  .option('n', 'notes', '<notes>', 'The release notes (Markdown)')
  .option('F', 'notes-file', '<file>', 'Read the release notes from a file')
  .option('t', 'title', '<title>', 'The release title (default: the latest release\'s with this version, like "SlingScan for Mac 1.0.4", or "<productName> <version>")')
  .option('r', 'replace', null, 'Delete the draft already made for this version, once the new files are built and checked')
  .option('d', 'dry-run', null, 'Build and check everything, but make no release')
  .action(async (options) => {
    const cwd = process.cwd()
    const target = releaseTarget(cwd)
    const { productName, version, tag, slug, web } = target
    const dryRun = Boolean(options['dry-run'])
    const notesFile = options['notes-file'] ? resolve(cwd, options['notes-file']) : null
    if (options.notes && notesFile) fail('Pass --notes or --notes-file, not both.')
    if (notesFile && !existsSync(notesFile)) fail(`There's no ${options['notes-file']}.`)

    // Whether this version can be released at all, before anything is built
    let releases, previous
    try {
      releases = listReleases(slug)
      previous = latestRelease(slug, releases)
    } catch (e) {
      fail(`Couldn't read ${slug}'s releases: ${ghError(e)}`)
    }
    const same = releases.filter((release) => release.tagName === tag)
    if (same.some((release) => !release.isDraft)) fail(`${tag} is already released on ${slug}. Raise package.json's version first.`)
    if (same.length > 1) fail(`${slug} has ${same.length} drafts for ${tag}. Delete the extras on GitHub first.`)
    const existing = same[0] ?? null
    if (existing && !options.replace) {
      if (!dryRun) fail(`${slug} already has a draft for ${tag}. Publish it with jrd ship publish, or make it again with --replace.`)
      log.warn(`${slug} already has a draft for ${tag}, so a real run needs --replace.`)
    }
    if (previous && compareVersions(version, previous.tagName) <= 0) fail(`${version} isn't newer than ${previous.tagName}, the latest release, so no copy would update to it. Raise package.json's version first.`)
    // Named as the latest release is (SlingScan's "SlingScan for Mac 1.0.3"), with this version in its place
    const oldVersion = previous?.tagName.replace(/^v/, '')
    const title = options.title ?? (oldVersion && previous.name?.includes(oldVersion) ? previous.name.replace(oldVersion, version) : `${productName} ${version}`)
    // Said now, so it can be written and committed while the build runs (the file is read when the notes are made, after)
    const ownNotes = Boolean(options.notes || notesFile)
    if (!ownNotes && !whatsNew(cwd, version)) log.warn(`There's no "**What's New** (${version}):" block in ${WHATS_NEW_FILES.join(' or ')}, so the notes will only list the downloads. Add one (in Lumber-Desktop it's the Mac App Store's What's New too) and commit it, or pass --notes.`)

    // The Mac build checks both trees again; checking here keeps the workflow from starting on them first
    requireCleanTree(cwd)
    if (web) requireCleanTree(web)

    // The other platforms build on GitHub's runners while the Mac builds here
    const workflow = buildWorkflow(cwd)
    let run = null
    if (workflow) {
      const branch = pushedBranch(cwd)
      const sha = git(cwd, 'rev-parse', 'HEAD')
      const webSha = web ? pushedCommit(web) : null
      run = await retried(() => findRun(cwd, sha, webSha), "Couldn't read the Build workflow's runs")
      if (run) log.info(`Using the Build workflow's run for these commits: ${run.url}`)
      else run = await dispatch(cwd, workflow, branch, sha, webSha)
    } else {
      log.info(`No .github/workflows/${WORKFLOW} to run, so this release is the Mac's alone.`)
    }

    const mac = buildElectron(cwd, 'direct')
    const problems = []
    const files = await feedFiles(mac.outDir, 'latest-mac.yml', { version, since: mac.started, from: 'mac' }, problems)

    if (run) {
      await waitForRun(cwd, run)
      const stamp = formatTimestamp(new Date())
      for (const artifact of downloadArtifacts(cwd, run, join(mac.outDir, 'release'))) {
        const names = readdirSync(artifact.dir)
        // A store package: Partner Center takes it by hand
        for (const name of names.filter((name) => STORE_PACKAGE.test(name))) {
          if (!name.includes(version)) problems.push(`the ${artifact.name} artifact's ${name} isn't ${version}`)
          const arch = packageArch(join(artifact.dir, name))
          const destPath = join(BUILDS_DIR, `${productName}-${stamp}${arch ? `-${arch}` : ''}${name.slice(name.lastIndexOf('.'))}`)
          mkdirSync(BUILDS_DIR, { recursive: true })
          copyFileSync(join(artifact.dir, name), destPath)
          log.info(`${name} saved to ${shown(destPath)}, for Partner Center`)
        }
        // A platform's direct downloads: its update feeds and the files they list
        const feeds = names.filter(isFeed)
        const listed = []
        for (const feed of feeds) listed.push(...(await feedFiles(artifact.dir, feed, { version, from: artifact.name }, problems)))
        // A file two feeds list goes up once
        for (const file of listed) if (!files.some((other) => other.path === file.path)) files.push(file)
        if (feeds.length) {
          const left = names.filter((name) => !STORE_PACKAGE.test(name) && !listed.some((file) => file.name === name))
          for (const name of left) log.warn(`The ${artifact.name} artifact's ${name} isn't in any of its feeds, so it's left out.`)
        }
      }
    }

    checkNames(
      files.map((file) => file.name),
      version,
      previous,
      problems
    )
    if (problems.length) {
      console.error(problems.map((problem) => `  ${problem}`).join('\n'))
      fail(`${productName} ${version} isn't ready to release.`)
    }

    const notes = notesFile
      ? readFileSync(notesFile, 'utf8')
      : (options.notes ??
        releaseNotes(
          cwd,
          target,
          files.map((file) => file.name)
        ))
    if (dryRun) {
      console.log(`\n${files.length} files for ${title} (${totalSize(files)}), every one matching its feed:`)
      printFiles(files)
      console.log(`\nIts notes:\n\n${notes.trim() ? notes.trim().replace(/^/gm, '  ') : '  (none)'}\n`)
      log.succeed(`Dry run: everything checks out. Without --dry-run, this drafts ${tag} on ${slug} with these files and notes, then asks whether to publish it.`)
      return
    }

    if (existing) {
      if (!viewRelease(slug, tag).isDraft) fail(`${tag} was published while this ran. Nothing was uploaded.`)
      ghLoud(['release', 'delete', tag, '--repo', slug, '--yes'], cwd)
    }
    log.info(`Uploading ${files.length} files (${totalSize(files)}), every one matching its feed, to a draft`)
    ghLoud(['release', 'create', tag, '--repo', slug, '--draft', '--title', title, '--notes', notes, ...files.map((file) => file.path)], cwd)

    // What GitHub stored, against what was built
    const release = viewRelease(slug, tag)
    if (!release.isDraft) problems.push("it isn't a draft")
    checkAssets(release, files, problems)
    if (problems.length) {
      console.error(problems.map((problem) => `  ${problem}`).join('\n'))
      fail(`The draft doesn't hold what was built. It's still a draft, nothing is published: look at it at ${release.url}, or delete it with gh release delete ${tag} --repo ${slug} --yes`)
    }
    log.succeed(`Drafted ${title} with ${files.length} files, each one as built: ${release.url}`)

    // Shown, and published only on a yes; otherwise it stays a draft for jrd ship publish
    await publishDraft(target, { offered: true })
  })
