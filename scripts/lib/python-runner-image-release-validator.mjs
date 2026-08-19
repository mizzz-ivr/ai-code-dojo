import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const PYTHON_RUNNER_IMAGE_RELEASE_TEMPLATE_PATH = path.resolve(
  process.cwd(),
  'infra/aws/cloudformation/python-runner-image-release-stack.json'
);
export const PYTHON_RUNNER_IMAGE_PUBLISH_WORKFLOW_PATH = path.resolve(
  process.cwd(),
  '.github/workflows/publish-python-runner-staging-image.yml'
);

const EXPECTED_REPOSITORY_NAME = 'ai-code-dojo-staging-python-runner';
const EXPECTED_GITHUB_ENVIRONMENT = 'staging-python-runner-image';
const EXPECTED_GITHUB_SUBJECT_PATTERN =
  '^repo:(mizzz-ivr/ai-code-dojo|mizzz-ivr@[0-9]+/ai-code-dojo@[0-9]+):environment:staging-python-runner-image$';
const EXPECTED_LIFECYCLE_POLICY = JSON.stringify({
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
});
const EXPECTED_REPOSITORY_ACTIONS = Object.freeze([
  'ecr:BatchCheckLayerAvailability',
  'ecr:CompleteLayerUpload',
  'ecr:DescribeImages',
  'ecr:DescribeRepositories',
  'ecr:GetLifecyclePolicy',
  'ecr:InitiateLayerUpload',
  'ecr:ListImages',
  'ecr:PutImage',
  'ecr:UploadLayerPart'
]);
const REPOSITORY_URI_PATTERN = /^(?<account>[0-9]{12})\.dkr\.ecr\.(?<region>[a-z0-9-]+)\.amazonaws\.com\/ai-code-dojo-staging-python-runner$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const RUN_ID_PATTERN = /^[1-9][0-9]*$/;

const sameJson = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);
const sorted = (values) => [...values].sort();
const actionsOf = (statement) =>
  Array.isArray(statement?.Action) ? statement.Action : [statement?.Action].filter(Boolean);
const statementsOf = (role) =>
  (role?.Properties?.Policies ?? []).flatMap((policy) => policy?.PolicyDocument?.Statement ?? []);
const statementBySid = (role, sid) => statementsOf(role).find((statement) => statement?.Sid === sid);
const exactActions = (statement, expected) => sameJson(sorted(actionsOf(statement)), sorted(expected));

export const validatePythonRunnerImageReleaseTemplate = (template) => {
  const errors = [];
  const require = (condition, message) => { if (!condition) errors.push(message); };

  require(template && typeof template === 'object' && !Array.isArray(template), 'Template must be an object.');
  if (errors.length > 0) return errors;

  require(template.AWSTemplateFormatVersion === '2010-09-09', 'AWSTemplateFormatVersion must be 2010-09-09.');
  require(Boolean(template.Description), 'Template Description is required.');
  require(template.Metadata?.DeploymentSafety?.Mode === 'review-only', 'DeploymentSafety.Mode must be review-only.');
  require(template.Metadata?.DeploymentSafety?.RequiresExplicitApproval === true, 'DeploymentSafety must require explicit approval.');
  require(template.Metadata?.DeploymentSafety?.ActualPublishDuringReview === false, 'Review implementation must not perform an actual image publish.');
  require(template.Metadata?.DeploymentSafety?.PythonPublicGate === 'disabled', 'Python public gate must remain disabled.');
  require(
    template.Metadata?.DeploymentSafety?.ReleaseIdentity === 'source-commit-tag-and-registry-digest',
    'Release identity must bind source commit tag and registry digest.'
  );

  const parameters = template.Parameters ?? {};
  require(
    sameJson(parameters.EnvironmentName?.AllowedValues, ['staging']) && parameters.EnvironmentName?.Default === 'staging',
    'EnvironmentName must be fixed to staging.'
  );
  require(
    sameJson(parameters.RepositoryName?.AllowedValues, [EXPECTED_REPOSITORY_NAME])
      && parameters.RepositoryName?.Default === EXPECTED_REPOSITORY_NAME,
    `RepositoryName must be fixed to ${EXPECTED_REPOSITORY_NAME}.`
  );
  require(parameters.GitHubOidcProviderArn?.Default === undefined, 'GitHubOidcProviderArn must not have a default.');
  require(parameters.GitHubOidcSubject?.Default === undefined, 'GitHubOidcSubject must not have a default.');
  require(
    parameters.GitHubOidcSubject?.AllowedPattern === EXPECTED_GITHUB_SUBJECT_PATTERN,
    `GitHubOidcSubject must require the exact ${EXPECTED_GITHUB_ENVIRONMENT} environment subject.`
  );
  require(
    !String(parameters.GitHubOidcSubject?.AllowedPattern ?? '').includes('.*'),
    'GitHubOidcSubject must not allow wildcard matching.'
  );

  const repository = template.Resources?.PythonRunnerImageRepository;
  require(repository?.Type === 'AWS::ECR::Repository', 'PythonRunnerImageRepository must be AWS::ECR::Repository.');
  if (repository?.Type === 'AWS::ECR::Repository') {
    const props = repository.Properties ?? {};
    require(repository.DeletionPolicy === 'Retain', 'PythonRunnerImageRepository DeletionPolicy must be Retain.');
    require(repository.UpdateReplacePolicy === 'Retain', 'PythonRunnerImageRepository UpdateReplacePolicy must be Retain.');
    require(sameJson(props.RepositoryName, { Ref: 'RepositoryName' }), 'RepositoryName must come from the fixed RepositoryName parameter.');
    require(props.ImageTagMutability === 'IMMUTABLE', 'Python Runner image tags must be fully IMMUTABLE.');
    require(!('ImageTagMutabilityExclusionFilters' in props), 'Immutable repository must not define tag mutability exclusions.');
    require(props.ImageScanningConfiguration?.ScanOnPush === true, 'ECR scan-on-push must be enabled.');
    require(sameJson(props.EncryptionConfiguration, { EncryptionType: 'AES256' }), 'ECR encryption must be explicitly AES256.');
    require(props.EmptyOnDelete === false, 'Repository must not empty images automatically on stack deletion.');
    require(
      props.LifecyclePolicy?.LifecyclePolicyText === EXPECTED_LIFECYCLE_POLICY,
      'Lifecycle policy must expire only untagged images after 7 days.'
    );
    require(!('RepositoryPolicyText' in props), 'Repository must not add a broad resource policy in this stack.');
  }

  const publisher = template.Resources?.GitHubActionsImagePublisherRole;
  require(publisher?.Type === 'AWS::IAM::Role', 'GitHubActionsImagePublisherRole must be AWS::IAM::Role.');
  if (publisher?.Type === 'AWS::IAM::Role') {
    const props = publisher.Properties ?? {};
    require(!('RoleName' in props), 'Publisher role must not fix RoleName.');
    require(!('ManagedPolicyArns' in props), 'Publisher role must not attach managed policies.');
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
    }]), 'Publisher role trust must exactly match GitHub OIDC aud and dedicated environment subject.');

    const auth = statementBySid(publisher, 'GetEcrAuthorizationToken');
    require(exactActions(auth, ['ecr:GetAuthorizationToken']), 'Publisher authentication statement must grant only ecr:GetAuthorizationToken.');
    require(auth?.Resource === '*', 'ecr:GetAuthorizationToken must use its required wildcard resource.');

    const publish = statementBySid(publisher, 'PublishAndReadBackPythonRunnerImage');
    require(exactActions(publish, EXPECTED_REPOSITORY_ACTIONS), 'Publisher repository actions must match the immutable push/readback contract.');
    require(
      sameJson(publish?.Resource, { 'Fn::GetAtt': ['PythonRunnerImageRepository', 'Arn'] }),
      'Publisher repository actions must target PythonRunnerImageRepository only.'
    );

    const forbidden = new Set([
      'ecr:BatchDeleteImage',
      'ecr:CreateRepository',
      'ecr:DeleteLifecyclePolicy',
      'ecr:DeleteRepository',
      'ecr:DeleteRepositoryPolicy',
      'ecr:PutImageScanningConfiguration',
      'ecr:PutImageTagMutability',
      'ecr:PutLifecyclePolicy',
      'ecr:SetRepositoryPolicy',
      'ecr:TagResource',
      'ecr:UntagResource',
      'iam:*',
      'cloudformation:*'
    ]);
    const forbiddenAction = statementsOf(publisher).flatMap(actionsOf).find((action) => forbidden.has(action));
    require(forbiddenAction === undefined, `Publisher role must not grant ${forbiddenAction ?? 'repository mutation/deletion actions'}.`);
  }

  for (const output of [
    'PythonRunnerImageRepositoryArn',
    'PythonRunnerImageRepositoryUri',
    'GitHubActionsImagePublisherRoleArn',
    'ExpectedGitHubOidcSubject'
  ]) {
    require(template.Outputs?.[output]?.Value !== undefined, `Output ${output} is required.`);
  }

  const serialized = JSON.stringify(template);
  require(!/AKIA[0-9A-Z]{16}/.test(serialized), 'Template must not contain an AWS access key ID.');
  require(!/\b\d{12}\b/.test(serialized), 'Template must not contain a literal AWS account ID.');
  return errors;
};

export const validatePythonRunnerImagePublishWorkflow = (source) => {
  const errors = [];
  const requireIncludes = (fragment, message) => { if (!source.includes(fragment)) errors.push(message); };
  const requireExcludes = (fragment, message) => { if (source.includes(fragment)) errors.push(message); };

  if (typeof source !== 'string' || source.length === 0) return ['Workflow source is required.'];

  requireIncludes('workflow_dispatch:', 'Publish workflow must be workflow_dispatch only.');
  requireExcludes('pull_request:', 'Publish workflow must not run on pull requests.');
  requireExcludes('\npush:', 'Publish workflow must not run on push.');
  requireExcludes('\nschedule:', 'Publish workflow must not run on a schedule.');
  requireIncludes('contents: read', 'Publish workflow must grant contents: read only for repository contents.');
  requireIncludes('id-token: write', 'Publish workflow must grant id-token: write for OIDC.');
  requireExcludes('packages: write', 'Publish workflow must not grant GitHub Packages write permission.');
  requireIncludes(
    "if: github.ref == 'refs/heads/main' && inputs.confirm_publish == 'PUBLISH_STAGING_PYTHON_RUNNER_IMAGE'",
    'Publish workflow must require main and explicit confirmation.'
  );
  requireIncludes(`environment: ${EXPECTED_GITHUB_ENVIRONMENT}`, 'Publish workflow must use the dedicated staging image GitHub Environment.');
  requireIncludes('cancel-in-progress: false', 'Publish workflow must not cancel an in-progress image publish.');
  requireIncludes('uses: aws-actions/configure-aws-credentials@v6.2.3', 'Publish workflow must pin configure-aws-credentials to v6.2.3.');
  requireIncludes('mask-aws-account-id: true', 'Publish workflow must mask the AWS account ID.');
  requireIncludes('allowed-account-ids: ${{ env.AWS_ACCOUNT_ID }}', 'Publish workflow must restrict the assumed AWS account.');
  requireIncludes('vars.AWS_STAGING_PYTHON_RUNNER_ECR_PUBLISH_ROLE_ARN', 'Publish workflow must read the dedicated publisher role ARN from environment variables.');
  requireIncludes('vars.AWS_STAGING_PYTHON_RUNNER_ECR_URI', 'Publish workflow must read the ECR repository URI from environment variables.');
  requireIncludes('vars.AWS_STAGING_ACCOUNT_ID', 'Publish workflow must read the expected AWS account ID from environment variables.');
  requireIncludes('vars.AWS_STAGING_REGION', 'Publish workflow must read the staging AWS region from environment variables.');
  requireIncludes('IMAGE_TAG: sha-${{ github.sha }}', 'Publish workflow must derive the immutable tag from the full source commit.');
  requireIncludes('node --test tests/unit/python-runner-trivy-exception-validator.test.mjs', 'Publish workflow must validate the Trivy exception contract before scanning.');
  requireIncludes("severity: 'HIGH,CRITICAL'", 'Publish workflow must block HIGH and CRITICAL vulnerabilities outside approved exceptions.');
  requireIncludes("trivyignores: '.trivyignore.yaml'", 'Publish workflow must use the scoped expiring Trivy exception file.');
  requireIncludes('aws ecr describe-repositories', 'Publish workflow must verify repository security settings before push.');
  requireIncludes('aws ecr get-lifecycle-policy', 'Publish workflow must verify the lifecycle policy before push.');
  requireIncludes('aws ecr list-images', 'Publish workflow must reject an existing immutable source tag before push.');
  requireIncludes('aws ecr get-login-password', 'Publish workflow must authenticate to ECR with the short-lived OIDC session.');
  requireIncludes('docker push "${PUBLISH_IMAGE}"', 'Publish workflow must push only the source-commit tag after quality gates pass.');
  requireIncludes('aws ecr describe-images', 'Publish workflow must resolve the registry digest after push.');
  requireIncludes('create-python-runner-image-release-manifest.mjs', 'Publish workflow must create a validated release manifest.');
  requireIncludes('python-runner-image-release.json.sha256', 'Publish workflow must checksum the release manifest artifact.');
  requireIncludes('actions/upload-artifact@v4', 'Publish workflow must upload the release manifest as an artifact.');

  for (const [fragment, message] of [
    ['secrets.AWS_ACCESS_KEY_ID', 'Publish workflow must not reference AWS access key secrets.'],
    ['secrets.AWS_SECRET_ACCESS_KEY', 'Publish workflow must not reference AWS secret access key secrets.'],
    ['secrets.AWS_SESSION_TOKEN', 'Publish workflow must not reference AWS session token secrets.'],
    ['aws ecr create-repository', 'Publish workflow must not create ECR repositories.'],
    ['aws ecr delete-repository', 'Publish workflow must not delete ECR repositories.'],
    ['aws ecr put-image-tag-mutability', 'Publish workflow must not mutate ECR tag immutability.'],
    ['aws ecr put-lifecycle-policy', 'Publish workflow must not mutate ECR lifecycle policy.'],
    ['aws cloudformation execute-change-set', 'Publish workflow must not execute CloudFormation change sets.'],
    ['aws cloudformation deploy', 'Publish workflow must not deploy CloudFormation.'],
    [':latest', 'Publish workflow must not publish mutable latest tags.']
  ]) requireExcludes(fragment, message);

  return errors;
};

export const validatePythonRunnerImageReleaseManifest = (manifest) => {
  const errors = [];
  const require = (condition, message) => { if (!condition) errors.push(message); };
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return ['Release manifest must be an object.'];

  const expectedKeys = [
    'artifact',
    'environment',
    'imageDigest',
    'imageTag',
    'imageUri',
    'repositoryUri',
    'schemaVersion',
    'sourceCommit',
    'sourceRef',
    'sourceRepository',
    'workflowRunAttempt',
    'workflowRunId'
  ];
  require(sameJson(Object.keys(manifest).sort(), expectedKeys), 'Release manifest must contain exactly the approved fields.');
  require(manifest.schemaVersion === 1, 'Release manifest schemaVersion must be 1.');
  require(manifest.artifact === 'python-runner-service-image', 'Release manifest artifact must identify the Python Runner service image.');
  require(manifest.environment === 'staging', 'Release manifest environment must be staging.');
  require(manifest.sourceRepository === 'mizzz-ivr/ai-code-dojo', 'Release manifest sourceRepository must be mizzz-ivr/ai-code-dojo.');
  require(manifest.sourceRef === 'refs/heads/main', 'Release manifest sourceRef must be refs/heads/main.');
  require(COMMIT_PATTERN.test(String(manifest.sourceCommit ?? '')), 'Release manifest sourceCommit must be a full lowercase git SHA.');
  require(manifest.imageTag === `sha-${manifest.sourceCommit}`, 'Release manifest imageTag must be derived from sourceCommit.');
  require(DIGEST_PATTERN.test(String(manifest.imageDigest ?? '')), 'Release manifest imageDigest must be a sha256 digest.');
  const repositoryMatch = String(manifest.repositoryUri ?? '').match(REPOSITORY_URI_PATTERN);
  require(Boolean(repositoryMatch), `Release manifest repositoryUri must target ${EXPECTED_REPOSITORY_NAME} in private ECR.`);
  require(manifest.imageUri === `${manifest.repositoryUri}@${manifest.imageDigest}`, 'Release manifest imageUri must pin repositoryUri by imageDigest.');
  require(RUN_ID_PATTERN.test(String(manifest.workflowRunId ?? '')), 'Release manifest workflowRunId must be a positive integer string.');
  require(RUN_ID_PATTERN.test(String(manifest.workflowRunAttempt ?? '')), 'Release manifest workflowRunAttempt must be a positive integer string.');
  return errors;
};

export const loadPythonRunnerImageReleaseTemplate = async (filePath = PYTHON_RUNNER_IMAGE_RELEASE_TEMPLATE_PATH) =>
  JSON.parse(await readFile(filePath, 'utf8'));
export const loadPythonRunnerImagePublishWorkflow = async (filePath = PYTHON_RUNNER_IMAGE_PUBLISH_WORKFLOW_PATH) =>
  readFile(filePath, 'utf8');

const assertValid = (label, errors) => {
  if (errors.length > 0) throw new Error(`${label} validation failed:\n${errors.map((error) => `- ${error}`).join('\n')}`);
  return true;
};

export const assertValidPythonRunnerImageReleaseTemplate = (template) =>
  assertValid('Python Runner image release template', validatePythonRunnerImageReleaseTemplate(template));
export const assertValidPythonRunnerImagePublishWorkflow = (source) =>
  assertValid('Python Runner image publish workflow', validatePythonRunnerImagePublishWorkflow(source));
export const assertValidPythonRunnerImageReleaseManifest = (manifest) =>
  assertValid('Python Runner image release manifest', validatePythonRunnerImageReleaseManifest(manifest));
