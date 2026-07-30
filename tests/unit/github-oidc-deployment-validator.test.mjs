import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadGitHubOidcDeploymentTemplate,
  loadStagingChangeSetWorkflow,
  validateGitHubOidcDeploymentTemplate,
  validateStagingChangeSetWorkflow
} from '../../scripts/lib/github-oidc-deployment-validator.mjs';

const loadTemplate = async () =>
  structuredClone(await loadGitHubOidcDeploymentTemplate());

const loadWorkflow = async () => await loadStagingChangeSetWorkflow();

const includesError = (errors, fragment) =>
  errors.some((error) => error.includes(fragment));

test('OIDC deployment templateとstaging change set workflowは安全契約を満たす', async () => {
  const [template, workflow] = await Promise.all([
    loadTemplate(),
    loadWorkflow()
  ]);

  assert.deepEqual(validateGitHubOidcDeploymentTemplate(template), []);
  assert.deepEqual(validateStagingChangeSetWorkflow(workflow), []);
});

test('validatorはOIDC subjectの既定値・wildcard・aud緩和を拒否する', async () => {
  const template = await loadTemplate();
  template.Parameters.GitHubOidcSubject.Default =
    'repo:mizzz-ivr/ai-code-dojo:environment:staging';
  template.Parameters.GitHubOidcSubject.AllowedPattern =
    '^repo:.*:environment:staging$';
  const trust =
    template.Resources.GitHubActionsDeploymentRole.Properties
      .AssumeRolePolicyDocument.Statement[0];
  trust.Condition.StringLike = trust.Condition.StringEquals;
  delete trust.Condition.StringEquals;

  const errors = validateGitHubOidcDeploymentTemplate(template);
  assert.equal(includesError(errors, 'must not have a default'), true);
  assert.equal(includesError(errors, 'exact ai-code-dojo staging environment subject'), true);
  assert.equal(includesError(errors, 'must not allow wildcard matching'), true);
  assert.equal(includesError(errors, 'must exactly match GitHub OIDC aud and sub'), true);
});

test('validatorはdeployment roleのchange set実行・stack変更権限を拒否する', async () => {
  const template = await loadTemplate();
  const policy =
    template.Resources.GitHubActionsDeploymentRole.Properties.Policies[1]
      .PolicyDocument.Statement[0];
  policy.Action = [
    'cloudformation:CreateChangeSet',
    'cloudformation:ExecuteChangeSet',
    'cloudformation:UpdateStack'
  ];

  const errors = validateGitHubOidcDeploymentTemplate(template);
  assert.equal(includesError(errors, 'create change sets without stack mutation'), true);
  assert.equal(includesError(errors, 'must not grant cloudformation:ExecuteChangeSet'), true);
});

test('validatorはPassRoleのresource拡大とservice制約欠落を拒否する', async () => {
  const template = await loadTemplate();
  const passRole =
    template.Resources.GitHubActionsDeploymentRole.Properties.Policies[2]
      .PolicyDocument.Statement[0];
  passRole.Resource = '*';
  delete passRole.Condition;

  const errors = validateGitHubOidcDeploymentTemplate(template);
  assert.equal(includesError(errors, 'must target CloudFormationExecutionRole only'), true);
  assert.equal(includesError(errors, 'must be limited to CloudFormation'), true);
});

test('validatorはCloudFormation execution roleのwildcard resourceを拒否する', async () => {
  const template = await loadTemplate();
  template.Resources.CloudFormationExecutionRole.Properties.Policies[0]
    .PolicyDocument.Statement[0].Resource = '*';

  const errors = validateGitHubOidcDeploymentTemplate(template);
  assert.equal(includesError(errors, 'SQS resource must be limited'), true);
  assert.equal(includesError(errors, 'must not use wildcard resources'), true);
});

test('workflow validatorは自動trigger・直接execute・長期credentialを拒否する', async () => {
  const workflow = await loadWorkflow();
  const unsafeWorkflow = `${workflow}
pull_request:
aws cloudformation execute-change-set
secrets.AWS_ACCESS_KEY_ID
secrets.AWS_SECRET_ACCESS_KEY
`;

  const errors = validateStagingChangeSetWorkflow(unsafeWorkflow);
  assert.equal(includesError(errors, 'must not run on pull requests'), true);
  assert.equal(includesError(errors, 'must not execute change sets'), true);
  assert.equal(includesError(errors, 'must not reference AWS access key secrets'), true);
  assert.equal(includesError(errors, 'must not reference AWS secret access key secrets'), true);
});

test('workflowは手動入力をshellへ直接展開せず環境変数へ隔離する', async () => {
  const workflow = await loadWorkflow();
  const maxReceiveCountExpressions =
    workflow.match(/\$\{\{ inputs\.max_receive_count \}\}/g) ?? [];
  const queueTypeExpressions =
    workflow.match(/\$\{\{ inputs\.queue_type \}\}/g) ?? [];

  assert.equal(maxReceiveCountExpressions.length, 1);
  assert.equal(queueTypeExpressions.length, 1);
  assert.equal(
    workflow.includes('INPUT_MAX_RECEIVE_COUNT: ${{ inputs.max_receive_count }}'),
    true
  );
  assert.equal(
    workflow.includes('INPUT_QUEUE_TYPE: ${{ inputs.queue_type }}'),
    true
  );
  assert.equal(workflow.includes('"${{ inputs.max_receive_count }}"'), false);
  assert.equal(workflow.includes('"${{ inputs.queue_type }}"'), false);
});

test('validatorは固定account IDとaccess key IDの混入を拒否する', async () => {
  const template = await loadTemplate();
  template.Metadata = {
    AccountId: '123456789012',
    AccessKeyId: 'AKIA1234567890ABCDEF'
  };

  const errors = validateGitHubOidcDeploymentTemplate(template);
  assert.equal(includesError(errors, 'literal AWS account ID'), true);
  assert.equal(includesError(errors, 'AWS access key ID'), true);
});
