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

const SORTS = ['name', 'created', 'updated', 'pushed']

export const command = Program.command('repos')
  .description('List repos with visibility and archived state. Requires `gh auth login`.')
  .option('o', 'org', '<org>', 'Target an organization instead of your personal repos')
  .option('a', 'access', '<access>', 'Filter by visibility: all, private, or public (default: all)')
  .option('s', 'sort', '<field>', `Sort field: ${SORTS.join(', ')} (default: name)`)
  .option('d', 'desc', null, 'Reverse sort order')
  .option('A', 'archived', null, 'Show only archived repos')
  .option('f', 'forks', null, 'Include forks (excluded by default)')
  .action(async (args) => {
    const options = args

    const access = (options.access ?? 'all').toLowerCase()
    if (!['all', 'private', 'public'].includes(access)) {
      console.error(Color.red(`Invalid --access "${access}". Use one of: all, private, public.`))
      process.exit(1)
    }

    const sortField = (options.sort ?? 'name').toLowerCase()
    if (!SORTS.includes(sortField)) {
      console.error(Color.red(`Invalid --sort "${sortField}". Use one of: ${SORTS.join(', ')}.`))
      process.exit(1)
    }

    const spinner = new Spinner({ text: 'Fetching repos...' })
    spinner.start()

    let repos
    try {
      if (options.org) {
        repos = await gh(`/orgs/${options.org}/repos?type=${access}&per_page=100`)
      } else {
        repos = await gh(`/user/repos?visibility=${access}&affiliation=owner&per_page=100`)
      }
    } catch {
      spinner.fail('Could not fetch repos. Run `gh auth login`, or check the org name.')
      process.exit(1)
    }

    spinner.stop()

    if (!options.forks) repos = repos.filter((r) => !r.fork)
    if (options.archived) repos = repos.filter((r) => r.archived)

    if (!repos.length) {
      console.log(Color.faint('No repos found.'))
      return
    }

    repos.sort((a, b) => {
      if (sortField === 'name') return a.full_name.localeCompare(b.full_name)
      const aVal = a[`${sortField}_at`] ?? ''
      const bVal = b[`${sortField}_at`] ?? ''
      return aVal < bVal ? -1 : aVal > bVal ? 1 : 0
    })

    if (options.desc) repos.reverse()

    const nameWidth = Math.max(...repos.map((r) => r.full_name.length))

    console.log()
    for (const repo of repos) {
      const name = repo.full_name.padEnd(nameWidth)

      const visibility = repo.private
        ? Color.yellow('private')
        : Color.green('public ')

      const archivedTag = repo.archived ? `  ${Color.faint('archived')}` : ''

      console.log(`  ${Color.bold(name)}  ${visibility}${archivedTag}`)
    }

    const total = repos.length
    const priv = repos.filter((r) => r.private).length
    const pub = repos.filter((r) => !r.private).length
    const arc = repos.filter((r) => r.archived).length

    const parts = [
      Color.bold(`${total}`),
      'repos',
      `· ${Color.green(pub)} public`,
      `· ${Color.yellow(priv)} private`,
    ]
    if (arc) parts.push(`· ${Color.faint(arc)} archived`)

    console.log(`\n  ${parts.join(' ')}\n`)
  })
