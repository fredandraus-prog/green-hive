import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ignoredDirectories = new Set([
  "node_modules",
  "dist",
  ".git",
  ".cache",
  ".tmp",
  ".temp",
  ".branches",
]);
const textExtensions = new Set([".ts", ".tsx", ".mjs", ".json", ".md", ".sql", ".csv", ".css", ".crt", ".html", ".example", ".yaml", ".yml"]);
const errors = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) {
      continue;
    }
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath);
      continue;
    }

    const extension = path.extname(entry.name);
    if (!textExtensions.has(extension) && entry.name !== ".gitignore") {
      continue;
    }
    const content = await readFile(fullPath, "utf8");
    const relativePath = path.relative(repositoryRoot, fullPath);
    if (content.length > 0 && !content.endsWith("\n")) {
      errors.push(`${relativePath} must end with a newline`);
    }
    if (/[ \t]+$/m.test(content)) {
      errors.push(`${relativePath} contains trailing whitespace`);
    }
    if (extension === ".json") {
      try {
        JSON.parse(content);
      } catch (error) {
        errors.push(`${relativePath} is not valid JSON: ${error.message}`);
      }
    }
  }
}

await walk(repositoryRoot);

if (errors.length > 0) {
  console.error("Format check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log("Format check passed.");
}
