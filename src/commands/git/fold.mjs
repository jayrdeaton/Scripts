import { execFileSync } from 'node:child_process'

import { Color, confirm, input, Program, select } from 'termkit'

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

export const command = Program.command('fold')
  .description('Squash the last N commits into one with a new message (soft reset + recommit)')
  .variable('[count]')
  .option('m', 'message', '<msg>', 'Message for the combined commit')
  .option('f', 'force', null, 'Skip the confirmation prompt')
  .action(async (options) => {
    try {
      git(['rev-parse', '--is-inside-work-tree'])
    } catch {
      console.error(Color.red('Not a git repository.'))
      process.exit(1)
    }

    const total = parseInt(git(['rev-list', '--count', 'HEAD']), 10)
    if (total < 2) {
      console.error(Color.red('Need at least 2 commits to fold.'))
      process.exit(1)
    }

    const limit = Math.min(total, 30)
    const lines = git(['log', '--oneline', '--no-decorate', '-n', String(limit)]).split('\n')

    let count = options.count != null ? parseInt(options.count, 10) : null
    if (count != null && (!Number.isInteger(count) || count < 2)) {
      console.error(Color.red('Count must be an integer ≥ 2.'))
      process.exit(1)
    }
    if (count != null && count >= total) {
      console.error(Color.red(`Cannot fold ${count} commits — that includes the initial commit. Max is ${total - 1}.`))
      process.exit(1)
    }

    if (count == null) {
      // Pick the OLDEST commit to include; everything from HEAD down to it folds into one.
      // Exclude the newest (would be a no-op) and the root (can't soft-reset past it).
      const maxIndex = Math.min(limit - 1, total - 2)
      const items = lines.slice(1, maxIndex + 1).map((line, idx) => ({
        label: line,
        description: `fold the top ${idx + 2} commits → 1`
      }))
      const choice = await select('Fold down to and including which commit?', items, { search: true })
      if (!choice) return console.log('Aborted.')
      count = lines.indexOf(choice.label) + 1
    }

    let message = options.message
    if (!message) {
      const fallback = git(['log', '-1', '--format=%s', `HEAD~${count - 1}`])
      const answer = await input('New commit message', { default: fallback, required: true })
      if (answer == null) return console.log('Aborted.')
      message = answer
    }

    const staged = git(['status', '--porcelain'])
      .split('\n')
      .filter((l) => l && l[0] !== ' ' && l[0] !== '?')

    console.log()
    console.log(`  Folding ${Color.bold(String(count))} commits into one:`)
    for (const line of lines.slice(0, count)) console.log(`    ${Color.faint(line)}`)
    console.log()
    console.log(`  New message: ${Color.green(message)}`)
    if (staged.length) {
      console.log(Color.yellow(`  ⚠ ${staged.length} already-staged change${staged.length !== 1 ? 's' : ''} will be folded in too.`))
    }
    console.log(Color.faint(`  → git reset --soft HEAD~${count} && git commit -m …`))
    console.log()

    if (!options.force) {
      const ok = await confirm('Proceed?', { default: false })
      if (!ok) return console.log('Aborted.')
    }

    execFileSync('git', ['reset', '--soft', `HEAD~${count}`], { stdio: 'inherit' })
    execFileSync('git', ['commit', '-m', message], { stdio: 'inherit' })
    console.log(Color.green(`✓ Folded ${count} commits into one.`))
  })
