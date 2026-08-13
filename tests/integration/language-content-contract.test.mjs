import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { runHtmlCssChallenge } from '../../apps/worker/src/services/html-css-runner.mjs';
import { runSqlChallenge } from '../../apps/worker/src/services/sql-runner.mjs';

const cases = [
  {
    slug: 'sql-monthly-sales',
    run: runSqlChallenge,
    solution: `SELECT
  substr(created_at, 1, 7) AS month,
  SUM(amount) AS total_amount
FROM orders
GROUP BY substr(created_at, 1, 7)
ORDER BY month ASC;
`
  },
  {
    slug: 'html-css-feature-profile-card',
    run: runHtmlCssChallenge,
    solution: `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Profile Card</title>
  <style>
    .profile-card {
      display: grid;
      grid-template-columns: 96px 1fr;
      gap: 16px;
      border: 1px solid #ddd;
      padding: 16px;
    }
    .profile-card img { width: 96px; height: 96px; }
    @media (max-width: 600px) {
      .profile-card { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <article class="profile-card">
    <img src="avatar.png" alt="Mika Satoのプロフィール画像" />
    <div>
      <h2>Mika Sato</h2>
      <p>Frontend Engineer</p>
    </div>
  </article>
</body>
</html>
`
  }
];

for (const challengeCase of cases) {
  test(`${challengeCase.slug} はstarter失敗・reference solution成功のRunner contractを満たす`, async () => {
    const challengeBasePath = path.resolve('problems/examples', challengeCase.slug);
    const challenge = JSON.parse(await readFile(path.join(challengeBasePath, 'problem.json'), 'utf8'));
    const editableStarter = challenge.starterCode.find((file) => !file.readonly);
    assert.ok(editableStarter);
    const starter = await readFile(path.join(challengeBasePath, editableStarter.path), 'utf8');

    const starterResult = await challengeCase.run({ challenge, challengeBasePath, code: starter });
    assert.notEqual(starterResult.score, 100);

    const solvedResult = await challengeCase.run({
      challenge,
      challengeBasePath,
      code: challengeCase.solution
    });
    assert.equal(solvedResult.score, 100);
    assert.equal(solvedResult.testResults.every((result) => result.passed), true);
    assert.equal(solvedResult.logs.some((log) => log.includes('hidden tests log is not exposed')), true);
  });
}
