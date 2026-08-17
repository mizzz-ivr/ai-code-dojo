import {
  assertValidPythonRunnerStagingCloudFormationTemplate,
  loadPythonRunnerStagingCloudFormationTemplate,
  PYTHON_RUNNER_STAGING_CLOUDFORMATION_TEMPLATE_PATH
} from './lib/python-runner-staging-cloudformation-validator.mjs';

try {
  const template = await loadPythonRunnerStagingCloudFormationTemplate();
  assertValidPythonRunnerStagingCloudFormationTemplate(template);
  console.log(`infra validation passed: ${PYTHON_RUNNER_STAGING_CLOUDFORMATION_TEMPLATE_PATH}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
