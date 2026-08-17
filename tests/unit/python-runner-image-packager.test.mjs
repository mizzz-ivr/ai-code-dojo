import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { packagePythonRunnerProblems } from '../../scripts/package-python-runner-problems.mjs';

const writeJson = (filePath, value) => writeFile(filePath, JSON.stringify(value), 'utf8');

const createChallenge = async ({ root, slug, languages = ['python'], visible = 'tests/visible/cases.json', hidden = 'tests/hidden/cases.json' }) => {
  const base = path.join(root, slug);
  await mkdir(path.join(base, 'tests/visible'), { recursive: true });
  await mkdir(path.join(base, 'tests/hidden'), { recursive: true });
  await mkdir(path.join(base, 'starter'), { recursive: true });
  await writeJson(path.join(base, 'problem.json'), {
    metadata: { slug, supportedLanguages: languages },
    visibleTests: [visible],
    hiddenTests: [hidden]
  });
  await writeJson(path.join(base, 'tests/visible/cases.json'), { cases: [{ id: 'visible' }] });
  await writeJson(path.join(base, 'tests/hidden/cases.json'), { cases: [{ id: 'hidden' }] });
  await writeFile(path.join(base, 'tests/hidden/legacy_hidden_test.py'), 'secret = True\n', 'utf8');
  await writeFile(path.join(base, 'starter/main.py'), 'pass\n', 'utf8');
  return base;
};

test('Python Runner imageにはPython challengeのproblemとcase JSONだけを含める', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'python-runner-image-packager-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const source = path.join(temp, 'source');
  const destination = path.join(temp, 'output');
  await mkdir(source, { recursive: true });
  await createChallenge({ root: source, slug: 'python-one' });
  await createChallenge({ root: source, slug: 'javascript-one', languages: ['javascript'] });

  const result = await packagePythonRunnerProblems({ sourceRoot: source, destinationRoot: destination });

  assert.deepEqual(result.challenges, ['python-one']);
  assert.equal(result.challengeCount, 1);
  assert.equal(result.copiedFileCount, 3);
  assert.equal(JSON.parse(await readFile(path.join(destination, 'python-one/problem.json'), 'utf8')).metadata.slug, 'python-one');
  assert.equal(JSON.parse(await readFile(path.join(destination, 'python-one/tests/hidden/cases.json'), 'utf8')).cases[0].id, 'hidden');
  await assert.rejects(readFile(path.join(destination, 'python-one/tests/hidden/legacy_hidden_test.py')), /ENOENT/);
  await assert.rejects(readFile(path.join(destination, 'python-one/starter/main.py')), /ENOENT/);
  await assert.rejects(readFile(path.join(destination, 'javascript-one/problem.json')), /ENOENT/);
});

test('case pathのchallenge外参照をfail-closed拒否する', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'python-runner-image-packager-traversal-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const source = path.join(temp, 'source');
  const destination = path.join(temp, 'output');
  await mkdir(source, { recursive: true });
  const base = await createChallenge({ root: source, slug: 'python-traversal' });
  const problem = JSON.parse(await readFile(path.join(base, 'problem.json'), 'utf8'));
  problem.hiddenTests = ['../outside.json'];
  await writeJson(path.join(base, 'problem.json'), problem);
  await writeJson(path.join(source, 'outside.json'), { cases: [] });

  await assert.rejects(
    packagePythonRunnerProblems({ sourceRoot: source, destinationRoot: destination }),
    /case path is invalid|escapes challenge/
  );
});

test('case JSONのsymlinkをruntime imageへ取り込まない', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'python-runner-image-packager-symlink-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const source = path.join(temp, 'source');
  const destination = path.join(temp, 'output');
  await mkdir(source, { recursive: true });
  const base = await createChallenge({ root: source, slug: 'python-symlink' });
  const target = path.join(temp, 'outside-cases.json');
  await writeJson(target, { cases: [{ id: 'outside' }] });
  await rm(path.join(base, 'tests/hidden/cases.json'));
  await symlink(target, path.join(base, 'tests/hidden/cases.json'));

  await assert.rejects(
    packagePythonRunnerProblems({ sourceRoot: source, destinationRoot: destination }),
    /regular file/
  );
});
