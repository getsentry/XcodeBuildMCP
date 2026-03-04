#!/usr/bin/env node

import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";

const outputPath = path.resolve(process.cwd(), "THIRD_PARTY_PACKAGE_LICENSES.md");

const raw = execSync("npx -y license-checker --production --json", {
  encoding: "utf8",
});
const licenses = JSON.parse(raw);

const rows = Object.entries(licenses)
  .map(([name, meta]) => {
    const license = Array.isArray(meta.licenses)
      ? meta.licenses.join(", ")
      : String(meta.licenses ?? "UNKNOWN");
    const repository = String(meta.repository ?? "");
    return { name, license, repository };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

const now = new Date().toISOString();
const lines = [
  "# Third-Party Package Licenses",
  "",
  `Generated at: ${now}`,
  "",
  "This file is generated from production npm dependencies.",
  "",
  "| Package | License | Repository |",
  "| --- | --- | --- |",
  ...rows.map((row) => `| ${row.name} | ${row.license} | ${row.repository} |`),
  "",
];

writeFileSync(outputPath, lines.join("\n"), "utf8");
console.log(`Wrote ${rows.length} entries to ${outputPath}`);
