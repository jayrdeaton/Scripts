import puppeteer from 'puppeteer';
import fs from 'fs';
import csv from 'csv-parser';
import { createObjectCsvWriter } from 'csv-writer';
import path from 'path';
import chalk from 'chalk';

class EmailExtractor {
  constructor(options) {
    this.inputFile = options.inputFile;
    this.outputFile = options.outputFile;
    this.urlColumnIndex = options.urlColumnIndex || 0;
    this.timeout = options.timeout || 30000;
    this.delay = options.delay || 1000;
    this.headless = options.headless !== false;
    this.maxConcurrent = options.maxConcurrent || 3;
    this.browser = null;
    this.stats = {
      total: 0,
      processed: 0,
      emailsFound: 0,
      errors: 0
    };
  }

  async processFile() {
    console.log(chalk.blue('📊 Reading CSV file...'));
    
    const rows = await this.readCsvFile();
    this.stats.total = rows.length;
    
    console.log(chalk.blue(`📋 Found ${rows.length} rows to process`));
    
    // Launch browser
    console.log(chalk.blue('🚀 Launching browser...'));
    this.browser = await puppeteer.launch({
      headless: this.headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
      // Process URLs in batches
      const results = await this.processUrlsBatch(rows);
      
      // Write results to CSV
      console.log(chalk.blue('💾 Writing results to CSV...'));
      await this.writeCsvFile(results);
      
      this.printStats();
      
    } finally {
      await this.browser.close();
    }
  }

  async readCsvFile() {
    return new Promise((resolve, reject) => {
      const rows = [];
      fs.createReadStream(this.inputFile)
        .pipe(csv({ headers: false }))
        .on('data', (row) => {
          // Convert object with numeric keys to array
          const rowArray = Object.values(row);
          rows.push(rowArray);
        })
        .on('end', () => resolve(rows))
        .on('error', reject);
    });
  }

  async processUrlsBatch(rows) {
    const results = [];
    const semaphore = new Semaphore(this.maxConcurrent);

    const promises = rows.map(async (row, index) => {
      return semaphore.acquire(async () => {
        const url = row[this.urlColumnIndex];
        if (!url || !this.isValidUrl(url)) {
          console.log(chalk.yellow(`⚠️  Row ${index + 1}: Invalid or missing URL`));
          this.stats.errors++;
          return [...row, ''];
        }

        try {
          console.log(chalk.gray(`🔍 Processing ${index + 1}/${rows.length}: ${url}`));
          const email = await this.extractEmailFromPage(url);
          
          if (email) {
            console.log(chalk.green(`✅ Found email: ${email}`));
            this.stats.emailsFound++;
          } else {
            console.log(chalk.yellow(`❌ No email found for ${url}`));
          }
          
          this.stats.processed++;
          
          // Add delay between requests
          if (this.delay > 0) {
            await this.sleep(this.delay);
          }
          
          return [...row, email || ''];
          
        } catch (error) {
          console.log(chalk.red(`❌ Error processing ${url}: ${error.message}`));
          this.stats.errors++;
          return [...row, ''];
        }
      });
    });

    const processedResults = await Promise.all(promises);
    return processedResults;
  }

  async extractEmailFromPage(url) {
    const page = await this.browser.newPage();
    
    try {
      // Set user agent to avoid being blocked
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      // Navigate to page
      await page.goto(url, { 
        waitUntil: 'networkidle2', 
        timeout: this.timeout 
      });

      // Wait a bit for dynamic content to load
      await this.sleep(1000);

      // Extract email using multiple strategies
      const email = await page.evaluate(() => {
        // Email regex pattern
        const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
        
        // Strategy 1: Look for mailto links
        const mailtoLinks = Array.from(document.querySelectorAll('a[href^="mailto:"]'));
        if (mailtoLinks.length > 0) {
          const href = mailtoLinks[0].href;
          const match = href.match(/mailto:([^?&]+)/);
          if (match) return match[1];
        }
        
        // Strategy 2: Search in visible text content
        const textContent = document.body.innerText || document.body.textContent || '';
        const emailMatches = textContent.match(emailRegex);
        
        if (emailMatches && emailMatches.length > 0) {
          // Filter out common false positives
          const filtered = emailMatches.filter(email => {
            const lowerEmail = email.toLowerCase();
            return !lowerEmail.includes('example.com') &&
                   !lowerEmail.includes('test.com') &&
                   !lowerEmail.includes('domain.com') &&
                   !lowerEmail.includes('yoursite.com') &&
                   !lowerEmail.includes('yourdomain.com') &&
                   !lowerEmail.includes('sample.com');
          });
          
          if (filtered.length > 0) {
            return filtered[0]; // Return first valid email found
          }
        }
        
        // Strategy 3: Check contact pages if on homepage
        const contactLinks = Array.from(document.querySelectorAll('a'))
          .filter(link => {
            const text = link.textContent.toLowerCase();
            const href = link.href.toLowerCase();
            return text.includes('contact') || href.includes('contact');
          });
        
        // Store contact page URLs for potential future enhancement
        if (contactLinks.length > 0 && window.location.pathname === '/') {
          // Could implement contact page crawling here
        }
        
        return null;
      });

      return email;

    } finally {
      await page.close();
    }
  }

  async writeCsvFile(data) {
    if (data.length === 0) {
      throw new Error('No data to write');
    }

    // Convert array data to CSV format
    const csvContent = data.map(row => 
      row.map(cell => {
        // Escape cells that contain commas, quotes, or newlines
        if (typeof cell === 'string' && (cell.includes(',') || cell.includes('"') || cell.includes('\n'))) {
          return `"${cell.replace(/"/g, '""')}"`;
        }
        return cell;
      }).join(',')
    ).join('\n');

    fs.writeFileSync(this.outputFile, csvContent);
  }

  isValidUrl(string) {
    try {
      const url = new URL(string);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
      return false;
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  printStats() {
    console.log('');
    console.log(chalk.blue('📊 Extraction Statistics:'));
    console.log(chalk.gray('─'.repeat(30)));
    console.log(`${chalk.blue('Total rows:')} ${this.stats.total}`);
    console.log(`${chalk.blue('Processed:')} ${this.stats.processed}`);
    console.log(`${chalk.green('Emails found:')} ${this.stats.emailsFound}`);
    console.log(`${chalk.red('Errors:')} ${this.stats.errors}`);
    console.log(`${chalk.yellow('Success rate:')} ${((this.stats.emailsFound / this.stats.processed) * 100).toFixed(1)}%`);
    console.log('');
  }
}

// Simple semaphore implementation for controlling concurrency
class Semaphore {
  constructor(permits) {
    this.permits = permits;
    this.queue = [];
  }

  async acquire(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.process();
    });
  }

  process() {
    if (this.permits > 0 && this.queue.length > 0) {
      this.permits--;
      const { fn, resolve, reject } = this.queue.shift();
      
      Promise.resolve()
        .then(() => fn())
        .then(resolve)
        .catch(reject)
        .finally(() => {
          this.permits++;
          this.process();
        });
    }
  }
}

export default EmailExtractor;