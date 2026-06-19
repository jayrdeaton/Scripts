import { execSync } from 'node:child_process'

import { Color, Program, Spinner } from 'termkit'

async function fetchJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`)
  return res.json()
}

async function getAllPackages(username) {
  const packages = []
  const size = 250
  let from = 0

  while (true) {
    const data = await fetchJson(`https://registry.npmjs.org/-/v1/search?text=maintainer:${username}&size=${size}&from=${from}`)
    packages.push(...data.objects.map((o) => o.package.name))
    if (packages.length >= data.total || data.objects.length < size) break
    from += size
  }

  return packages
}

async function getDownloads(pkg, period) {
  try {
    const data = await fetchJson(`https://api.npmjs.org/downloads/point/${period}/${pkg}`)
    return data.downloads ?? 0
  } catch {
    return 0
  }
}

export const command = Program.command('downloads')
  .description('List all your npm packages sorted by total downloads')
  .option('u', 'user', '<name>', 'npm username (defaults to npm whoami)')
  .option('p', 'period', '<period>', 'last-day | last-week | last-month | last-year (default: last-month)')
  .option('m', 'mtd', null, 'Use month-to-date instead of rolling 30 days')
  .action(async (options) => {
    const spinner = new Spinner({ text: 'Resolving username...' })
    spinner.start()

    let username = options.user
    if (!username) {
      try {
        username = execSync('npm whoami', {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore']
        }).trim()
      } catch {
        spinner.fail('Could not determine npm username. Use --user <name> or run `npm login`.')
        process.exit(1)
      }
    }

    let period = options.period ?? 'last-month'
    if (options.mtd) {
      const now = new Date()
      const yyyy = now.getFullYear()
      const mm = String(now.getMonth() + 1).padStart(2, '0')
      const dd = String(now.getDate()).padStart(2, '0')
      period = `${yyyy}-${mm}-01:${yyyy}-${mm}-${dd}`
    }

    spinner.update(`Fetching packages for ${username}...`)
    const packages = await getAllPackages(username)

    if (packages.length === 0) {
      spinner.warn(`No packages found for ${username}.`)
      return
    }

    spinner.update(`Fetching download counts (${period})...`)
    const results = await Promise.all(packages.map(async (name) => ({ name, downloads: await getDownloads(name, period) })))

    spinner.succeed(`${packages.length} packages · ${period}`)

    const sorted = results.sort((a, b) => b.downloads - a.downloads)
    const orgs = [...new Set(sorted.filter((p) => p.name.startsWith('@')).map((p) => p.name.split('/')[0]))]
    const maxWidth = String(sorted[0]?.downloads ?? 0).length

    console.log(`\n${Color.bold(username)} — ${Color.faint(period)}`)
    if (orgs.length > 0) console.log(Color.faint(`orgs: ${orgs.join('  ')}`))
    console.log()

    for (const { name, downloads } of sorted) {
      const count = String(downloads).padStart(maxWidth)
      const label = downloads === 0 ? Color.faint(name) : name
      console.log(`  ${Color.cyan(count)}  ${label}`)
    }

    const total = sorted.reduce((sum, p) => sum + p.downloads, 0)
    console.log(Color.faint(`\n${total.toLocaleString()} total downloads across ${sorted.length} packages`))
  })
