import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { log, Program } from 'termkit'

import { checkLockfile, exec, requireCleanTree, runVerify } from '../../lib/ship.mjs'

const BUMPS = ['major', 'minor', 'patch']

// npm's own settings for the tag and commit npm version would have made (defaults "v" and "%s").
function npmConfig(key, cwd, fallback) {
  try {
    const value = execSync(`npm config get ${key}`, { cwd }).toString().trim()
    return value && value !== 'undefined' ? value : fallback
  } catch {
    return fallback
  }
}

// Where expo.version's value sits in app.json's text, as [start, end) around its quotes: a small scan
// that tracks which key each value belongs to, so another "version" (a plugin option, say) or the
// same number elsewhere can't be mistaken for it. Null when there isn't one.
function expoVersionSpan(source) {
  const stack = []
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    const top = stack[stack.length - 1]
    if (c === '"') {
      let j = i + 1
      while (source[j] !== '"') j += source[j] === '\\' ? 2 : 1
      if (top?.type === 'object' && top.expectKey) {
        top.key = JSON.parse(source.slice(i, j + 1))
        top.expectKey = false
      } else if (stack.length === 2 && stack[0].key === 'expo' && top.type === 'object' && top.key === 'version') {
        return [i, j + 1]
      }
      i = j
    } else if (c === '{') {
      stack.push({ type: 'object', key: null, expectKey: true })
    } else if (c === '[') {
      stack.push({ type: 'array' })
    } else if (c === '}' || c === ']') {
      stack.pop()
    } else if (c === ',' && top?.type === 'object') {
      top.expectKey = true
    }
  }
  return null
}

// An Expo app's store version (app.json's expo.version) follows the release version, so the git tag,
// the web deploy and the next store build all carry one number. It isn't part of the app's runtime
// fingerprint, so changing it never cuts existing builds off from OTA updates. Only that one value is
// rewritten, so the rest of the file keeps its formatting. Returns whether app.json changed.
function syncAppJsonVersion(cwd, version) {
  const path = join(cwd, 'app.json')
  if (!existsSync(path)) return false

  const source = readFileSync(path, 'utf8')
  const json = JSON.parse(source)
  const current = json.expo?.version
  if (typeof current !== 'string' || current === version) return false

  const span = expoVersionSpan(source)
  const next = span && `${source.slice(0, span[0])}${JSON.stringify(version)}${source.slice(span[1])}`
  // Everything but expo.version must come out exactly as it was.
  json.expo.version = version
  if (!next || JSON.stringify(JSON.parse(next)) !== JSON.stringify(json)) {
    log.fail('Could not update expo.version in app.json; nothing was committed (package.json is bumped, revert it with git checkout).')
    process.exit(1)
  }
  writeFileSync(path, next)
  log.info(`app.json expo.version: ${current} -> ${version}`)
  return true
}

// The tag's web deploy (vercel build) runs vercel.json's buildCommand, which in an Expo app is a web
// export that verify never touches. Null when there's none.
function webBuildCommand(cwd) {
  const path = join(cwd, 'vercel.json')
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')).buildCommand ?? null
}

// Whether cmd chains step with &&, either itself or, when cmd is a bare `npm run <name>`, in that
// script, so a step one command already runs isn't run twice.
function runsStep(cmd, step, scripts) {
  if (!cmd) return false
  const parts = (c) => c.split('&&').map((part) => part.trim())
  if (parts(cmd).includes(step)) return true
  const script = cmd.match(/^npm run (\S+)$/)?.[1]
  return Boolean(script && scripts[script] && parts(scripts[script]).includes(step))
}

export const command = Program.command('release', '<bump>')
  .description('Bump the version (and app.json expo.version), commit, tag and git push --follow-tags (bump is major, minor, or patch)')
  .action(async (options) => {
    const cwd = process.cwd()
    const bump = options.bump

    if (!BUMPS.includes(bump)) {
      log.fail(`"${bump}" is not a valid bump: use one of: ${BUMPS.join(', ')}`)
      process.exit(1)
    }

    // npm version checks this itself, but it no longer commits here (see below).
    requireCleanTree(cwd)

    // Everything the push sets off runs here first, so a failure stops before anything is bumped: CI
    // (npm ci, then npm run verify) and the web deploy's build. Verify is left to whichever of those
    // already runs it: a preversion script (npm version runs it before changing anything) or a web
    // build like build:web's "npm run verify && expo export". A verify that already includes the web
    // build (a Nuxt site's "npm run build") covers that too.
    const { scripts = {} } = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
    const webBuild = webBuildCommand(cwd)
    if (runsStep(scripts.preversion, 'npm run verify', scripts) || runsStep(webBuild, 'npm run verify', scripts)) {
      checkLockfile(cwd)
    } else {
      runVerify(cwd)
    }
    if (webBuild && !runsStep(scripts.verify, webBuild, scripts)) exec(webBuild, cwd)

    // Bumps package.json (and the lockfile) and runs the preversion/version/postversion scripts, but
    // leaves the commit and tag to us, so app.json can go in the same commit.
    exec(`npm version ${bump} --no-git-tag-version`, cwd)
    const { version } = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))

    const files = ['package.json']
    if (existsSync(join(cwd, 'package-lock.json'))) files.push('package-lock.json')
    if (syncAppJsonVersion(cwd, version)) files.push('app.json')

    const tag = `${npmConfig('tag-version-prefix', cwd, 'v')}${version}`
    const message = npmConfig('message', cwd, '%s').replace(/%s/g, version)
    exec(`git add ${files.join(' ')}`, cwd)
    exec(`git commit -m "${message}"`, cwd)
    // Annotated, like npm's: git push --follow-tags only pushes annotated tags.
    exec(`git tag -a ${tag} -m "${message}"`, cwd)
    exec('git push --follow-tags', cwd)

    log.succeed(`Released ${tag}.`)
  })
