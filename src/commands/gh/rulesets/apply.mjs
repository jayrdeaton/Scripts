import { execFile } from 'node:child_process'
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { Color, Program, Spinner } from 'termkit'

const execFileAsync = promisify(execFile)

async function gh(path) {
  const { stdout } = await execFileAsync('gh', ['api', path, '--paginate'], {
    maxBuffer: 64 * 1024 * 1024
  })
  return JSON.parse(stdout)
}

async function ghWrite(method, path, bodyFile) {
  await execFileAsync('gh', ['api', '-X', method, path, '--input', bodyFile], {
    maxBuffer: 64 * 1024 * 1024
  })
}

// Only the fields the create-ruleset API accepts; drops read-only fields like
// id/source/created_at so an exported ruleset can be replayed as-is.
const POST_FIELDS = ['name', 'target', 'enforcement', 'conditions', 'rules', 'bypass_actors']

function sanitize(raw) {
  const body = {}
  for (const key of POST_FIELDS) {
    if (raw[key] !== undefined) body[key] = raw[key]
  }
  return body
}

export const command = Program.command('apply')
  .description('Apply a ruleset (from a JSON file) to many repos. Dry-run unless --apply. Requires `gh auth login`.')
  .variable('[repos...]')
  .option('f', 'file', '<file>', 'Path to the ruleset JSON file (required)')
  .option('o', 'org', '<org>', 'Target an organization instead of your personal repos')
  .option('a', 'access', '<access>', 'Visibility when using selectors: all, private, or public (default: public)')
  .option('A', 'apply', null, 'Actually create the rulesets (default is a dry run)')
  .option('O', 'overwrite', null, 'Update repos that already have a ruleset of this name, instead of skipping')
  .action(async (args) => {
    const options = args
    if (!options.file) {
      console.error(Color.red('Pass --file <path> with the ruleset JSON.'))
      process.exit(1)
    }

    let body
    try {
      body = sanitize(JSON.parse(readFileSync(options.file, 'utf8')))
    } catch (err) {
      console.error(Color.red(`Could not read/parse ${options.file}: ${err.message}`))
      process.exit(1)
    }
    if (!body.name || !body.target || !body.enforcement) {
      console.error(Color.red('Ruleset JSON must include at least name, target, and enforcement.'))
      process.exit(1)
    }

    const access = (options.access ?? 'public').toLowerCase()
    if (!['all', 'private', 'public'].includes(access)) {
      console.error(Color.red(`Invalid --access "${access}". Use one of: all, private, public.`))
      process.exit(1)
    }
    const explicit = Array.isArray(args.repos) ? args.repos : args.repos ? [args.repos] : []

    const spinner = new Spinner({ text: 'Resolving target repos...' })
    spinner.start()

    let repos
    try {
      if (explicit.length) {
        let owner
        if (explicit.some((r) => !r.includes('/'))) owner = options.org ?? (await gh('/user')).login
        repos = explicit.map((r) => (r.includes('/') ? r : `${owner}/${r}`))
      } else {
        let raw
        if (options.org) raw = await gh(`/orgs/${options.org}/repos?type=${access}&per_page=100`)
        else raw = await gh(`/user/repos?visibility=${access}&affiliation=owner&per_page=100`)
        repos = raw.filter((repo) => !repo.archived).map((repo) => repo.full_name)
      }
    } catch {
      spinner.fail('Could not resolve repos. Run `gh auth login`, or check the org/repo names.')
      process.exit(1)
    }

    repos.sort((a, b) => a.localeCompare(b))

    if (!repos.length) {
      spinner.succeed('No target repos.')
      return
    }

    spinner.stop()
    const mode = options.apply ? Color.bold.red('APPLY') : Color.bold('DRY RUN')
    console.log(`\n${mode}  ruleset ${Color.cyan(body.name)} → ${repos.length} repos\n`)

    // Write the sanitized body once; reused for every POST.
    const bodyFile = join(tmpdir(), `ruleset-${Date.now()}.json`)
    writeFileSync(bodyFile, JSON.stringify(body))

    let created = 0
    let updated = 0
    let skipped = 0
    let failed = 0
    const loader = new Spinner({ text: `0/${repos.length}` })
    loader.start()

    try {
      let done = 0
      for (const fullName of repos) {
        loader.message(`${done}/${repos.length}  ${Color.faint(fullName)}`)
        done++

        let existing = []
        try {
          existing = await gh(`/repos/${fullName}/rulesets`)
        } catch {
          // no access / none — treat as empty, the write will surface real errors
        }
        const match = existing.find((r) => r.name === body.name)

        // Already present and not overwriting → skip.
        if (match && !options.overwrite) {
          skipped++
          loader.stop()
          console.log(`  ${Color.bold(fullName)}  ${Color.faint(`skip — already has "${body.name}"`)}`)
          loader.start()
          continue
        }

        const verb = match ? 'overwrite' : 'create'

        if (!options.apply) {
          loader.stop()
          console.log(`  ${Color.bold(fullName)}  ${Color.green(`would ${verb}`)}`)
          loader.start()
          continue
        }

        try {
          if (match) await ghWrite('PUT', `/repos/${fullName}/rulesets/${match.id}`, bodyFile)
          else await ghWrite('POST', `/repos/${fullName}/rulesets`, bodyFile)
          if (match) updated++
          else created++
          loader.stop()
          console.log(`  ${Color.bold(fullName)}  ${Color.green(match ? 'overwritten' : 'created')}`)
          loader.start()
        } catch (err) {
          failed++
          const reason = (err.stderr || err.message || '').split('\n').find((l) => l.trim()) ?? 'unknown error'
          loader.stop()
          console.log(`  ${Color.bold(fullName)}  ${Color.red(`failed — ${reason.trim()}`)}`)
          loader.start()
        }
      }
    } finally {
      try {
        unlinkSync(bodyFile)
      } catch {
        // best effort
      }
    }

    if (options.apply) {
      const parts = [`${created} created`]
      if (options.overwrite) parts.push(`${updated} overwritten`)
      parts.push(`${skipped} skipped`)
      if (failed) parts.push(Color.red(`${failed} failed`))
      loader.succeed(parts.join(', '))
    } else if (options.overwrite) {
      const wouldWrite = repos.length - skipped
      loader.succeed(`${wouldWrite} would be created/overwritten · pass --apply to write`)
    } else {
      const wouldCreate = repos.length - skipped
      loader.succeed(`${wouldCreate} would be created, ${skipped} already have it · pass --apply to write`)
    }
  })
