import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

import { Color, Program } from 'termkit'

export const command = Program.command('binary')
  .description('Encode or decode binary strings')
  .commands([
    Program.command('encode')
      .description('Encode a file to a binary string')
      .variable('<file>')
      .option('c', 'copy', null, 'copy result to clipboard')
      .option('o', 'output', '<dest>', 'write result to a file')
      .action(({ file, copy, output }) => {
        if (!existsSync(file)) throw new Error(`${file} not found`)
        const result = JSON.stringify(readFileSync(file, 'binary'))
        if (copy) {
          execSync('pbcopy', { input: result })
          console.log(`${Color.green('Success:')} Copied binary string to clipboard`)
        } else if (output) {
          writeFileSync(output, result)
          console.log(`${Color.green('Success:')} Wrote binary string to ${output}`)
        } else {
          console.log(result)
        }
      }),

    Program.command('decode')
      .description('Restore a binary string file back to its original format')
      .variable('<file>')
      .variable('<destination>')
      .action(({ file, destination }) => {
        if (!existsSync(file)) throw new Error(`${file} not found`)
        const buf = Buffer.from(JSON.parse(readFileSync(file, 'utf8')), 'binary')
        writeFileSync(destination, buf)
        console.log(`${Color.green('Success:')} Restored ${file} to ${destination}`)
      })
  ])
