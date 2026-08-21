import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { validatePythonRunnerImageReleaseManifest } from './python-runner-image-release-validator.mjs';

export const PYTHON_RUNNER_CHANGE_SET_REVIEW_ROLE_TEMPLATE_PATH = path.resolve(
  process.cwd(),
  'infra/aws/cloudformation/python-runner-change-set-review-role-stack.json'
);
export const PYTHON_RUNNER_STAGING_CHANGE_SET_WORKFLOW_PATH = path.resolve(
  process.cwd(),
  '.github/workflows/review-python-runner-staging-change-set.yml'
);

const EXPECTED_ENVIRONMENT = 'staging-python-runner-review';
const EXPECTED_STACK_NAME = 'ai-code-dojo-staging-python-runner';
const EXPECTED_SUBJECT_PATTERN =
  '^repo:(mizzz-ivr/ai-code-dojo|mizzz-ivr@[0-9]+/ai-code-dojo@[0-9]+):environment:staging-python-runner-review$';
const EXPECTED_CHANGE_SET_PREFIX = 'ai-code-dojo-python-runner-staging-*';
const EXPECTED_REPOSITORY_NAME = 'ai-code-dojo-staging-python-runner';
const CONFIRMATION = 'CREATE_PYTHON_RUNNER_STAGING_CHANGE_SET';
const PARAMETER_KEYS = Object.freeze([
  'EnvironmentName',
  'VpcId',
  'PrivateSubnetIds',
  'PrivateHostedZoneId',
  'RunnerDnsName',
  'CertificateArn',
  'RunnerServiceImageUri',
  'RunnerInstanceType'
]);

const ACCOUNT_ID_PATTERN = /^[0-9]{12}$/;
const REGION_PATTERN = /^[a-z]{2}(?:-gov)?-[a-z]+-[0-9]$/;
const VPC_ID_PATTERN = /^vpc-[0-9a-f]{8,17}$/;
const SUBNET_ID_PATTERN = /^subnet-[0-9a-f]{8,17}$/;
const HOSTED_ZONE_ID_PATTERN = /^Z[A-Z0-9]{8,32}$/;
const DNS_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const CERTIFICATE_ARN_PATTERN = /^arn:(?:aws|aws-us-gov|aws-cn):acm:([^:]+):([0-9]{12}):certificate\/[0-9a-fA-F-]+$/;
const REPOSITORY_URI_PATTERN = /^([0-9]{12})\.dkr\.ecr\.([a-z0-9-]+)\.amazonaws\.com\/ai-code-dojo-staging-python-runner$/;
const CHECKSUM_PATTERN = /^([a-f0-9]{64})  python-runner-image-release\.json\n?$/;

const sameJson = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);
const sorted = (values) => [...values].sort();
const actionsOf = (statement) =>
  Array.isArray(statement?.Action) ? statement.Action : [statement?.Action].filter(Boolean);
const statementsOf = (role) =>
  (role?.Properties?.Policies ?? []).flatMap((policy) => policy?.PolicyDocument?.Statement ?? []);
const statementBySid = (role, sid) => statementsOf(role).find((statement) => statement?.Sid === sid);
const exactActions = (statement, expected) => sameJson(sorted(actionsOf(statement)), sorted(expected));
const normalizeSubnetIds = (value) =>
  (Array.isArray(value) ? value : String(value ?? '').split(','))
    .map((item) => String(item).trim())
    .filter(Boolean);

export const validatePythonRunnerChangeSetReviewRoleTemplate = (template) => {
  const errors = [];
  const require = (condition, message) => { if (!condition) errors.push(message); };

  require(template && typeof template === 'object' && !Array.isArray(template), 'Template must be an object.');
  if (errors.length > 0) return errors;

  require(template.AWSTemplateFormatVersion === '2010-09-09', 'AWSTemplateFormatVersion must be 2010-09-09.');
  require(Boolean(template.Description), 'Template Description is required.');
  require(template.Metadata?.DeploymentSafety?.Mode === 'review-only', 'DeploymentSafety.Mode must be review-only.');
  require(template.Metadata?.DeploymentSafety?.RequiresExplicitApproval === true, 'DeploymentSafety must require explicit approval.');
  require(template.Metadata?.DeploymentSafety?.CanExecuteChangeSet === false, 'Review role must not be able to execute change sets.');
  require(template.Metadata?.DeploymentSafety?.CanMutateTargetResourcesDirectly === false, 'Review role must not mutate target resources directly.');
  require(template.Metadata?.DeploymentSafety?.PythonPublicGate === 'disabled', 'Python public gate must remain disabled.');

  const parameters = template.Parameters ?? {};
  require(
    sameJson(parameters.EnvironmentName?.AllowedValues, ['staging']) && parameters.EnvironmentName?.Default === 'staging',
    'EnvironmentName must be fixed to staging.'
  );
  require(
    sameJson(parameters.TargetStackName?.AllowedValues, [EXPECTED_STACK_NAME])
      && parameters.TargetStackName?.Default === EXPECTED_STACK_NAME,
    `TargetStackName must be fixed to ${EXPECTED_STACK_NAME}.`
  );
  require(parameters.GitHubOidcProviderArn?.Default === undefined, 'GitHubOidcProviderArn must not have a default.');
  require(parameters.GitHubOidcSubject?.Default === undefined, 'GitHubOidcSubject must not have a default.');
  require(parameters.CloudFormationExecutionRoleArn?.Default === undefined, 'CloudFormationExecutionRoleArn must not have a default.');
  require(
    parameters.GitHubOidcSubject?.AllowedPattern === EXPECTED_SUBJECT_PATTERN,
    `GitHubOidcSubject must require the exact ${EXPECTED_ENVIRONMENT} environment subject.`
  );
  require(!String(parameters.GitHubOidcSubject?.AllowedPattern ?? '').includes('.*'), 'GitHubOidcSubject must not allow wildcard matching.');

  const role = template.Resources?.GitHubActionsRunnerChangeSetReviewRole;
  require(role?.Type === 'AWS::IAM::Role', 'GitHubActionsRunnerChangeSetReviewRole must be AWS::IAM::Role.');
  if (role?.Type === 'AWS::IAM::Role') {
    const props = role.Properties ?? {};
    require(!('RoleName' in props), 'Review role must not fix RoleName.');
    require(!('ManagedPolicyArns' in props), 'Review role must not attach managed policies.');
    require(sameJson(props.AssumeRolePolicyDocument?.Statement, [{
      Effect: 'Allow',
      Principal: { Federated: { Ref: 'GitHubOidcProviderArn' } },
      Action: 'sts:AssumeRoleWithWebIdentity',
      Condition: {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          'token.actions.githubusercontent.com:sub': { Ref: 'GitHubOidcSubject' }
        }
      }
    }]), 'Review role trust must exactly match GitHub OIDC aud and dedicated environment subject.');

    const validate = statementBySid(role, 'ValidatePythonRunnerTemplate');
    require(exactActions(validate, ['cloudformation:ValidateTemplate']), 'Review role template validation must grant only cloudformation:ValidateTemplate.');
    require(validate?.Resource === '*', 'cloudformation:ValidateTemplate must use its required wildcard resource.');

    const create = statementBySid(role, 'CreatePythonRunnerChangeSet');
    require(exactActions(create, ['cloudformation:CreateChangeSet']), 'Review role must grant only CreateChangeSet for change-set creation.');
    require(
      create?.Resource?.['Fn::Sub']
        === 'arn:${AWS::Partition}:cloudformation:${AWS::Region}:${AWS::AccountId}:stack/${TargetStackName}/*',
      'CreateChangeSet must be limited to TargetStackName.'
    );
    require(
      sameJson(create?.Condition, {
        ArnEquals: { 'cloudformation:RoleArn': { Ref: 'CloudFormationExecutionRoleArn' } },
        StringLike: { 'cloudformation:ChangeSetName': EXPECTED_CHANGE_SET_PREFIX }
      }),
      'CreateChangeSet must require the reviewed execution role and approved change-set name prefix.'
    );

    const stackReview = statementBySid(role, 'ReviewPythonRunnerStack');
    require(
      exactActions(stackReview, ['cloudformation:DescribeStacks', 'cloudformation:GetTemplate', 'cloudformation:ListChangeSets']),
      'Stack review permissions must remain read-only.'
    );
    require(
      stackReview?.Resource?.['Fn::Sub']
        === 'arn:${AWS::Partition}:cloudformation:${AWS::Region}:${AWS::AccountId}:stack/${TargetStackName}/*',
      'Stack review permissions must be limited to TargetStackName.'
    );

    const changeSetReview = statementBySid(role, 'ReviewPythonRunnerChangeSet');
    require(exactActions(changeSetReview, ['cloudformation:DescribeChangeSet']), 'Change-set review must grant only DescribeChangeSet.');
    require(
      changeSetReview?.Resource?.['Fn::Sub']
        === 'arn:${AWS::Partition}:cloudformation:${AWS::Region}:${AWS::AccountId}:stack/${TargetStackName}/*',
      'DescribeChangeSet must be limited to TargetStackName.'
    );
    require(
      changeSetReview?.Condition?.StringLike?.['cloudformation:ChangeSetName'] === EXPECTED_CHANGE_SET_PREFIX,
      'DescribeChangeSet must be limited to the approved change-set name prefix.'
    );

    const passRole = statementBySid(role, 'PassPythonRunnerExecutionRole');
    require(exactActions(passRole, ['iam:PassRole']), 'Review role must only pass the reviewed CloudFormation execution role.');
    require(sameJson(passRole?.Resource, { Ref: 'CloudFormationExecutionRoleArn' }), 'iam:PassRole must target CloudFormationExecutionRoleArn only.');
    require(
      passRole?.Condition?.StringEquals?.['iam:PassedToService'] === 'cloudformation.amazonaws.com',
      'iam:PassRole must be limited to CloudFormation.'
    );

    const forbiddenActions = new Set([
      'cloudformation:ExecuteChangeSet',
      'cloudformation:CreateStack',
      'cloudformation:UpdateStack',
      'cloudformation:DeleteStack',
      'cloudformation:*',
      'iam:*'
    ]);
    const forbidden = statementsOf(role).flatMap(actionsOf).find((action) => forbiddenActions.has(action));
    require(forbidden === undefined, `Review role must not grant ${forbidden ?? 'forbidden mutation actions'}.`);
  }

  for (const output of [
    'GitHubActionsRunnerChangeSetReviewRoleArn',
    'ExpectedGitHubOidcSubject',
    'TargetStackName',
    'CloudFormationExecutionRoleArn'
  ]) {
    require(template.Outputs?.[output]?.Value !== undefined, `Output ${output} is required.`);
  }

  const serialized = JSON.stringify(template);
  require(!/AKIA[0-9A-Z]{16}/.test(serialized), 'Template must not contain an AWS access key ID.');
  require(!/\b\d{12}\b/.test(serialized), 'Template must not contain a literal AWS account ID.');
  return errors;
};

export const validatePythonRunnerStagingChangeSetWorkflow = (source) => {
  const errors = [];
  const requireIncludes = (fragment, message) => { if (!source.includes(fragment)) errors.push(message); };
  const requireExcludes = (fragment, message) => { if (source.includes(fragment)) errors.push(message); };
  if (typeof source !== 'string' || source.length === 0) return ['Workflow source is required.'];

  requireIncludes('workflow_dispatch:', 'Workflow must be workflow_dispatch only.');
  requireExcludes('pull_request:', 'Workflow must not run on pull requests.');
  requireExcludes('\npush:', 'Workflow must not run on push.');
  requireExcludes('\nschedule:', 'Workflow must not run on a schedule.');
  requireIncludes('contents: read', 'Workflow must grant contents: read.');
  requireIncludes('actions: read', 'Workflow must grant actions: read to fetch the release artifact.');
  requireIncludes('id-token: write', 'Workflow must grant id-token: write for OIDC.');
  requireIncludes(
    `if: github.ref == 'refs/heads/main' && inputs.confirm_review == '${CONFIRMATION}'`,
    'Workflow must require main and explicit change-set confirmation.'
  );
  requireIncludes(`environment: ${EXPECTED_ENVIRONMENT}`, 'Workflow must use the dedicated Python Runner review environment.');
  requireIncludes('cancel-in-progress: false', 'Workflow must not cancel an in-progress change-set review.');
  requireIncludes('actions/download-artifact@v5', 'Workflow must use the official cross-run artifact downloader.');
  requireIncludes('github-token: ${{ github.token }}', 'Cross-run artifact download must use the scoped GitHub token.');
  requireIncludes('run-id: ${{ env.RELEASE_RUN_ID }}', 'Artifact download must be tied to the selected release workflow run.');
  requireIncludes('artifact_name="python-runner-image-release-${release_head_sha}"', 'Workflow must derive the exact release artifact name from the selected publish run head SHA.');
  requireIncludes('artifacts?per_page=100', 'Workflow must inspect artifacts belonging to the selected publish run.');
  requireIncludes("select(.name == $name and .expired == false)", 'Workflow must require one exact unexpired release artifact.');
  requireIncludes('name: ${{ steps.release.outputs.artifact_name }}', 'Artifact download must use the exact validated artifact name.');
  requireIncludes('gh api "repos/${GITHUB_REPOSITORY}/actions/runs/${RELEASE_RUN_ID}"', 'Workflow must inspect the selected release workflow run.');
  requireIncludes(".name == \"publish-python-runner-staging-image\"", 'Workflow must require the Python Runner image publish workflow.');
  requireIncludes(".event == \"workflow_dispatch\"", 'Release workflow run must be manually dispatched.');
  requireIncludes(".head_branch == \"main\"", 'Release workflow run must originate from main.');
  requireIncludes(".conclusion == \"success\"", 'Release workflow run must have succeeded.');
  requireIncludes('validate-python-runner-release-artifact.mjs', 'Workflow must validate the release manifest checksum and schema.');
  requireIncludes('git merge-base --is-ancestor "${source_commit}" "${GITHUB_SHA}"', 'Release source commit must be an ancestor of current main.');
  requireIncludes('create-python-runner-staging-change-set-parameters.mjs', 'Workflow must derive stack parameters from the validated release manifest.');
  requireIncludes('uses: aws-actions/configure-aws-credentials@v6.2.3', 'Workflow must pin configure-aws-credentials to v6.2.3.');
  requireIncludes('role-duration-seconds: 900', 'OIDC session must be limited to 900 seconds.');
  requireIncludes('allowed-account-ids: ${{ env.AWS_ACCOUNT_ID }}', 'Workflow must restrict the assumed AWS account.');
  requireIncludes('aws cloudformation validate-template', 'Workflow must validate the staging CloudFormation template.');
  requireIncludes('aws cloudformation create-change-set', 'Workflow must create a review-only CloudFormation change set.');
  requireIncludes('--parameters file://python-runner-staging-parameters.json', 'Workflow must use the generated deterministic parameter bundle.');
  requireIncludes('--capabilities CAPABILITY_IAM', 'Workflow must explicitly acknowledge IAM resources in the staging template.');
  requireIncludes('--role-arn "${CFN_EXECUTION_ROLE_ARN}"', 'Workflow must bind the change set to the separately reviewed execution role.');
  requireIncludes('aws cloudformation describe-change-set', 'Workflow must render the generated change set for review.');
  requireIncludes('Execute: **未実施**', 'Workflow summary must state that execution is not performed.');
  requireIncludes('Python Public gate: **OFF**', 'Workflow summary must keep the Python public gate disabled.');

  for (const [fragment, message] of [
    ['aws cloudformation execute-change-set', 'Workflow must not execute change sets.'],
    ['aws cloudformation deploy', 'Workflow must not deploy CloudFormation directly.'],
    ['aws cloudformation create-stack', 'Workflow must not create stacks directly.'],
    ['aws cloudformation update-stack', 'Workflow must not update stacks directly.'],
    ['aws cloudformation delete-stack', 'Workflow must not delete stacks.'],
    ['secrets.AWS_ACCESS_KEY_ID', 'Workflow must not reference long-lived AWS access key secrets.'],
    ['secrets.AWS_SECRET_ACCESS_KEY', 'Workflow must not reference long-lived AWS secret key secrets.'],
    ['secrets.AWS_SESSION_TOKEN', 'Workflow must not reference long-lived AWS session token secrets.'],
    ['inputs.runner_service_image_uri', 'Workflow must not accept an arbitrary Runner image URI input.'],
    ['inputs.image_digest', 'Workflow must not accept an arbitrary image digest input.']
  ]) requireExcludes(fragment, message);

  return errors;
};

export const validatePythonRunnerStagingChangeSetConfig = (config, manifest) => {
  const errors = [];
  const require = (condition, message) => { if (!condition) errors.push(message); };
  const manifestErrors = validatePythonRunnerImageReleaseManifest(manifest);
  for (const error of manifestErrors) errors.push(`Release manifest: ${error}`);
  if (manifestErrors.length > 0) return errors;

  const accountId = String(config?.accountId ?? '');
  const region = String(config?.region ?? '');
  const vpcId = String(config?.vpcId ?? '');
  const subnetIds = normalizeSubnetIds(config?.privateSubnetIds);
  const hostedZoneId = String(config?.privateHostedZoneId ?? '');
  const runnerDnsName = String(config?.runnerDnsName ?? '');
  const certificateArn = String(config?.certificateArn ?? '');
  const runnerInstanceType = String(config?.runnerInstanceType ?? '');

  require(ACCOUNT_ID_PATTERN.test(accountId), 'AWS account ID must be exactly 12 digits.');
  require(REGION_PATTERN.test(region), 'AWS region has an invalid format.');
  require(VPC_ID_PATTERN.test(vpcId), 'VpcId has an invalid format.');
  require(subnetIds.length >= 2, 'At least two private subnet IDs are required.');
  require(subnetIds.every((id) => SUBNET_ID_PATTERN.test(id)), 'Every private subnet ID must have a valid format.');
  require(new Set(subnetIds).size === subnetIds.length, 'Private subnet IDs must be unique.');
  require(HOSTED_ZONE_ID_PATTERN.test(hostedZoneId), 'PrivateHostedZoneId has an invalid format.');
  require(DNS_NAME_PATTERN.test(runnerDnsName), 'RunnerDnsName must be a lowercase fully-qualified DNS name.');
  require(['t3.small', 't3.medium'].includes(runnerInstanceType), 'RunnerInstanceType must be t3.small or t3.medium.');

  const certificate = certificateArn.match(CERTIFICATE_ARN_PATTERN);
  require(Boolean(certificate), 'CertificateArn has an invalid ACM certificate ARN format.');
  if (certificate) {
    require(certificate[1] === region, 'CertificateArn region must match AWS region.');
    require(certificate[2] === accountId, 'CertificateArn account must match AWS account ID.');
  }

  const repository = String(manifest.repositoryUri ?? '').match(REPOSITORY_URI_PATTERN);
  require(Boolean(repository), `Release repository must target ${EXPECTED_REPOSITORY_NAME}.`);
  if (repository) {
    require(repository[1] === accountId, 'Release repository account must match AWS account ID.');
    require(repository[2] === region, 'Release repository region must match AWS region.');
  }
  require(manifest.imageUri === `${manifest.repositoryUri}@${manifest.imageDigest}`, 'Runner image URI must be digest-pinned from the validated release manifest.');
  return errors;
};

export const createPythonRunnerStagingChangeSetParameters = (config, manifest) => {
  const errors = validatePythonRunnerStagingChangeSetConfig(config, manifest);
  if (errors.length > 0) {
    throw new Error(`Python Runner staging change-set config validation failed:\n${errors.map((error) => `- ${error}`).join('\n')}`);
  }
  const subnetIds = normalizeSubnetIds(config.privateSubnetIds);
  return [
    { ParameterKey: 'EnvironmentName', ParameterValue: 'staging' },
    { ParameterKey: 'VpcId', ParameterValue: String(config.vpcId) },
    { ParameterKey: 'PrivateSubnetIds', ParameterValue: subnetIds.join(',') },
    { ParameterKey: 'PrivateHostedZoneId', ParameterValue: String(config.privateHostedZoneId) },
    { ParameterKey: 'RunnerDnsName', ParameterValue: String(config.runnerDnsName) },
    { ParameterKey: 'CertificateArn', ParameterValue: String(config.certificateArn) },
    { ParameterKey: 'RunnerServiceImageUri', ParameterValue: manifest.imageUri },
    { ParameterKey: 'RunnerInstanceType', ParameterValue: String(config.runnerInstanceType) }
  ];
};

export const validatePythonRunnerStagingChangeSetParameters = (parameters) => {
  const errors = [];
  if (!Array.isArray(parameters)) return ['Parameters must be an array.'];
  const keys = parameters.map((parameter) => parameter?.ParameterKey);
  if (!sameJson(keys, PARAMETER_KEYS)) errors.push('Parameter bundle keys and order must match the approved staging contract.');
  for (const parameter of parameters) {
    if (!parameter || typeof parameter !== 'object' || Array.isArray(parameter)) {
      errors.push('Every parameter entry must be an object.');
      continue;
    }
    if (!sameJson(Object.keys(parameter).sort(), ['ParameterKey', 'ParameterValue'])) {
      errors.push(`${parameter.ParameterKey ?? 'unknown'} must contain only ParameterKey and ParameterValue.`);
    }
    if (typeof parameter.ParameterValue !== 'string' || parameter.ParameterValue.length === 0) {
      errors.push(`${parameter.ParameterKey ?? 'unknown'} must contain a non-empty string ParameterValue.`);
    }
  }
  return errors;
};

export const validatePythonRunnerReleaseArtifactChecksum = (manifestSource, checksumSource) => {
  const errors = [];
  if (typeof manifestSource !== 'string') return ['Release manifest source must be text.'];
  if (typeof checksumSource !== 'string') return ['Release checksum source must be text.'];
  const match = checksumSource.match(CHECKSUM_PATTERN);
  if (!match) return ['Release checksum must use sha256sum format for python-runner-image-release.json only.'];
  const actual = createHash('sha256').update(manifestSource, 'utf8').digest('hex');
  if (actual !== match[1]) errors.push('Release manifest SHA-256 checksum does not match.');
  return errors;
};

export const loadPythonRunnerChangeSetReviewRoleTemplate = async (
  filePath = PYTHON_RUNNER_CHANGE_SET_REVIEW_ROLE_TEMPLATE_PATH
) => JSON.parse(await readFile(filePath, 'utf8'));

export const loadPythonRunnerStagingChangeSetWorkflow = async (
  filePath = PYTHON_RUNNER_STAGING_CHANGE_SET_WORKFLOW_PATH
) => readFile(filePath, 'utf8');

const assertValid = (name, errors) => {
  if (errors.length > 0) {
    throw new Error(`${name} validation failed:\n${errors.map((error) => `- ${error}`).join('\n')}`);
  }
  return true;
};

export const assertValidPythonRunnerChangeSetReviewRoleTemplate = (template) =>
  assertValid('Python Runner change-set review role template', validatePythonRunnerChangeSetReviewRoleTemplate(template));
export const assertValidPythonRunnerStagingChangeSetWorkflow = (source) =>
  assertValid('Python Runner staging change-set workflow', validatePythonRunnerStagingChangeSetWorkflow(source));
export const assertValidPythonRunnerStagingChangeSetParameters = (parameters) =>
  assertValid('Python Runner staging change-set parameters', validatePythonRunnerStagingChangeSetParameters(parameters));
export const assertValidPythonRunnerReleaseArtifactChecksum = (manifestSource, checksumSource) =>
  assertValid('Python Runner release artifact checksum', validatePythonRunnerReleaseArtifactChecksum(manifestSource, checksumSource));
