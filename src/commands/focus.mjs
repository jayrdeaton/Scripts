import { execSync } from 'node:child_process'

import { Program } from 'termkit'

export const command = Program.command('focus')
  .description('Bring an application to the front')
  .variable('[app]')
  .action((args) => {
    const app = args.app ?? 'Terminal'
    execSync(`osascript -e 'tell application "${app}" to activate'`)
  })
