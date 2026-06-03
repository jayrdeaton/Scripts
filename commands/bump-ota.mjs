import cosmetic from "cosmetic";
import { command as createCommand } from "termkit";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const command = createCommand("bump-ota")
  .description("Bump otaVersion in src/constants/release.ts and commit")
  .option("f", "file", "[file]", "Path to release file (default: src/constants/release.ts)")
  .action(async (options) => {
    const filePath = resolve(process.cwd(), options.file ?? "src/constants/release.ts");

    try {
      const status = execSync("git status --porcelain").toString().trim();
      if (status) {
        console.error(cosmetic.red("Working directory is not clean. Commit or stash changes first."));
        process.exit(1);
      }
    } catch (err) {
      console.error(cosmetic.red(`Failed to check git status: ${err.message}`));
      process.exit(1);
    }

    let source;
    try {
      source = readFileSync(filePath, "utf8");
    } catch {
      console.error(cosmetic.red(`Could not read file: ${filePath}`));
      process.exit(1);
    }

    const pattern = /(otaVersion:\s*)(\d+)/;
    const match = source.match(pattern);

    if (!match) {
      console.error(cosmetic.red(`Could not find otaVersion in ${filePath}`));
      process.exit(1);
    }

    const current = parseInt(match[2], 10);
    const next = current + 1;

    writeFileSync(filePath, source.replace(pattern, `$1${next}`));

    try {
      execSync(`git add ${filePath}`);
      execSync(`git commit -m "otaVersion ${current} -> ${next}"`);
    } catch (err) {
      console.error(cosmetic.red(`Auto-commit failed: ${err.message}`));
      process.exit(1);
    }

    console.log(cosmetic.bold.green(`otaVersion bumped: ${current} -> ${next}`));
  });
