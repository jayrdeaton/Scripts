#!/usr/bin/env node

import { program } from 'commander';
import EmailExtractor from '../src/email-extractor.js';
import path from 'path';
import fs from 'fs';
import chalk from 'chalk';

program
  .name('email-extractor')
  .description('Extract email addresses from URLs in CSV files')
  .version('1.0.0');

program
  .command('extract')
  .description('Extract emails from URLs in CSV file')
  .requiredOption('-i, --input <file>', 'Input CSV file path')
  .option('-c, --column <number>', 'Column number containing URLs (0-based index)', '0')
  .option('-o, --output <file>', 'Output CSV file path (default: adds _with_emails to input filename)')
  .option('-t, --timeout <ms>', 'Page load timeout in milliseconds', '30000')
  .option('-d, --delay <ms>', 'Delay between requests in milliseconds', '1000')
  .option('--headless <boolean>', 'Run browser in headless mode', 'true')
  .option('--max-concurrent <number>', 'Maximum concurrent browser instances', '3')
  .action(async (options) => {
    try {
      // Validate input file
      if (!fs.existsSync(options.input)) {
        console.error(chalk.red(`Error: Input file "${options.input}" does not exist.`));
        process.exit(1);
      }

      // Generate output filename if not provided
      let outputFile = options.output;
      if (!outputFile) {
        const inputPath = path.parse(options.input);
        outputFile = path.join(inputPath.dir, `${inputPath.name}_with_emails${inputPath.ext}`);
      }

      // Parse options
      const extractorOptions = {
        inputFile: options.input,
        outputFile: outputFile,
        urlColumnIndex: parseInt(options.column),
        timeout: parseInt(options.timeout),
        delay: parseInt(options.delay),
        headless: options.headless === 'true',
        maxConcurrent: parseInt(options.maxConcurrent)
      };

      console.log(chalk.blue('Starting email extraction...'));
      console.log(chalk.gray(`Input: ${options.input}`));
      console.log(chalk.gray(`Output: ${outputFile}`));
      console.log(chalk.gray(`URL Column Index: ${options.column}`));

      const extractor = new EmailExtractor(extractorOptions);
      await extractor.processFile();

      console.log(chalk.green('✅ Email extraction completed successfully!'));
      console.log(chalk.blue(`Results saved to: ${outputFile}`));

    } catch (error) {
      console.error(chalk.red('❌ Error during extraction:'));
      console.error(chalk.red(error.message));
      if (error.stack) {
        console.error(chalk.gray(error.stack));
      }
      process.exit(1);
    }
  });

// Add example command
program
  .command('example')
  .description('Show usage examples')
  .action(() => {
    console.log(chalk.blue('Email Extractor CLI - Usage Examples:'));
    console.log('');
    console.log(chalk.yellow('Basic usage (uses column 0 by default):'));
    console.log('  email-extractor extract -i urls.csv');
    console.log('');
    console.log(chalk.yellow('With specific column number:'));
    console.log('  email-extractor extract -i companies.csv -c 1 -o results.csv');
    console.log('');
    console.log(chalk.yellow('With custom settings:'));
    console.log('  email-extractor extract -i data.csv -c 2 --timeout 45000 --delay 2000');
    console.log('');
    console.log(chalk.yellow('CSV format example:'));
    console.log('  Column 0: https://example.com');
    console.log('  Column 1: https://test.org');
    console.log('  Column 2: https://demo.net');
    console.log('');
    console.log(chalk.gray('The tool will add an email column to your CSV with extracted addresses.'));
  });

program.parse();