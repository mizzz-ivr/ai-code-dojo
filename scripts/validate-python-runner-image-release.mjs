import {
  assertValidPythonRunnerImagePublishWorkflow,
  assertValidPythonRunnerImageReleaseTemplate,
  loadPythonRunnerImagePublishWorkflow,
  loadPythonRunnerImageReleaseTemplate,
  PYTHON_RUNNER_IMAGE_PUBLISH_WORKFLOW_PATH,
  PYTHON_RUNNER_IMAGE_RELEASE_TEMPLATE_PATH
} from './lib/python-runner-image-release-validator.mjs';

try {
  const [template, workflow] = await Promise.all([
    loadPythonRunnerImageReleaseTemplate(),
    loadPythonRunnerImagePublishWorkflow()
  ]);
  assertValidPythonRunnerImageReleaseTemplate(template);
  assertValidPythonRunnerImagePublishWorkflow(workflow);
  console.log(`infra validation passed: ${PYTHON_RUNNER_IMAGE_RELEASE_TEMPLATE_PATH}, ${PYTHON_RUNNER_IMAGE_PUBLISH_WORKFLOW_PATH}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
