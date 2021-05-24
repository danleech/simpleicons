#!/usr/bin/env node
/**
 * @fileoverview
 * Generates a MarkDown file that lists every brand name and their slug.
 */

const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..", "..");
const dataFile = path.resolve(rootDir, "_data", "simple-icons.json");
const slugsFile = path.resolve(rootDir, "slugs.md");

const data = require(dataFile);
const { getIconSlug } = require("../utils.js");

let content = `<!--
This file is automatically generated. If you want to change something, please
update the script at '${path.relative(rootDir, __filename)}'.
-->

# Simple Icons slugs

| Brand name | Brand slug |
| :--- | :--- |
`;

data.icons.forEach(icon => {
  const brandName = icon.title;
  const brandSlug = getIconSlug(icon);
  content += `| \`${brandName}\` | \`${brandSlug}\` |\n`
});

fs.writeFileSync(slugsFile, content);
