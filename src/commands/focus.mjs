import { execSync } from 'node:child_process'

import { command as createCommand } from 'termkit'

export const command = createCommand('focus')
  .description('Bring an application to the front')
  .variable('[app]')
  .action((args) => {
    const app = args.app ?? 'Terminal'
    execSync(`osascript -e 'tell application "${app}" to activate'`)
  })
