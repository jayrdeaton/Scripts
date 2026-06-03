# Email Extractor CLI

A command-line tool that reads CSV files containing URLs, visits each URL using Puppeteer, extracts email addresses from the web pages, and outputs an updated CSV file with the email addresses added.

## Features

- 📁 Processes CSV files with URL columns
- 🤖 Uses Puppeteer for web scraping
- 📧 Multiple email extraction strategies:
  - Mailto links
  - Email patterns in visible text
  - Filters out common false positives
- ⚡ Concurrent processing with configurable limits
- 📊 Progress tracking and statistics
- 🎨 Colorized output with status indicators
- ⚙️ Configurable timeouts and delays

## Installation

1. Install dependencies:
```bash
npm install
```

2. Make the CLI executable (optional):
```bash
npm link
```

## Usage

### Basic Usage

```bash
node bin/cli.js extract -i input.csv -c "website" -o output.csv
```

### Command Options

```bash
email-extractor extract [options]

Options:
  -i, --input <file>          Input CSV file path (required)
  -c, --column <name>         Column name containing URLs (required)
  -o, --output <file>         Output CSV file path (optional)
  -t, --timeout <ms>          Page load timeout in milliseconds (default: 30000)
  -d, --delay <ms>            Delay between requests in milliseconds (default: 1000)
  --headless <boolean>        Run browser in headless mode (default: true)
  --max-concurrent <number>   Maximum concurrent browser instances (default: 3)
```

### Examples

1. **Basic extraction:**
```bash
node bin/cli.js extract -i companies.csv -c "website"
```

2. **With custom output file:**
```bash
node bin/cli.js extract -i data.csv -c "url" -o results_with_emails.csv
```

3. **With custom settings:**
```bash
node bin/cli.js extract -i input.csv -c "website" --timeout 45000 --delay 2000 --max-concurrent 5
```

4. **Show examples:**
```bash
node bin/cli.js example
```

## CSV Format

### Input CSV
Your input CSV should have a column containing URLs:

```csv
company_name,website,industry
"Example Corp","https://example.com","Technology"
"Test Inc","https://test.org","Services"
"Demo LLC","https://demo.net","Consulting"
```

### Output CSV
The tool will add an "email" column:

```csv
company_name,website,industry,email
"Example Corp","https://example.com","Technology","contact@example.com"
"Test Inc","https://test.org","Services","info@test.org"
"Demo LLC","https://demo.net","Consulting",""
```

## How It Works

1. **CSV Reading:** Parses the input CSV file and identifies the URL column
2. **Browser Launch:** Starts a headless Chromium browser using Puppeteer
3. **Concurrent Processing:** Visits URLs in parallel (respecting concurrency limits)
4. **Email Extraction:** Uses multiple strategies to find email addresses:
   - Searches for `mailto:` links
   - Scans visible page text for email patterns
   - Filters out common placeholder emails
5. **Result Writing:** Outputs a new CSV with email addresses added

## Configuration

### Timeouts and Delays
- `--timeout`: How long to wait for a page to load (default: 30 seconds)
- `--delay`: Wait time between processing URLs (default: 1 second)

### Concurrency
- `--max-concurrent`: Number of browser instances to run simultaneously (default: 3)
- Higher values = faster processing but more resource usage

### Browser Mode
- `--headless true`: Run browser in background (default)
- `--headless false`: Show browser windows (useful for debugging)

## Error Handling

The tool handles various error scenarios:
- Invalid URLs are skipped
- Network timeouts are caught and logged
- Browser crashes are recovered from
- Malformed CSV data is handled gracefully

## Performance Tips

1. **Adjust concurrency:** Start with 3 concurrent instances, increase if your system can handle it
2. **Set appropriate delays:** Some websites may block rapid requests
3. **Use reasonable timeouts:** Very slow sites might need longer timeouts
4. **Monitor resource usage:** Watch CPU and memory usage during large batch processing

## Limitations

- Only extracts the first email found on each page
- May not work with heavily JavaScript-dependent sites
- Some sites may block automated browsing
- Contact page crawling is not yet implemented

## Troubleshooting

### Common Issues

1. **"Input file does not exist"**
   - Check the file path is correct
   - Use absolute paths if needed

2. **"No emails found"**
   - Check if the URLs are accessible
   - Try running with `--headless false` to see what's happening
   - Increase timeout for slow-loading sites

3. **Memory issues with large files**
   - Reduce `--max-concurrent` value
   - Process files in smaller batches

### Debug Mode

Run with visible browser windows to debug:
```bash
node bin/cli.js extract -i input.csv -c "website" --headless false --max-concurrent 1
```

## License

ISC