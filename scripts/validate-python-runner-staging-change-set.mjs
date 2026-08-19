import {
  assertValidPythonRunnerChangeSetReviewRoleTemplate,
  assertValidPythonRunnerStagingChangeSetWorkflow,
  loadPythonRunnerChangeSetReviewRoleTemplate,
  loadPythonRunnerStagingChangeSetWorkflow,
  PYTHON_RUNNER_CHANGE_SET_REVIEW_ROLE_TEMPLATE_PATH,
  PYTHON_RUNNER_STAGING_CHANGE_SET_WORKFLOW_PATH
} from './lib/python-runner-staging-change-set-validator.mjs';

try {
  const [template, workflow] = await Promise.all([
    loadPythonRunnerChangeSetReviewRoleTemplate(),
    loadPythonRunnerStagingChangeSetWorkflow()
  ]);
  assertValidPythonRunnerChangeSetReviewRoleTemplate(template);
  assertValidPythonRunnerStagingChangeSetWorkflow(workflow);
  console.log(
    `infra validation passed: ${PYTHON_RUNNER_CHANGE_SET_REVIEW_ROLE_TEMPLATE_PATH}, ${PYTHON_RUNNER_STAGING_CHANGE_SET_WORKFLOW_PATH}`
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
