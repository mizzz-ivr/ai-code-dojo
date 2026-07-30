import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const GITHUB_OIDC_DEPLOYMENT_TEMPLATE_PATH = path.resolve(
  process.cwd(),
  'infra/aws/cloudformation/github-oidc-deployment-role-stack.json'
);

export const STAGING_CHANGE_SET_WORKFLOW_PATH = path.resolve(
  process.cwd(),
  '.github/workflows/deploy-sqs-staging-change-set.yml'
);

const sameJson = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);
const sorted = (values) => [...values].sort();
const normalizeActions = (action) => Array.isArray(action) ? action : [action].filter(Boolean);

const getPolicyStatements = (role) => {
  const policies = role?.Properties?.Policies;
  if (!Array.isArray(policies)) return [];
  return policies.flatMap((policy) => policy?.PolicyDocument?.Statement ?? []);
};

const getStatementBySid = (role, sid) =>
  getPolicyStatements(role).find((statement) => statement?.Sid === sid);

const containsForbiddenAction = (role, forbiddenActions) => {
  const actions = getPolicyStatements(role).flatMap((statement) =>
    normalizeActions(statement?.Action)
  );
  return forbiddenActions.find((action) => actions.includes(action));
};

export const validateGitHubOidcDeploymentTemplate = (template) => {
  const errors = [];
  const requireCondition = (condition, message) => {
    if (!condition) errors.push(message);
  };

  requireCondition(
    template && typeof template === 'object' && !Array.isArray(template),
    'Template must be an object.'
  );
  if (errors.length > 0) return errors;

  requireCondition(
    template.AWSTemplateFormatVersion === '2010-09-09',
    'AWSTemplateFormatVersion must be 2010-09-09.'
  );
  requireCondition(
    typeof template.Description === 'string' && template.Description.length > 0,
    'Template Description is required.'
  );

  const parameters = template.Parameters ?? {};
  requireCondition(
    parameters.GitHubOidcProviderArn?.Default === undefined,
    'GitHubOidcProviderArn must not have a default.'
  );
  requireCondition(
    parameters.GitHubOidcSubject?.Default === undefined,
    'GitHubOidcSubject must not have a default.'
  );
  requireCondition(
    parameters.GitHubOidcSubject?.AllowedPattern === '^repo:[^*?\\s]+:environment:staging$',
    'GitHubOidcSubject must require an exact staging environment subject.'
  );
  requireCondition(
    !String(parameters.GitHubOidcSubject?.AllowedPattern ?? '').includes('.*'),
    'GitHubOidcSubject must not allow wildcard matching.'
  );
  requireCondition(
    sameJson(parameters.EnvironmentName?.AllowedValues, ['staging'])
      && parameters.EnvironmentName?.Default === 'staging',
    'EnvironmentName must be fixed to staging.'
  );
  requireCondition(
    parameters.TargetStackName?.Default === 'ai-code-dojo-staging-sqs',
    'TargetStackName default must be ai-code-dojo-staging-sqs.'
  );

  const resources = template.Resources ?? {};
  const executionRole = resources.CloudFormationExecutionRole;
  const deploymentRole = resources.GitHubActionsDeploymentRole;

  requireCondition(
    executionRole?.Type === 'AWS::IAM::Role',
    'CloudFormationExecutionRole must be AWS::IAM::Role.'
  );
  requireCondition(
    deploymentRole?.Type === 'AWS::IAM::Role',
    'GitHubActionsDeploymentRole must be AWS::IAM::Role.'
  );

  for (const [roleName, role] of [
    ['CloudFormationExecutionRole', executionRole],
    ['GitHubActionsDeploymentRole', deploymentRole]
  ]) {
    if (role?.Type !== 'AWS::IAM::Role') continue;
    requireCondition(
      !('RoleName' in (role.Properties ?? {})),
      `${roleName} must not fix RoleName.`
    );
    requireCondition(
      !('ManagedPolicyArns' in (role.Properties ?? {})),
      `${roleName} must not attach managed policies.`
    );
  }

  if (executionRole?.Type === 'AWS::IAM::Role') {
    requireCondition(
      sameJson(executionRole.Properties?.AssumeRolePolicyDocument?.Statement, [{
        Effect: 'Allow',
        Principal: { Service: 'cloudformation.amazonaws.com' },
        Action: 'sts:AssumeRole'
      }]),
      'CloudFormationExecutionRole trust must allow CloudFormation only.'
    );

    const queueStatement = getStatementBySid(executionRole, 'ManageStagingGradingQueues');
    requireCondition(
      sameJson(sorted(normalizeActions(queueStatement?.Action)), sorted([
        'sqs:CreateQueue',
        'sqs:GetQueueAttributes',
        'sqs:GetQueueUrl',
        'sqs:ListQueueTags',
        'sqs:TagQueue',
        'sqs:UntagQueue',
        'sqs:SetQueueAttributes',
        'sqs:DeleteQueue'
      ])),
      'CloudFormationExecutionRole SQS actions must match the staging queue lifecycle contract.'
    );
    requireCondition(
      queueStatement?.Resource?.['Fn::Sub']
        === 'arn:${AWS::Partition}:sqs:${AWS::Region}:${AWS::AccountId}:ai-code-dojo-${EnvironmentName}-grading*',
      'CloudFormationExecutionRole SQS resource must be limited to staging grading queues.'
    );

    const roleStatement = getStatementBySid(executionRole, 'ManageGeneratedQueueWorkloadRoles');
    requireCondition(
      sameJson(sorted(normalizeActions(roleStatement?.Action)), sorted([
        'iam:CreateRole',
        'iam:DeleteRole',
        'iam:GetRole',
        'iam:TagRole',
        'iam:UntagRole',
        'iam:PutRolePolicy',
        'iam:DeleteRolePolicy',
        'iam:GetRolePolicy',
        'iam:ListRolePolicies',
        'iam:UpdateAssumeRolePolicy'
      ])),
      'CloudFormationExecutionRole IAM actions must match the generated workload role lifecycle contract.'
    );
    requireCondition(
      roleStatement?.Resource?.['Fn::Sub']
        === 'arn:${AWS::Partition}:iam::${AWS::AccountId}:role/${TargetStackName}-*',
      'CloudFormationExecutionRole IAM resource must be limited to target stack generated roles.'
    );

    for (const statement of getPolicyStatements(executionRole)) {
      requireCondition(
        statement?.Resource !== '*',
        'CloudFormationExecutionRole must not use wildcard resources.'
      );
    }
  }

  if (deploymentRole?.Type === 'AWS::IAM::Role') {
    const trust = deploymentRole.Properties?.AssumeRolePolicyDocument?.Statement;
    requireCondition(
      Array.isArray(trust) && trust.length === 1,
      'GitHubActionsDeploymentRole must contain one trust statement.'
    );
    const trustStatement = Array.isArray(trust) ? trust[0] : null;
    requireCondition(
      sameJson(trustStatement?.Principal, {
        Federated: { Ref: 'GitHubOidcProviderArn' }
      }),
      'GitHubActionsDeploymentRole trust must use GitHubOidcProviderArn only.'
    );
    requireCondition(
      trustStatement?.Action === 'sts:AssumeRoleWithWebIdentity',
      'GitHubActionsDeploymentRole trust must use AssumeRoleWithWebIdentity.'
    );
    requireCondition(
      sameJson(trustStatement?.Condition, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          'token.actions.githubusercontent.com:sub': { Ref: 'GitHubOidcSubject' }
        }
      }),
      'GitHubActionsDeploymentRole trust must exactly match GitHub OIDC aud and sub.'
    );

    const validateStatement = getStatementBySid(deploymentRole, 'ValidateSqsTemplate');
    requireCondition(
      sameJson(normalizeActions(validateStatement?.Action), ['cloudformation:ValidateTemplate']),
      'Deployment role validation action must be ValidateTemplate only.'
    );
    requireCondition(
      validateStatement?.Resource === '*',
      'ValidateTemplate must use its required wildcard resource.'
    );

    const createStatement = getStatementBySid(deploymentRole, 'CreateTargetStackChangeSet');
    requireCondition(
      sameJson(normalizeActions(createStatement?.Action), ['cloudformation:CreateChangeSet']),
      'Deployment role must create change sets without stack mutation actions.'
    );
    requireCondition(
      createStatement?.Resource?.['Fn::Sub']
        === 'arn:${AWS::Partition}:cloudformation:${AWS::Region}:${AWS::AccountId}:stack/${TargetStackName}/*',
      'CreateChangeSet must be limited to TargetStackName.'
    );
    requireCondition(
      sameJson(createStatement?.Condition, {
        ArnEquals: {
          'cloudformation:RoleArn': {
            'Fn::GetAtt': ['CloudFormationExecutionRole', 'Arn']
          }
        }
      }),
      'CreateChangeSet must require the approved CloudFormation execution role.'
    );

    const reviewStackStatement = getStatementBySid(deploymentRole, 'ReviewTargetStack');
    requireCondition(
      sameJson(sorted(normalizeActions(reviewStackStatement?.Action)), sorted([
        'cloudformation:DescribeStacks',
        'cloudformation:ListChangeSets',
        'cloudformation:GetTemplate'
      ])),
      'Deployment role stack review actions must be read-only.'
    );
    requireCondition(
      reviewStackStatement?.Resource?.['Fn::Sub']
        === 'arn:${AWS::Partition}:cloudformation:${AWS::Region}:${AWS::AccountId}:stack/${TargetStackName}/*',
      'Stack review actions must be limited to TargetStackName.'
    );

    const reviewChangeSetStatement = getStatementBySid(deploymentRole, 'ReviewGeneratedChangeSet');
    requireCondition(
      sameJson(normalizeActions(reviewChangeSetStatement?.Action), ['cloudformation:DescribeChangeSet']),
      'Deployment role change set review action must be DescribeChangeSet only.'
    );
    requireCondition(
      reviewChangeSetStatement?.Resource?.['Fn::Sub']
        === 'arn:${AWS::Partition}:cloudformation:${AWS::Region}:${AWS::AccountId}:changeSet/ai-code-dojo-staging-*/*',
      'DescribeChangeSet must be limited to generated staging change sets.'
    );

    const passRoleStatement = getStatementBySid(deploymentRole, 'PassApprovedExecutionRole');
    requireCondition(
      sameJson(normalizeActions(passRoleStatement?.Action), ['iam:PassRole']),
      'Deployment role must only pass the approved execution role.'
    );
    requireCondition(
      sameJson(passRoleStatement?.Resource, {
        'Fn::GetAtt': ['CloudFormationExecutionRole', 'Arn']
      }),
      'iam:PassRole must target CloudFormationExecutionRole only.'
    );
    requireCondition(
      passRoleStatement?.Condition?.StringEquals?.['iam:PassedToService']
        === 'cloudformation.amazonaws.com',
      'iam:PassRole must be limited to CloudFormation.'
    );

    const forbidden = containsForbiddenAction(deploymentRole, [
      'cloudformation:ExecuteChangeSet',
      'cloudformation:CreateStack',
      'cloudformation:UpdateStack',
      'cloudformation:DeleteStack',
      'iam:*',
      'cloudformation:*'
    ]);
    requireCondition(
      forbidden === undefined,
      `GitHubActionsDeploymentRole must not grant ${forbidden ?? 'forbidden mutation actions'}.`
    );
  }

  for (const output of [
    'GitHubActionsDeploymentRoleArn',
    'CloudFormationExecutionRoleArn',
    'ExpectedGitHubOidcSubject',
    'TargetStackName'
  ]) {
    requireCondition(
      template.Outputs?.[output]?.Value !== undefined,
      `Output ${output} is required.`
    );
  }

  const serialized = JSON.stringify(template);
  requireCondition(
    !/AKIA[0-9A-Z]{16}/.test(serialized),
    'Template must not contain an AWS access key ID.'
  );
  requireCondition(
    !/\b\d{12}\b/.test(serialized),
    'Template must not contain a literal AWS account ID.'
  );
  requireCondition(
    !serialized.includes('secrets.AWS_ACCESS_KEY_ID'),
    'Template must not reference long-lived AWS credentials.'
  );

  return errors;
};

export const validateStagingChangeSetWorkflow = (source) => {
  const errors = [];
  const requireIncludes = (fragment, message) => {
    if (!source.includes(fragment)) errors.push(message);
  };
  const requireExcludes = (fragment, message) => {
    if (source.includes(fragment)) errors.push(message);
  };

  if (typeof source !== 'string' || source.length === 0) {
    return ['Workflow source is required.'];
  }

  requireIncludes('workflow_dispatch:', 'Workflow must be workflow_dispatch only.');
  requireExcludes('pull_request:', 'Workflow must not run on pull requests.');
  requireExcludes('\npush:', 'Workflow must not run on push.');
  requireExcludes('\nschedule:', 'Workflow must not run on a schedule.');
  requireIncludes('contents: read', 'Workflow permissions must include contents: read.');
  requireIncludes('id-token: write', 'Workflow permissions must include id-token: write.');
  requireIncludes("if: github.ref == 'refs/heads/main'", 'Workflow must reject non-main refs.');
  requireIncludes('environment: staging', 'Workflow must use the staging GitHub Environment.');
  requireIncludes(
    'uses: aws-actions/configure-aws-credentials@v6',
    'Workflow must use configure-aws-credentials v6.'
  );
  requireIncludes(
    'role-to-assume: ${{ env.DEPLOY_ROLE_ARN }}',
    'Workflow must assume the deployment role from a GitHub Environment variable.'
  );
  requireIncludes('mask-aws-account-id: true', 'Workflow must mask the AWS account ID.');
  requireIncludes(
    'vars.AWS_STAGING_DEPLOY_ROLE_ARN',
    'Workflow must read AWS_STAGING_DEPLOY_ROLE_ARN from environment variables.'
  );
  requireIncludes(
    'vars.AWS_STAGING_CFN_EXECUTION_ROLE_ARN',
    'Workflow must read AWS_STAGING_CFN_EXECUTION_ROLE_ARN from environment variables.'
  );
  requireIncludes(
    'vars.AWS_STAGING_SQS_STACK_NAME',
    'Workflow must read AWS_STAGING_SQS_STACK_NAME from environment variables.'
  );
  requireIncludes(
    'aws cloudformation validate-template',
    'Workflow must validate the CloudFormation template.'
  );
  requireIncludes(
    'aws cloudformation create-change-set',
    'Workflow must create a CloudFormation change set.'
  );
  requireIncludes(
    'aws cloudformation describe-change-set',
    'Workflow must review the CloudFormation change set.'
  );
  requireIncludes('--capabilities CAPABILITY_IAM', 'Workflow must acknowledge IAM resources.');
  requireIncludes(
    '--role-arn "${CFN_EXECUTION_ROLE_ARN}"',
    'Workflow must use the approved CloudFormation execution role.'
  );
  requireIncludes(
    'Execute: **未実施**',
    'Workflow summary must state that execution is not performed.'
  );
  requireExcludes('execute-change-set', 'Workflow must not execute change sets.');
  requireExcludes('aws cloudformation deploy', 'Workflow must not use direct CloudFormation deploy.');
  requireExcludes('aws cloudformation create-stack', 'Workflow must not create stacks directly.');
  requireExcludes('aws cloudformation update-stack', 'Workflow must not update stacks directly.');
  requireExcludes('aws cloudformation delete-stack', 'Workflow must not delete stacks.');
  requireExcludes('secrets.AWS_ACCESS_KEY_ID', 'Workflow must not reference AWS access key secrets.');
  requireExcludes('secrets.AWS_SECRET_ACCESS_KEY', 'Workflow must not reference AWS secret access key secrets.');
  requireExcludes('secrets.AWS_SESSION_TOKEN', 'Workflow must not reference AWS session token secrets.');

  return errors;
};

export const loadGitHubOidcDeploymentTemplate = async (
  templatePath = GITHUB_OIDC_DEPLOYMENT_TEMPLATE_PATH
) => JSON.parse(await readFile(templatePath, 'utf8'));

export const loadStagingChangeSetWorkflow = async (
  workflowPath = STAGING_CHANGE_SET_WORKFLOW_PATH
) => readFile(workflowPath, 'utf8');

export const assertValidGitHubOidcDeployment = (template, workflowSource) => {
  const errors = [
    ...validateGitHubOidcDeploymentTemplate(template),
    ...validateStagingChangeSetWorkflow(workflowSource)
  ];
  if (errors.length > 0) {
    throw new Error(
      `GitHub OIDC deployment validation failed:\n${errors
        .map((error) => `- ${error}`)
        .join('\n')}`
    );
  }
  return true;
};
