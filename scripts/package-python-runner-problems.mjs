import { copyFile, lstat, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SLUG_PATTERN = /^[a-z0-9-]{1,120}$/;

const resolveRequiredFile = ({ challengeRoot, relativePath }) => {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)) {
    throw new Error('python runner case path must be relative');
  }
  const normalized = path.normalize(relativePath);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`) || path.extname(normalized) !== '.json') {
    throw new Error('python runner case path is invalid');
  }
  const source = path.resolve(challengeRoot, normalized);
  if (!source.startsWith(`${path.resolve(challengeRoot)}${path.sep}`)) {
    throw new Error('python runner case path escapes challenge');
  }
  return { source, relativePath: normalized };
};

const assertRegularFile = async (filePath) => {
  const stat = await lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`python runner runtime file must be a regular file: ${filePath}`);
  }
};

const copyRuntimeFile = async ({ source, destination }) => {
  await assertRegularFile(source);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
};

const readProblem = async (problemPath) => {
  await assertRegularFile(problemPath);
  const parsed = JSON.parse(await readFile(problemPath, 'utf8'));
  if (!parsed || typeof parsed !== 'object') throw new Error('python runner problem metadata is invalid');
  return parsed;
};

export const packagePythonRunnerProblems = async ({ sourceRoot, destinationRoot }) => {
  const source = path.resolve(sourceRoot);
  const destination = path.resolve(destinationRoot);
  if (source === destination || destination.startsWith(`${source}${path.sep}`)) {
    throw new Error('python runner destination must be outside source root');
  }

  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });

  const entries = await readdir(source, { withFileTypes: true });
  const packagedChallenges = [];
  let copiedFileCount = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const challengeRoot = path.join(source, entry.name);
    const problemPath = path.join(challengeRoot, 'problem.json');
    let problem;
    try {
      problem = await readProblem(problemPath);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }

    if (problem?.metadata?.supportedLanguages?.includes('python') !== true) continue;
    if (!SLUG_PATTERN.test(entry.name) || problem?.metadata?.slug !== entry.name) {
      throw new Error(`python runner challenge slug mismatch: ${entry.name}`);
    }
    if (!Array.isArray(problem.visibleTests) || problem.visibleTests.length === 0
      || !Array.isArray(problem.hiddenTests) || problem.hiddenTests.length === 0) {
      throw new Error(`python runner challenge test paths are required: ${entry.name}`);
    }

    const requiredFiles = new Map();
    requiredFiles.set('problem.json', problemPath);
    for (const relativePath of [...problem.visibleTests, ...problem.hiddenTests]) {
      const resolved = resolveRequiredFile({ challengeRoot, relativePath });
      requiredFiles.set(resolved.relativePath, resolved.source);
    }

    for (const [relativePath, sourcePath] of requiredFiles) {
      await copyRuntimeFile({
        source: sourcePath,
        destination: path.join(destination, entry.name, relativePath)
      });
      copiedFileCount += 1;
    }
    packagedChallenges.push(entry.name);
  }

  if (packagedChallenges.length === 0) {
    throw new Error('python runner image must contain at least one python challenge');
  }

  return Object.freeze({
    challengeCount: packagedChallenges.length,
    copiedFileCount,
    challenges: Object.freeze(packagedChallenges.sort())
  });
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [sourceRoot, destinationRoot] = process.argv.slice(2);
  if (!sourceRoot || !destinationRoot || process.argv.length !== 4) {
    process.stderr.write('usage: node scripts/package-python-runner-problems.mjs <sourceRoot> <destinationRoot>\n');
    process.exit(2);
  }
  try {
    const result = await packagePythonRunnerProblems({ sourceRoot, destinationRoot });
    process.stdout.write(`${JSON.stringify({ event: 'python_runner.image_problems_packaged', ...result })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ event: 'python_runner.image_packaging_failed', errorType: error instanceof Error ? error.name : 'Error' })}\n`);
    process.exit(1);
  }
}
