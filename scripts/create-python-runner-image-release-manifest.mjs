import { assertValidPythonRunnerImageReleaseManifest } from './lib/python-runner-image-release-validator.mjs';

const required = (name) => {
  const value = process.env[name];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`missing ${name}`);
  return value;
};

try {
  const manifest = {
    schemaVersion: 1,
    artifact: 'python-runner-service-image',
    environment: 'staging',
    sourceRepository: 'mizzz-ivr/ai-code-dojo',
    sourceRef: required('GITHUB_REF'),
    sourceCommit: required('GITHUB_SHA'),
    repositoryUri: required('PYTHON_RUNNER_ECR_URI'),
    imageTag: required('PYTHON_RUNNER_IMAGE_TAG'),
    imageDigest: required('PYTHON_RUNNER_IMAGE_DIGEST'),
    imageUri: `${required('PYTHON_RUNNER_ECR_URI')}@${required('PYTHON_RUNNER_IMAGE_DIGEST')}`,
    workflowRunId: required('GITHUB_RUN_ID'),
    workflowRunAttempt: required('GITHUB_RUN_ATTEMPT')
  };
  assertValidPythonRunnerImageReleaseManifest(manifest);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ event: 'python_runner.image_release_manifest_failed', errorType: error instanceof Error ? error.name : 'Error' })}\n`);
  process.exit(1);
}
