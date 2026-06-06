import { writeFile } from 'node:fs/promises'

import { Color, command as createCommand, Spinner } from 'termkit'

const RDAP = {
  com: 'https://rdap.verisign.com/com/v1',
  net: 'https://rdap.verisign.com/net/v1',
  org: 'https://rdap.publicinterestregistry.org/rdap/org/v1',
  io: 'https://rdap.nic.io/v1'
}

const ALPHA = 'abcdefghijklmnopqrstuvwxyz'.split('')

function expandPattern(pattern) {
  const dot = pattern.lastIndexOf('.')
  if (dot === -1) throw new Error(`Pattern must include a TLD, e.g. ??fu.com`)
  const namePart = pattern.slice(0, dot).toLowerCase()
  const tld = pattern.slice(dot + 1).toLowerCase()
  if (!RDAP[tld]) throw new Error(`.${tld} is not supported — supported TLDs: ${Object.keys(RDAP).join(', ')}`)

  function expand(s) {
    const i = s.indexOf('?')
    if (i === -1) return [s]
    return ALPHA.flatMap((c) => expand(s.slice(0, i) + c + s.slice(i + 1)))
  }

  return expand(namePart).map((n) => `${n}.${tld}`)
}

async function isAvailable(domain) {
  const tld = domain.slice(domain.lastIndexOf('.') + 1)
  const res = await fetch(`${RDAP[tld]}/domain/${domain}`, { signal: AbortSignal.timeout(10_000) })
  if (res.status === 404) return true
  if (res.ok) return false
  throw new Error(`HTTP ${res.status}`)
}

async function withConcurrency(items, limit, fn) {
  let i = 0
  async function worker() {
    while (i < items.length) {
      const item = items[i++]
      await fn(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

export const command = createCommand('check-domains')
  .description('Check domain availability via RDAP for a wildcard pattern (? = any letter)')
  .variable('[pattern]')
  .option('c', 'concurrency', '<n>', 'Concurrent requests (default: 5)')
  .option('o', 'output', '<file>', 'Write available domains to a file')
  .action(async (args) => {
    const pattern = args.pattern
    if (!pattern) {
      console.error(Color.red('Usage: jrd check-domains <pattern>  e.g. ??fu.com or ???.io'))
      process.exit(1)
    }

    const concurrency = Math.max(1, parseInt(args.concurrency ?? '5', 10))

    let domains
    try {
      domains = expandPattern(pattern)
    } catch (err) {
      console.error(Color.red(err.message))
      process.exit(1)
    }

    const available = []
    let checked = 0
    let errors = 0

    const spinner = new Spinner({ text: `0/${domains.length}` })
    spinner.start()

    await withConcurrency(domains, concurrency, async (domain) => {
      try {
        const ok = await isAvailable(domain)
        checked++
        spinner.message(`${checked}/${domains.length}  ${Color.faint(domain)}`)
        if (ok) {
          available.push(domain)
          spinner.stop()
          console.log(`  ${Color.green(domain)}`)
          spinner.start()
          spinner.message(`${checked}/${domains.length}  ${Color.faint(domain)}`)
        }
      } catch {
        errors++
        checked++
      }
    })

    if (args.output && available.length > 0) {
      await writeFile(args.output, available.join('\n') + '\n')
      spinner.succeed(`${available.length} available · saved to ${args.output}` + (errors > 0 ? Color.faint(`  (${errors} errors)`) : ''))
    } else {
      spinner.succeed(`${available.length} available of ${domains.length}` + (errors > 0 ? Color.faint(`  (${errors} errors)`) : ''))
    }
  })
