import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  validatePythonRunnerImagePublishWorkflow,
  validatePythonRunnerImageReleaseManifest,
  validatePythonRunnerImageReleaseTemplate
} from '../../scripts/lib/python-runner-image-release-validator.mjs';

const templatePath = new URL('../../infra/aws/cloudformation/python-runner-image-release-stack.json', import.meta.url);
const workflowPath = new URL('../../.github/workflows/publish-python-runner-staging-image.yml', import.meta.url);
const loadTemplate = async () => JSON.parse(await readFile(templatePath, 'utf8'));
const loadWorkflow = async () => readFile(workflowPath, 'utf8');
const includesError = (errors, fragment) => errors.some((error) => error.includes(fragment));

const validManifest = () => ({
  schemaVersion: 1,
  artifact: 'python-runner-service-image',
  environment: 'staging',
  sourceRepository: 'mizzz-ivr/ai-code-dojo',
  sourceRef: 'refs/heads/main',
  sourceCommit: 'a'.repeat(40),
  repositoryUri: '123456789012.dkr.ecr.ap-northeast-1.amazonaws.com/ai-code-dojo-staging-python-runner',
  imageTag: `sha-${'a'.repeat(40)}`,
  imageDigest: `sha256:${'b'.repeat(64)}`,
  imageUri: `123456789012.dkr.ecr.ap-northeast-1.amazonaws.com/ai-code-dojo-staging-python-runner@sha256:${'b'.repeat(64)}`,
  workflowRunId: '12345',
  workflowRunAttempt: '1'
});

test('ECR release templateとpublish workflowはreview-only安全契約を満たす', async () => {
  const [template, workflow] = await Promise.all([loadTemplate(), loadWorkflow()]);
  assert.deepEqual(validatePythonRunnerImageReleaseTemplate(template), []);
  assert.deepEqual(validatePythonRunnerImagePublishWorkflow(workflow), []);
});

test('template validatorはmutable tag・自動削除・broad publisher権限を拒否する', async () => {
  const template = await loadTemplate();
  template.Resources.PythonRunnerImageRepository.Properties.ImageTagMutability = 'MUTABLE';
  template.Resources.PythonRunnerImageRepository.Properties.EmptyOnDelete = true;
  template.Resources.GitHubActionsImagePublisherRole.Properties.Policies[1].PolicyDocument.Statement[0].Action.push('ecr:DeleteRepository');
  template.Resources.GitHubActionsImagePublisherRole.Properties.Policies[1].PolicyDocument.Statement[0].Resource = '*';

  const errors = validatePythonRunnerImageReleaseTemplate(template);
  assert.equal(includesError(errors, 'fully IMMUTABLE'), true);
  assert.equal(includesError(errors, 'must not empty images automatically'), true);
  assert.equal(includesError(errors, 'push/readback contract'), true);
  assert.equal(includesError(errors, 'target PythonRunnerImageRepository only'), true);
  assert.equal(includesError(errors, 'must not grant ecr:DeleteRepository'), true);
});

test('template validatorはOIDC subject wildcardとlong-lived credential混入を拒否する', async () => {
  const template = await loadTemplate();
  template.Parameters.GitHubOidcSubject.AllowedPattern = '^repo:.*:environment:.*$';
  template.Metadata.AccessKeyId = 'AKIA1234567890ABCDEF';
  template.Metadata.AccountId = '123456789012';

  const errors = validatePythonRunnerImageReleaseTemplate(template);
  assert.equal(includesError(errors, 'exact staging-python-runner-image environment subject'), true);
  assert.equal(includesError(errors, 'must not allow wildcard matching'), true);
  assert.equal(includesError(errors, 'AWS access key ID'), true);
  assert.equal(includesError(errors, 'literal AWS account ID'), true);
});

test('workflow validatorは自動trigger・mutable latest・repository mutation・static AWS secretを拒否する', async () => {
  const workflow = await loadWorkflow();
  const unsafe = `${workflow}\npull_request:\naws ecr put-image-tag-mutability\nsecrets.AWS_ACCESS_KEY_ID\nimage: repo:latest\n`;
  const errors = validatePythonRunnerImagePublishWorkflow(unsafe);
  assert.equal(includesError(errors, 'must not run on pull requests'), true);
  assert.equal(includesError(errors, 'must not mutate ECR tag immutability'), true);
  assert.equal(includesError(errors, 'must not reference AWS access key secrets'), true);
  assert.equal(includesError(errors, 'must not publish mutable latest tags'), true);
});

test('workflow validatorはmain・dedicated environment・explicit confirmation・OIDC account restrictionを必須にする', async () => {
  const workflow = await loadWorkflow();
  const unsafe = workflow
    .replace("if: github.ref == 'refs/heads/main' && inputs.confirm_publish == 'PUBLISH_STAGING_PYTHON_RUNNER_IMAGE'", 'if: always()')
    .replace('environment: staging-python-runner-image', 'environment: staging')
    .replace('allowed-account-ids: ${{ env.AWS_ACCOUNT_ID }}', '');
  const errors = validatePythonRunnerImagePublishWorkflow(unsafe);
  assert.equal(includesError(errors, 'require main and explicit confirmation'), true);
  assert.equal(includesError(errors, 'dedicated staging image GitHub Environment'), true);
  assert.equal(includesError(errors, 'restrict the assumed AWS account'), true);
});

test('release manifestはsource commit tagとregistry digestを一意に結び付ける', () => {
  assert.deepEqual(validatePythonRunnerImageReleaseManifest(validManifest()), []);
});

test('release manifest validatorはmutable tag・別repository・digestなしURI・余分なfieldを拒否する', () => {
  const manifest = validManifest();
  manifest.imageTag = 'latest';
  manifest.repositoryUri = '123456789012.dkr.ecr.ap-northeast-1.amazonaws.com/other';
  manifest.imageUri = `${manifest.repositoryUri}:latest`;
  manifest.extra = 'not-approved';
  const errors = validatePythonRunnerImageReleaseManifest(manifest);
  assert.equal(includesError(errors, 'exactly the approved fields'), true);
  assert.equal(includesError(errors, 'imageTag must be derived from sourceCommit'), true);
  assert.equal(includesError(errors, 'must target ai-code-dojo-staging-python-runner'), true);
  assert.equal(includesError(errors, 'must pin repositoryUri by imageDigest'), true);
});
