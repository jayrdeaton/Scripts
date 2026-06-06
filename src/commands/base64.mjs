import { existsSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

import { Color, Program } from 'termkit'

function resolveInput(value, file) {
  if (file) {
    if (!existsSync(value)) throw new Error(`${value} not found`)
    return readFileSync(value)
  }
  return value
}

function output(result, copy) {
  if (copy) {
    execSync('pbcopy', { input: result })
    console.log(`${Color.green('Success:')} Copied to clipboard`)
  } else {
    console.log(result)
  }
}

export const command = Program.command('base64')
  .description('Encode or decode base64')
  .commands([
    Program.command('encode')
      .description('Encode a string or file to base64')
      .variable('<value>')
      .option('f', 'file', null, 'treat value as a file path')
      .option('c', 'copy', null, 'copy result to clipboard')
      .action(({ value, file, copy }) => {
        const input = resolveInput(value, file)
        const result = Buffer.from(input).toString('base64')
        output(result, copy)
      }),

    Program.command('decode')
      .description('Decode a base64 string')
      .variable('<value>')
      .option('c', 'copy', null, 'copy result to clipboard')
      .action(({ value, copy }) => {
        const result = Buffer.from(value, 'base64').toString('utf8')
        output(result, copy)
      }),
  ])
