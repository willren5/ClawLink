import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function walk(directory, predicate = (entryName) => entryName.endsWith('.test.ts')) {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(path, predicate));
      continue;
    }

    if (predicate(entry.name)) {
      files.push(path);
    }
  }

  return files;
}

const srcExists = statSync('src', { throwIfNoEntry: false })?.isDirectory();
const tests = srcExists ? walk('src') : [];

if (tests.length === 0) {
  console.log('No unit tests found.');
  process.exit(0);
}

const outDir = '.tmp/test-build';
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const compile = spawnSync(
  './node_modules/.bin/tsc',
  [
    '--outDir',
    outDir,
    '--module',
    'commonjs',
    '--moduleResolution',
    'node',
    '--target',
    'es2022',
    '--jsx',
    'react-jsx',
    '--esModuleInterop',
    '--skipLibCheck',
    '--strict',
    ...tests,
  ],
  {
    stdio: 'inherit',
  },
);

if ((compile.status ?? 1) !== 0) {
  process.exit(compile.status ?? 1);
}

const compiledTests = walk(outDir, (entryName) => entryName.endsWith('.test.js'));
if (compiledTests.length === 0) {
  console.log('No compiled unit tests found.');
  process.exit(1);
}
const result = spawnSync(process.execPath, ['--test', ...compiledTests], {
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
