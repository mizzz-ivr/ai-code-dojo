import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const challengeCases = [
  {
    slug: 'js-refactor-order-summary',
    solution: `export function summarizeOrders(orders) {
  return orders.reduce((summary, order) => {
    if (order.status === 'paid') {
      summary.paidCount += 1;
      summary.totalPaidAmount += order.amount;
    } else if (order.status === 'pending') {
      summary.pendingCount += 1;
    }
    return summary;
  }, { paidCount: 0, pendingCount: 0, totalPaidAmount: 0 });
}
`
  },
  {
    slug: 'js-bugfix-pagination-window',
    solution: `export function buildPageWindow(currentPage, totalPages, maxItems = 5) {
  const safeTotal = Math.max(0, Math.trunc(totalPages));
  const safeMax = Math.max(0, Math.trunc(maxItems));
  if (safeTotal === 0 || safeMax === 0) return [];

  const size = Math.min(safeTotal, safeMax);
  const current = Math.min(safeTotal, Math.max(1, Math.trunc(currentPage)));
  let start = current - Math.floor(size / 2);
  start = Math.max(1, Math.min(start, safeTotal - size + 1));

  return Array.from({ length: size }, (_, index) => start + index);
}
`
  },
  {
    slug: 'ts-feature-access-policy',
    solution: `export type Role = 'admin' | 'editor' | 'viewer';
export type AccessLevel = 'blocked' | 'full' | 'write' | 'read';

export interface UserAccess {
  roles: Role[];
  suspended: boolean;
}

export function getAccessLevel(user: UserAccess): AccessLevel {
  if (user.suspended) return 'blocked';
  if (user.roles.includes('admin')) return 'full';
  if (user.roles.includes('editor')) return 'write';
  return 'read';
}
`
  },
  {
    slug: 'ts-refactor-feature-flags',
    solution: `export interface FeatureFlags {
  newDashboard: boolean;
  betaSearch: boolean;
  aiReview: boolean;
}

export type FeatureFlagOverrides = Partial<Record<keyof FeatureFlags, boolean | undefined>>;

export function resolveFeatureFlags(
  defaults: FeatureFlags,
  accountOverrides: FeatureFlagOverrides = {},
  userOverrides: FeatureFlagOverrides = {}
): FeatureFlags {
  const result = { ...defaults };
  for (const overrides of [accountOverrides, userOverrides]) {
    for (const key of Object.keys(result) as Array<keyof FeatureFlags>) {
      const value = overrides[key];
      if (typeof value === 'boolean') result[key] = value;
    }
  }
  return result;
}
`
  }
];

const runTests = ({ cwd, files }) => {
  // このintegration test自身がnode:test配下で動くため、内部用NODE_TEST_CONTEXTを
  // 子nodeへ渡すと再帰testとして全fileがskipされる。実Runner相当の独立processに戻す。
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;

  return spawnSync(
    process.execPath,
    ['--test', ...files],
    { cwd, encoding: 'utf8', timeout: 15000, env }
  );
};

for (const challengeCase of challengeCases) {
  test(`${challengeCase.slug} は未解決starterと解決可能なtest contractを持つ`, async () => {
    const sourceDirectory = path.resolve('problems/examples', challengeCase.slug);
    const problem = JSON.parse(await readFile(path.join(sourceDirectory, 'problem.json'), 'utf8'));
    const editableStarter = problem.starterCode.find((file) => !file.readonly);
    assert.ok(editableStarter, 'editable starter file is required');
    assert.equal(problem.runnerConfig.networkAccess, 'disabled');

    const allTests = [...problem.visibleTests, ...problem.hiddenTests];
    const starterResult = runTests({ cwd: sourceDirectory, files: allTests });
    assert.notEqual(
      starterResult.status,
      0,
      `starter should not already satisfy all tests\n${starterResult.stdout}\n${starterResult.stderr}`
    );

    const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'dojo-content-'));
    const workingDirectory = path.join(temporaryRoot, challengeCase.slug);

    try {
      await cp(sourceDirectory, workingDirectory, { recursive: true });
      await writeFile(
        path.join(workingDirectory, editableStarter.path),
        challengeCase.solution,
        'utf8'
      );

      const solvedResult = runTests({ cwd: workingDirectory, files: allTests });
      assert.equal(
        solvedResult.status,
        0,
        `reference solution must satisfy visible/hidden tests\n${solvedResult.stdout}\n${solvedResult.stderr}`
      );
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
}
