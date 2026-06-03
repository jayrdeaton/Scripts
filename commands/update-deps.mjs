import cosmetic from "cosmetic";
import { command as createCommand } from "termkit";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function exec(cmd) {
  console.log(cosmetic.faint(`$ ${cmd}`));
  execSync(cmd, { stdio: "inherit" });
}

function latestPackages(deps = {}) {
  return Object.keys(deps).map((name) => `${name}@latest`);
}

export const command = createCommand("update-deps")
  .description("Update all npm deps to @latest, then run expo install --fix if applicable")
  .option("d", "dev", null, "Only update devDependencies")
  .option("p", "prod", null, "Only update dependencies")
  .option("l", "legacy", null, "Pass --legacy-peer-deps to npm install")
  .action(async (options) => {
    const pkgPath = resolve(process.cwd(), "package.json");
    let pkg;

    try {
      pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    } catch {
      console.error(cosmetic.red("No package.json found in current directory."));
      process.exit(1);
    }

    const prodDeps = latestPackages(pkg.dependencies);
    const devDeps = latestPackages(pkg.devDependencies);
    const legacyFlag = options.legacy ? " --legacy-peer-deps" : "";

    if (!options.dev && prodDeps.length) {
      console.log(cosmetic.bold.cyan("\nUpdating dependencies..."));
      exec(`npm install${legacyFlag} ${prodDeps.join(" ")}`);
    }

    if (!options.prod && devDeps.length) {
      console.log(cosmetic.bold.cyan("\nUpdating devDependencies..."));
      exec(`npm install --save-dev${legacyFlag} ${devDeps.join(" ")}`);
    }

    const hasExpo =
      pkg.dependencies?.expo !== undefined ||
      pkg.devDependencies?.expo !== undefined;

    if (hasExpo) {
      console.log(cosmetic.bold.cyan("\nFixing Expo managed versions..."));
      exec(`npx expo install --fix${options.legacy ? " -- --legacy-peer-deps" : ""}`);
    }

    console.log(cosmetic.bold.green("\nDone."));
  });
