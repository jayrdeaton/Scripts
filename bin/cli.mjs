#!/usr/bin/env node
import { command, parse } from "termkit";
import { readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const commandsDir = resolve(__dir, "../commands");

// Must be created first so termkit registers this as the root command
const program = command("jrd").description("Personal dev scripts");

const files = readdirSync(commandsDir).filter((f) => f.endsWith(".mjs"));
const mods = await Promise.all(files.map((f) => import(`../commands/${f}`)));

program.commands(mods.map((m) => m.command));

try {
  await parse(process.argv);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
