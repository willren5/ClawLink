import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOTS = ['app', 'src', 'ios/ClawLink'];
const FILE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.swift']);
const FAIL_PATTERNS = [
  { pattern: /\bconsole\.(?:log|debug)\s*\(/, label: 'console.log/debug' },
  { pattern: /\bdebugger\b/, label: 'debugger statement' },
];

function walk(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(path));
      continue;
    }

    if (FILE_EXTENSIONS.has(extname(entry.name))) {
      files.push(path);
    }
  }

  return files;
}

const violations = [];

for (const root of ROOTS) {
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    continue;
  }

  for (const file of walk(root)) {
    const content = readFileSync(file, 'utf8');
    for (const rule of FAIL_PATTERNS) {
      if (rule.pattern.test(content)) {
        violations.push(`${file}: contains ${rule.label}`);
      }
    }
  }
}

const packageJson = readFileSync('package.json', 'utf8');
if (packageJson.includes('No lint configured')) {
  violations.push('package.json: lint script is still a placeholder');
}

if (violations.length > 0) {
  console.error('Lint failed:\n' + violations.join('\n'));
  process.exit(1);
}

console.log(`Lint passed across ${ROOTS.join(', ')}.`);
