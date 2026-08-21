import { createHash } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPythonRunnerStagingChangeSetParameters,
  loadPythonRunnerChangeSetReviewRoleTemplate,
  loadPythonRunnerStagingChangeSetWorkflow,
  validatePythonRunnerChangeSetReviewRoleTemplate,
  validatePythonRunnerReleaseArtifactChecksum,
  validatePythonRunnerStagingChangeSetConfig,
  validatePythonRunnerStagingChangeSetParameters,
  validatePythonRunnerStagingChangeSetWorkflow
} from '../../scripts/lib/python-runner-staging-change-set-validator.mjs';

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

const validConfig = () => ({
  accountId: '123456789012',
  region: 'ap-northeast-1',
  vpcId: 'vpc-0123456789abcdef0',
  privateSubnetIds: 'subnet-0123456789abcdef0,subnet-0fedcba9876543210',
  privateHostedZoneId: 'Z123456789ABC',
  runnerDnsName: 'python-runner.staging.internal.example.com',
  certificateArn: 'arn:aws:acm:ap-northeast-1:123456789012:certificate/01234567-89ab-cdef-0123-456789abcdef',
  runnerInstanceType: 't3.small'
});

test('review role templateとchange set workflowはreview-only安全契約を満たす', async () => {
  const [template, workflow] = await Promise.all([
    loadPythonRunnerChangeSetReviewRoleTemplate(),
    loadPythonRunnerStagingChangeSetWorkflow()
  ]);
  assert.deepEqual(validatePythonRunnerChangeSetReviewRoleTemplate(template), []);
  assert.deepEqual(validatePythonRunnerStagingChangeSetWorkflow(workflow), []);
});

test('review role validatorはOIDC wildcard・ExecuteChangeSet・broad PassRoleを拒否する', async () => {
  const template = structuredClone(await loadPythonRunnerChangeSetReviewRoleTemplate());
  template.Parameters.GitHubOidcSubject.AllowedPattern = '^repo:.*:environment:.*$';
  const role = template.Resources.GitHubActionsRunnerChangeSetReviewRole;
  role.Properties.Policies[1].PolicyDocument.Statement[0].Action = [
    'cloudformation:CreateChangeSet',
    'cloudformation:ExecuteChangeSet'
  ];
  role.Properties.Policies[2].PolicyDocument.Statement[0].Resource = '*';

  const errors = validatePythonRunnerChangeSetReviewRoleTemplate(template);
  assert.equal(includesError(errors, 'exact staging-python-runner-review environment subject'), true);
  assert.equal(includesError(errors, 'must not allow wildcard matching'), true);
  assert.equal(includesError(errors, 'grant only CreateChangeSet'), true);
  assert.equal(includesError(errors, 'must not grant cloudformation:ExecuteChangeSet'), true);
  assert.equal(includesError(errors, 'must target CloudFormationExecutionRoleArn only'), true);
});

test('workflow validatorは自動trigger・直接deploy・static AWS credential・任意image入力を拒否する', async () => {
  const workflow = await loadPythonRunnerStagingChangeSetWorkflow();
  const unsafe = `${workflow}\npull_request:\naws cloudformation execute-change-set\naws cloudformation deploy\nsecrets.AWS_ACCESS_KEY_ID\ninputs.image_digest\n`;
  const errors = validatePythonRunnerStagingChangeSetWorkflow(unsafe);
  assert.equal(includesError(errors, 'must not run on pull requests'), true);
  assert.equal(includesError(errors, 'must not execute change sets'), true);
  assert.equal(includesError(errors, 'must not deploy CloudFormation directly'), true);
  assert.equal(includesError(errors, 'must not reference long-lived AWS access key secrets'), true);
  assert.equal(includesError(errors, 'must not accept an arbitrary image digest input'), true);
});

test('validated release manifestからdeterministicなstaging parameter bundleを生成する', () => {
  const manifest = validManifest();
  const parameters = createPythonRunnerStagingChangeSetParameters(validConfig(), manifest);
  assert.deepEqual(validatePythonRunnerStagingChangeSetParameters(parameters), []);
  assert.deepEqual(parameters.map((parameter) => parameter.ParameterKey), [
    'EnvironmentName',
    'VpcId',
    'PrivateSubnetIds',
    'PrivateHostedZoneId',
    'RunnerDnsName',
    'CertificateArn',
    'RunnerServiceImageUri',
    'RunnerInstanceType'
  ]);
  assert.equal(parameters[6].ParameterValue, manifest.imageUri);
});

test('config validatorはaccount/region不一致・subnet重複・不正instance typeを拒否する', () => {
  const config = validConfig();
  config.privateSubnetIds = 'subnet-0123456789abcdef0,subnet-0123456789abcdef0';
  config.runnerInstanceType = 'm7i.large';
  config.certificateArn = 'arn:aws:acm:us-east-1:999999999999:certificate/01234567-89ab-cdef-0123-456789abcdef';

  const errors = validatePythonRunnerStagingChangeSetConfig(config, validManifest());
  assert.equal(includesError(errors, 'Private subnet IDs must be unique'), true);
  assert.equal(includesError(errors, 'RunnerInstanceType must be t3.small or t3.medium'), true);
  assert.equal(includesError(errors, 'CertificateArn region must match AWS region'), true);
  assert.equal(includesError(errors, 'CertificateArn account must match AWS account ID'), true);
});

test('config validatorはrelease repositoryのaccount/region driftを拒否する', () => {
  const manifest = validManifest();
  manifest.repositoryUri = '999999999999.dkr.ecr.us-east-1.amazonaws.com/ai-code-dojo-staging-python-runner';
  manifest.imageUri = `${manifest.repositoryUri}@${manifest.imageDigest}`;
  const errors = validatePythonRunnerStagingChangeSetConfig(validConfig(), manifest);
  assert.equal(includesError(errors, 'Release repository account must match AWS account ID'), true);
  assert.equal(includesError(errors, 'Release repository region must match AWS region'), true);
});

test('release artifact checksumは正しいmanifestだけを許可する', () => {
  const manifestSource = `${JSON.stringify(validManifest(), null, 2)}\n`;
  const checksum = createHash('sha256').update(manifestSource).digest('hex');
  assert.deepEqual(
    validatePythonRunnerReleaseArtifactChecksum(
      manifestSource,
      `${checksum}  python-runner-image-release.json\n`
    ),
    []
  );
  assert.equal(
    includesError(
      validatePythonRunnerReleaseArtifactChecksum(
        `${manifestSource} `,
        `${checksum}  python-runner-image-release.json\n`
      ),
      'checksum does not match'
    ),
    true
  );
  assert.equal(
    includesError(
      validatePythonRunnerReleaseArtifactChecksum(
        manifestSource,
        `${checksum}  other.json\n`
      ),
      'sha256sum format'
    ),
    true
  );
});

test('parameter bundle validatorは順序変更・余分なfieldを拒否する', () => {
  const parameters = createPythonRunnerStagingChangeSetParameters(validConfig(), validManifest());
  [parameters[0], parameters[1]] = [parameters[1], parameters[0]];
  parameters[2].UsePreviousValue = true;
  const errors = validatePythonRunnerStagingChangeSetParameters(parameters);
  assert.equal(includesError(errors, 'keys and order'), true);
  assert.equal(includesError(errors, 'must contain only ParameterKey and ParameterValue'), true);
});
