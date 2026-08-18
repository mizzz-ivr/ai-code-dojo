import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadPythonRunnerTrivyExceptions,
  validatePythonRunnerTrivyExceptions
} from '../../scripts/python-runner-trivy-exception-validator.mjs';

const canonical = await loadPythonRunnerTrivyExceptions();
const includesError = (errors, fragment) => errors.some((error) => error.includes(fragment));

test('Python Runner Trivy例外は承認済み8件だけに限定する', () => {
  assert.deepEqual(validatePythonRunnerTrivyExceptions(canonical), []);
});

test('未知CVEの追加を拒否する', () => {
  const extra = canonical.replace(
    'vulnerabilities:\n',
    `vulnerabilities:\n  - id: CVE-2099-0001\n    paths:\n      - usr/local/bin/docker\n    purls:\n      - pkg:golang/stdlib@v1.26.5\n    expired_at: 2026-09-17\n    statement: Docker CLI 29.6.2 is the latest stable release and Go 1.26.6 is not released yet; re-evaluate on expiry.\n`
  );
  const errors = validatePythonRunnerTrivyExceptions(extra);
  assert.equal(includesError(errors, 'exactly 8 entries'), true);
  assert.equal(includesError(errors, 'approved Docker CLI exception set'), true);
});

test('対象PURLや期限の拡大を拒否する', () => {
  const changed = canonical
    .replace('pkg:golang/stdlib@v1.26.5', 'pkg:golang/stdlib@*')
    .replace('expired_at: 2026-09-17', 'expired_at: 2099-12-31');
  const errors = validatePythonRunnerTrivyExceptions(changed);
  assert.equal(includesError(errors, 'purl must be pkg:golang/stdlib@v1.26.5'), true);
  assert.equal(includesError(errors, 'expiry must remain 2026-09-17'), true);
});
