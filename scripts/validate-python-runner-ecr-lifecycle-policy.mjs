import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const EXPECTED_PYTHON_RUNNER_ECR_LIFECYCLE_POLICY = Object.freeze({
  rules: Object.freeze([Object.freeze({
    rulePriority: 1,
    description: 'Expire untagged staging images after 7 days',
    selection: Object.freeze({
      tagStatus: 'untagged',
      countType: 'sinceImagePushed',
      countUnit: 'days',
      countNumber: 7
    }),
    action: Object.freeze({ type: 'expire' })
  })])
});

export const validatePythonRunnerEcrLifecyclePolicy = (source) => {
  if (typeof source !== 'string' || source.trim().length === 0) {
    return ['ECR lifecycle policy source is required.'];
  }
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    return ['ECR lifecycle policy must be valid JSON.'];
  }
  return isDeepStrictEqual(parsed, EXPECTED_PYTHON_RUNNER_ECR_LIFECYCLE_POLICY)
    ? []
    : ['ECR lifecycle policy must expire only untagged Python Runner images after 7 days.'];
};

export const assertValidPythonRunnerEcrLifecyclePolicy = (source) => {
  const errors = validatePythonRunnerEcrLifecyclePolicy(source);
  if (errors.length > 0) {
    throw new Error(`Python Runner ECR lifecycle policy validation failed:\n${errors.map((error) => `- ${error}`).join('\n')}`);
  }
  return true;
};

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  let source = '';
  for await (const chunk of process.stdin) source += chunk.toString('utf8');
  try {
    assertValidPythonRunnerEcrLifecyclePolicy(source);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      event: 'python_runner.ecr_lifecycle_policy_invalid',
      errorType: error instanceof Error ? error.name : 'Error'
    })}\n`);
    process.exit(1);
  }
}
