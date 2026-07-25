import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const integrationRoot = path.resolve(process.cwd(), 'tests/integration');

const collectTestFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectTestFiles(entryPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
      files.push(entryPath);
    }
  }

  return files;
};

const testFiles = (await collectTestFiles(integrationRoot)).sort();
if (testFiles.length === 0) {
  console.error('integration test files were not found');
  process.exit(1);
}

for (const absolutePath of testFiles) {
  const relativePath = path.relative(process.cwd(), absolutePath);
  const result = spawnSync(
    process.execPath,
    ['--test', '--test-concurrency=1', relativePath],
    {
      cwd: process.cwd(),
      env: process.env,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    }
  );

  if (result.status !== 0) {
    console.error(`FAIL ${relativePath}`);
    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) console.error(result.error);
    process.exit(result.status ?? 1);
  }

  console.log(`PASS ${relativePath}`);
}

console.log(`integration tests passed: ${testFiles.length} files`);
