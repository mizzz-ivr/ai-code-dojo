import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePythonRunnerEcrLifecyclePolicy
} from '../../scripts/validate-python-runner-ecr-lifecycle-policy.mjs';

const validPolicy = {
  rules: [{
    rulePriority: 1,
    description: 'Expire untagged staging images after 7 days',
    selection: {
      tagStatus: 'untagged',
      countType: 'sinceImagePushed',
      countUnit: 'days',
      countNumber: 7
    },
    action: { type: 'expire' }
  }]
};

const includesError = (errors, fragment) =>
  errors.some((error) => error.includes(fragment));

test('ECR lifecycle policyはJSON整形差を許容して意味的に一致する', () => {
  assert.deepEqual(
    validatePythonRunnerEcrLifecyclePolicy(JSON.stringify(validPolicy, null, 2)),
    []
  );
});

test('ECR lifecycle policyはtagged image削除や保持期間変更を拒否する', () => {
  const changed = structuredClone(validPolicy);
  changed.rules[0].selection.tagStatus = 'any';
  changed.rules[0].selection.countNumber = 1;
  const errors = validatePythonRunnerEcrLifecyclePolicy(JSON.stringify(changed));
  assert.equal(includesError(errors, 'expire only untagged'), true);
});

test('ECR lifecycle policyは空入力と不正JSONを拒否する', () => {
  assert.equal(includesError(validatePythonRunnerEcrLifecyclePolicy(''), 'source is required'), true);
  assert.equal(includesError(validatePythonRunnerEcrLifecyclePolicy('{'), 'valid JSON'), true);
});
