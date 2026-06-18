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

// termkit's Color.* are getters on a shared mutable builder — storing them in a
// map accumulates styles, so resolve the color fresh at call time instead.
function enforcementColor(enforcement, text) {
  if (enforcement === 'active') return Color.green(text)
  if (enforcement === 'evaluate') return Color.yellow(text)
  if (enforcement === 'disabled') return Color.faint(text)
  return text
}

function repoLabel(repo) {
  return `${Color.faint(`${repo.owner}/`)}${Color.bold(repo.name)}${repo.private ? Color.faint(' (private)') : ''}`
}

export const command = Program.command('rulesets')
  .description('Show your repos and their ruleset status. Requires `gh auth login`.')
  .option('o', 'org', '<org>', 'Target an organization instead of your personal repos')
  .option('a', 'access', '<access>', 'Which repos to include: all, private, or public (default: public)')
  .option('m', 'missing', null, 'Only show repos that have no ruleset')
  .action(async (options) => {
    const access = (options.access ?? 'public').toLowerCase()
    if (!['all', 'private', 'public'].includes(access)) {
      console.error(Color.red(`Invalid --access "${access}". Use one of: all, private, public.`))
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

    repos = repos
      .filter((repo) => !repo.archived)
      .map((repo) => ({ name: repo.name, owner: repo.owner.login, full_name: repo.full_name, private: repo.private }))
      .sort((a, b) => a.full_name.localeCompare(b.full_name))

    const scope = options.org ? options.org : 'personal'

    if (!repos.length) {
      spinner.succeed(`No ${scope} repos found.`)
      return
    }

    spinner.stop()
    console.log(Color.bold(`\n${repos.length} ${scope} repos${access !== 'all' ? ` · ${access}` : ''}\n`))

    let withCount = 0
    let done = 0
    const loader = new Spinner({ text: `0/${repos.length}` })
    loader.start()

    for (const repo of repos) {
      loader.message(`${done}/${repos.length}  ${Color.faint(repo.full_name)}`)
      let rulesets = []
      try {
        rulesets = await gh(`/repos/${repo.full_name}/rulesets`)
      } catch {
        // API error means no access or rulesets not available — treat as none
      }
      done++

      if (rulesets.length) withCount++

      if (options.missing) {
        if (!rulesets.length) {
          loader.stop()
          console.log(`  ${repoLabel(repo)}  ${Color.yellow('no ruleset')}`)
          loader.start()
        }
        continue
      }

      loader.stop()
      if (!rulesets.length) {
        console.log(`  ${repoLabel(repo)}  ${Color.yellow('no ruleset')}`)
      } else {
        console.log(`  ${repoLabel(repo)}`)
        for (const ruleset of rulesets) {
          const target = ruleset.target ? Color.faint(`[${ruleset.target}]`) : ''
          console.log(`    ${Color.cyan(ruleset.name)}  ${enforcementColor(ruleset.enforcement, ruleset.enforcement)} ${target}`)
        }
      }
      loader.start()
    }

    const withoutCount = repos.length - withCount
    if (options.missing) {
      loader.succeed(withoutCount ? `${withoutCount} of ${repos.length} ${scope} repos have no ruleset` : `All ${repos.length} ${scope} repos have a ruleset`)
    } else {
      loader.succeed(`${withCount} with rulesets, ${withoutCount} without`)
    }
  })
