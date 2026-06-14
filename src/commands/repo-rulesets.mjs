import { execSync } from 'node:child_process'

import { Color, Program, Spinner } from 'termkit'

function gh(path) {
  const out = execSync(`gh api "${path}" --paginate`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  })
  return JSON.parse(out)
}

export const command = Program.command('repo-rulesets')
  .description('Find public repos that have no ruleset attached')
  .option('u', 'user', '<user>', 'GitHub username (defaults to authenticated user)')
  .action(async (options) => {
    const spinner = new Spinner({ text: 'Resolving user...' })
    spinner.start()

    let user = options.user
    if (!user) {
      try {
        const data = gh('/user')
        user = data.login
      } catch {
        spinner.fail('Could not resolve GitHub user. Run `gh auth login` or pass --user.')
        process.exit(1)
      }
    }

    spinner.message(`Fetching public repos for ${user}...`)

    let repos
    try {
      repos = gh(`/users/${user}/repos?type=public&per_page=100`)
    } catch {
      spinner.fail(`Could not fetch repos for ${user}.`)
      process.exit(1)
    }

    if (!repos.length) {
      spinner.succeed(`No public repos found for ${user}.`)
      return
    }

    spinner.message(`Checking rulesets across ${repos.length} repos...`)

    const missing = []

    for (const repo of repos) {
      spinner.message(repo.name)
      try {
        const rulesets = gh(`/repos/${user}/${repo.name}/rulesets`)
        if (!rulesets.length) missing.push(repo.name)
      } catch {
        // API error means no access or rulesets not available — treat as missing
        missing.push(repo.name)
      }
    }

    if (!missing.length) {
      spinner.succeed(`All ${repos.length} public repos have a ruleset.`)
      return
    }

    spinner.stop()

    console.log(Color.bold.yellow(`\nNo ruleset (${missing.length} of ${repos.length})\n`))
    for (const name of missing) {
      console.log(`  ${Color.yellow(name)}`)
    }
    console.log()
  })
