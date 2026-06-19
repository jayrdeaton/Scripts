import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { Color, Program, Spinner } from 'termkit'

const execFileAsync = promisify(execFile)

async function gh(path) {
  const { stdout } = await execFileAsync('gh', ['api', path, '--paginate'], {
    maxBuffer: 64 * 1024 * 1024
  })
  return JSON.parse(stdout)
}

async function ghPatch(fullName, fields) {
  await execFileAsync('gh', ['api', '-X', 'PATCH', `/repos/${fullName}`, ...fields], {
    maxBuffer: 64 * 1024 * 1024
  })
}

export const command = Program.command('archive')
  .description('Archive repos (and optionally make them private). Dry-run unless --apply. Requires `gh auth login`.')
  .variable('[repos...]')
  .option('o', 'org', '<org>', 'Target an organization instead of your personal repos')
  .option('a', 'access', '<access>', 'Visibility to list: all, private, or public (default: public)')
  .option('p', 'privatize', null, 'Also make each repo private before archiving')
  .option('y', 'apply', null, 'Actually make the changes (default is a dry run)')
  .action(async (args) => {
    const options = args

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
        const names = explicit.map((r) => (r.includes('/') ? r : `${owner}/${r}`))
        repos = await Promise.all(names.map((name) => gh(`/repos/${name}`)))
      } else {
        let raw
        if (options.org) raw = await gh(`/orgs/${options.org}/repos?type=${access}&per_page=100`)
        else raw = await gh(`/user/repos?visibility=${access}&affiliation=owner&per_page=100`)
        repos = raw
      }
    } catch {
      spinner.fail('Could not resolve repos. Run `gh auth login`, or check the org/repo names.')
      process.exit(1)
    }

    const willPrivatize = (repo) => repo.private || Boolean(options.privatize)
    const needsWork = (repo) => !repo.archived || (options.privatize && !repo.private)

    repos = repos.filter(needsWork).sort((a, b) => a.full_name.localeCompare(b.full_name))

    if (!repos.length) {
      spinner.succeed('Nothing to do — no matching repos need changes.')
      return
    }

    spinner.stop()
    const mode = options.apply ? Color.bold.red('APPLY') : Color.bold('DRY RUN')
    console.log(`\n${mode}  ${repos.length} repos\n`)

    let changed = 0
    let failed = 0
    const loader = new Spinner({ text: `0/${repos.length}` })
    loader.start()

    let done = 0
    for (const repo of repos) {
      const fullName = repo.full_name
      loader.update(`${done}/${repos.length}  ${Color.faint(fullName)}`)
      done++

      const present = []
      const past = []
      if (!repo.private && willPrivatize(repo)) {
        present.push('make private')
        past.push('made private')
      }
      if (!repo.archived) {
        present.push('archive')
        past.push('archived')
      }

      if (!options.apply) {
        loader.log(`  ${Color.bold(fullName)}  ${Color.green(`would ${present.join(' + ')}`)}`)
        continue
      }

      try {
        // Archived repos are read-only; unarchive first if we need to change visibility.
        if (repo.archived) await ghPatch(fullName, ['-F', 'archived=false'])
        if (!repo.private && willPrivatize(repo)) await ghPatch(fullName, ['-f', 'visibility=private'])
        if (!repo.archived) await ghPatch(fullName, ['-F', 'archived=true'])
        changed++
        loader.log(`  ${Color.bold(fullName)}  ${Color.green(past.join(' + '))}`, Color.green('✓'))
      } catch (err) {
        failed++
        const reason = (err.stderr || err.message || '').split('\n').find((l) => l.trim()) ?? 'unknown error'
        loader.log(`  ${Color.bold(fullName)}  ${Color.red(`failed — ${reason.trim()}`)}`, Color.red('✗'))
      }
    }

    if (options.apply) {
      const parts = [`${changed} changed`]
      if (failed) parts.push(Color.red(`${failed} failed`))
      loader.succeed(parts.join(', '))
    } else {
      loader.succeed(`${repos.length} would change · pass --apply to write`)
    }
  })
