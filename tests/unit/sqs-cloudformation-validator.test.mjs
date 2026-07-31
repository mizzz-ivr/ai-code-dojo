import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadSqsCloudFormationTemplate,
  validateSqsCloudFormationTemplate
} from '../../scripts/lib/sqs-cloudformation-validator.mjs';

const loadTemplate = async () => structuredClone(await loadSqsCloudFormationTemplate());

const includesError = (errors, fragment) => errors.some((error) => error.includes(fragment));

test('SQS CloudFormation templateはresource・redrive・IAM・output契約を満たす', async () => {
  const template = await loadTemplate();
  assert.deepEqual(validateSqsCloudFormationTemplate(template), []);
});

test('validatorはproducer権限の拡大とwildcard resourceを拒否する', async () => {
  const template = await loadTemplate();
  const statement = template.Resources.ProducerRole.Properties.Policies[0].PolicyDocument.Statement[0];
  statement.Action.push('sqs:PurgeQueue');
  statement.Resource = '*';

  const errors = validateSqsCloudFormationTemplate(template);
  assert.equal(includesError(errors, 'ProducerRole actions must be exactly'), true);
  assert.equal(includesError(errors, 'ProducerRole resource must be SourceQueue ARN only'), true);
  assert.equal(includesError(errors, 'must not grant sqs:PurgeQueue'), true);
});

test('validatorはWorker retry用SendMessageの欠落を拒否する', async () => {
  const template = await loadTemplate();
  const statement = template.Resources.ConsumerRole.Properties.Policies[0].PolicyDocument.Statement[0];
  statement.Action = statement.Action.filter((action) => action !== 'sqs:SendMessage');

  const errors = validateSqsCloudFormationTemplate(template);
  assert.equal(includesError(errors, 'ConsumerRole actions must be exactly'), true);
});

test('validatorはconsumerのDLQ read権限とsource queue以外のresourceを拒否する', async () => {
  const template = await loadTemplate();
  const statement = template.Resources.ConsumerRole.Properties.Policies[0].PolicyDocument.Statement[0];
  statement.Action.push('sqs:GetQueueAttributes');
  statement.Resource = {
    'Fn::GetAtt': ['DeadLetterQueue', 'Arn']
  };

  const errors = validateSqsCloudFormationTemplate(template);
  assert.equal(includesError(errors, 'ConsumerRole actions must be exactly'), true);
  assert.equal(includesError(errors, 'ConsumerRole resource must be SourceQueue ARN only'), true);
});

test('validatorはDLQ redriveのallowAllと循環参照を拒否する', async () => {
  const template = await loadTemplate();
  const redrive = template.Resources.DeadLetterQueue.Properties.RedriveAllowPolicy;
  redrive.redrivePermission = 'allowAll';
  redrive.sourceQueueArns = [{
    'Fn::GetAtt': ['SourceQueue', 'Arn']
  }];

  const errors = validateSqsCloudFormationTemplate(template);
  assert.equal(includesError(errors, 'RedriveAllowPolicy must use byQueue'), true);
  assert.equal(includesError(errors, 'must derive the deterministic source queue ARN'), true);
  assert.equal(includesError(errors, 'must avoid a SourceQueue GetAtt circular dependency'), true);
});

test('validatorはSSE無効化・TLS deny欠落・FIFO命名不整合を拒否する', async () => {
  const template = await loadTemplate();
  template.Resources.SourceQueue.Properties.SqsManagedSseEnabled = false;
  template.Resources.SourceQueue.Properties.QueueName['Fn::If'][1]['Fn::Sub'] = 'ai-code-dojo-${EnvironmentName}-grading';
  template.Resources.QueueTlsPolicy.Properties.PolicyDocument.Statement[0].Condition.Bool['aws:SecureTransport'] = 'true';

  const errors = validateSqsCloudFormationTemplate(template);
  assert.equal(includesError(errors, 'SourceQueue must enable SQS-managed SSE'), true);
  assert.equal(includesError(errors, 'SourceQueue.QueueName must select'), true);
  assert.equal(includesError(errors, 'must deny aws:SecureTransport=false'), true);
});

test('validatorは固定account IDとaccess key IDの混入を拒否する', async () => {
  const template = await loadTemplate();
  template.Metadata = {
    AccountId: '123456789012',
    AccessKeyId: 'AKIA1234567890ABCDEF'
  };

  const errors = validateSqsCloudFormationTemplate(template);
  assert.equal(includesError(errors, 'literal AWS account ID'), true);
  assert.equal(includesError(errors, 'AWS access key ID'), true);
});
