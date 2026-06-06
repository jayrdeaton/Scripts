import { Color, Program, Spinner } from 'termkit'

async function isAvailable(name) {
  try {
    const encoded = name.startsWith('@') ? name.replace('/', '%2F') : name
    const res = await fetch(`https://registry.npmjs.org/${encoded}`, { method: 'HEAD' })
    return res.status === 404
  } catch {
    return null
  }
}

function getVariants(name) {
  const normalized = name.replace(/[-_]/g, ' ').trim()
  if (!normalized.includes(' ')) return [normalized]

  const nospace = normalized.replace(/ /g, '')
  const hyphenated = normalized.replace(/ /g, '-')
  const underscored = normalized.replace(/ /g, '_')
  return [...new Set([nospace, hyphenated, underscored])]
}

async function getSynonyms(word) {
  try {
    const base = word.replace(/[-_]/g, ' ').trim().split(' ')[0]
    const res = await fetch(`https://api.datamuse.com/words?ml=${encodeURIComponent(base)}&max=20`)
    if (!res.ok) return []
    const data = await res.json()
    return data.map((w) => w.word).filter((w) => !w.includes(' '))
  } catch {
    return []
  }
}

export const command = Program.command('npm-namer')
  .description('Check npm package name availability, including variations')
  .variable('<name>')
  .option('s', 'synonyms', null, 'Also check synonyms of the name')
  .action(async (args) => {
    const { name, synonyms } = args
    const spinner = new Spinner({ text: 'Checking availability...' })
    spinner.start()

    const namesToCheck = new Set(getVariants(name))

    if (synonyms) {
      spinner.message('Fetching synonyms...')
      const syns = await getSynonyms(name)
      for (const syn of syns) {
        for (const variant of getVariants(syn)) {
          namesToCheck.add(variant)
        }
      }
      spinner.message(`Checking ${namesToCheck.size} names...`)
    }

    const results = await Promise.all([...namesToCheck].map(async (n) => ({ name: n, available: await isAvailable(n) })))

    spinner.stop()

    const available = results.filter((r) => r.available === true)
    const taken = results.filter((r) => r.available === false)
    const errored = results.filter((r) => r.available === null)

    console.log()
    for (const { name: n, available: avail } of results) {
      if (avail === true) console.log(`  ${Color.green('✓')}  ${n}`)
      else if (avail === false) console.log(`  ${Color.red('✗')}  ${Color.faint(n)}`)
      else console.log(`  ${Color.yellow('?')}  ${Color.faint(n)}`)
    }

    const parts = [`${available.length} available`, `${taken.length} taken`]
    if (errored.length > 0) parts.push(`${errored.length} error`)
    console.log(`\n${Color.faint(parts.join(' · '))}`)
  })
