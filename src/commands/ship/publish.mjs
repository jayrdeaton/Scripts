import { Program } from 'termkit'

import { publishDraft, releaseTarget } from '../../lib/release.mjs'

// `jrd ship publish`: the draft `jrd ship draft` made and wasn't told to publish, published once it's been looked at
// and only after a yes. The draft's files were checked against their feeds and GitHub's hashes when it was made; this
// checks the feeds it holds against its files once more (someone may have edited it since), then that every
// file answers at its download link.
export const command = Program.command('publish')
  .description("Publish the draft ship draft made for package.json's version of the Electron app in the current directory, after showing it and asking (ship draft asks too, at its end; this is for publishing later): checks its update feeds against its files and that it's newer than the latest release, publishes it as the latest, then checks that every file answers at its download link")
  .option('y', 'yes', null, "Publish without asking (only once you've checked the draft)")
  .action(async (options) => {
    await publishDraft(releaseTarget(process.cwd()), { yes: Boolean(options.yes) })
  })
