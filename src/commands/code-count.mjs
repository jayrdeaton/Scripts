import { createReadStream, existsSync, lstatSync, readdirSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'

import cosmetic from 'cosmetic'
import { command as createCommand } from 'termkit'

const WHITELIST = new Set([
  '.cjs', '.css', '.csv', '.ejs', '.env', '.gitignore', '.haml', '.html', '.java',
  '.js', '.json', '.mjs', '.paw', '.plist', '.py', '.rake', '.scss', '.sh', '.sql',
  '.stl', '.swift', '.ts', '.tsx', '.txt', '.xib', '.xml', '.yaml', '.yml',
])

const SKIP = new Set([
  '.DS_Store', '.git', 'Carthage', 'Dockerfile', 'LICENSE', 'Test',
  'node_modules', 'package-lock.json',
])

function getFiles(base, { ignore = [], recursive = false } = {}) {
  try {
    base = resolve(base)
    if (!lstatSync(base).isDirectory()) {
      return existsSync(base) ? [base] : []
    }
    const paths = []
    for (const item of readdirSync(base)) {
      const ext = extname(item)
      if (SKIP.has(item) || ignore.includes(item) || ignore.includes(`*${ext}`)) continue
      const full = join(base, item)
      const isDir = lstatSync(full).isDirectory()
      if (recursive && isDir) {
        paths.push(...getFiles(full, { ignore, recursive }))
      } else if (!isDir && WHITELIST.has(ext)) {
        paths.push(full)
      }
    }
    return paths
  } catch (err) {
    console.log(`error reading ${base}: ${err.message}`)
    return []
  }
}

function countLines(path) {
  return new Promise((res) => {
    let count = 0
    createReadStream(path)
      .on('data', (chunk) => {
        for (let i = 0; i < chunk.length; i++) if (chunk[i] === 10) count++
      })
      .on('error', () => res(0))
      .on('end', () => res(count))
  })
}

function commaString(n) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export const command = createCommand('code-count')
  .description('Count lines of code by file type')
  .variable('[paths...]')
  .option('i', 'ignore', '[types...]', 'ignore files or file types')
  .option('r', 'recursive', null, 'scan folders recursively')
  .action(async (args) => {
    let { ignore, paths, recursive } = args
    if (!paths || paths.length === 0) paths = ['.']
    if (!ignore) ignore = []
    ignore = ignore.reduce((a, i) => (a.includes(`*${extname(i)}`) ? a : [...a, `*${extname(i)}`]), [])

    const allPaths = paths.flatMap((p) => getFiles(p, { ignore, recursive }))

    const totals = {}
    for (let i = 0; i < allPaths.length; i++) {
      const path = allPaths[i]
      const ext = extname(path)
      if (!ext) continue
      process.stdout.write(`checking files ${i + 1} / ${allPaths.length}\r`)
      totals[ext] = (totals[ext] ?? 0) + (await countLines(path))
    }
    if (process.stdout.clearLine) process.stdout.clearLine(0)

    for (const key of Object.keys(totals).sort()) {
      console.log(`${key}: ${cosmetic.cyan(commaString(totals[key]))}`)
    }
    const total = Object.values(totals).reduce((a, n) => a + n, 0)
    console.log(`total ${cosmetic.cyan(commaString(total))} in ${cosmetic.cyan(String(allPaths.length))} files`)
  })
