import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const SQS_CLOUDFORMATION_TEMPLATE_PATH = path.resolve(
  process.cwd(),
  'infra/aws/cloudformation/sqs-queue-stack.json'
);

const getAtt = (resource, attribute = 'Arn') => ({
  'Fn::GetAtt': [resource, attribute]
});

const ref = (name) => ({ Ref: name });

const sameJson = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);

const sorted = (values) => [...values].sort();

const validateQueueNameCondition = ({ value, fifoName, standardName, field, errors }) => {
  const expected = {
    'Fn::If': [
      'IsFifo',
      { 'Fn::Sub': fifoName },
      { 'Fn::Sub': standardName }
    ]
  };
  if (!sameJson(value, expected)) {
    errors.push(`${field} must select the expected standard/fifo queue names.`);
  }
};

const validateFifoCondition = ({ value, field, errors }) => {
  if (!sameJson(value, { 'Fn::If': ['IsFifo', true, false] })) {
    errors.push(`${field} must use IsFifo to select true or false.`);
  }
};

const getInlineAllowStatement = (role) => {
  const policies = role?.Properties?.Policies;
  if (!Array.isArray(policies) || policies.length !== 1) return null;
  const statements = policies[0]?.PolicyDocument?.Statement;
  if (!Array.isArray(statements) || statements.length !== 1) return null;
  return statements[0];
};

const validateRole = ({ role, roleName, expectedActions, errors }) => {
  if (role?.Type !== 'AWS::IAM::Role') {
    errors.push(`${roleName} must be AWS::IAM::Role.`);
    return;
  }
  if ('RoleName' in (role.Properties ?? {})) {
    errors.push(`${roleName} must not fix RoleName.`);
  }
  if ('ManagedPolicyArns' in (role.Properties ?? {})) {
    errors.push(`${roleName} must not attach managed policies.`);
  }

  const trust = role.Properties?.AssumeRolePolicyDocument?.Statement;
  const expectedTrust = [{
    Effect: 'Allow',
    Principal: { Service: ref('WorkloadServicePrincipal') },
    Action: 'sts:AssumeRole'
  }];
  if (!sameJson(trust, expectedTrust)) {
    errors.push(`${roleName} trust policy must use WorkloadServicePrincipal only.`);
  }

  const statement = getInlineAllowStatement(role);
  if (!statement) {
    errors.push(`${roleName} must contain exactly one inline policy statement.`);
    return;
  }
  if (statement.Effect !== 'Allow') {
    errors.push(`${roleName} queue statement must be Allow.`);
  }
  const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action].filter(Boolean);
  if (!sameJson(sorted(actions), sorted(expectedActions))) {
    errors.push(`${roleName} actions must be exactly: ${expectedActions.join(', ')}.`);
  }
  if (!sameJson(statement.Resource, getAtt('SourceQueue'))) {
    errors.push(`${roleName} resource must be SourceQueue ARN only.`);
  }
};

export const validateSqsCloudFormationTemplate = (template) => {
  const errors = [];
  const requireCondition = (condition, message) => {
    if (!condition) errors.push(message);
  };

  requireCondition(template && typeof template === 'object' && !Array.isArray(template), 'Template must be an object.');
  if (errors.length > 0) return errors;

  requireCondition(template.AWSTemplateFormatVersion === '2010-09-09', 'AWSTemplateFormatVersion must be 2010-09-09.');
  requireCondition(typeof template.Description === 'string' && template.Description.length > 0, 'Template Description is required.');

  const parameters = template.Parameters ?? {};
  requireCondition(
    sameJson(parameters.QueueType?.AllowedValues, ['standard', 'fifo']),
    'QueueType must allow standard and fifo.'
  );
  requireCondition(parameters.QueueType?.Default === 'standard', 'QueueType default must be standard.');
  requireCondition(parameters.MaxReceiveCount?.Default === 5, 'MaxReceiveCount default must be 5.');
  requireCondition(parameters.MaxReceiveCount?.MinValue === 1, 'MaxReceiveCount minimum must be 1.');
  requireCondition(parameters.WorkloadServicePrincipal?.Default === 'ecs-tasks.amazonaws.com', 'WorkloadServicePrincipal default must be ecs-tasks.amazonaws.com.');

  requireCondition(
    sameJson(template.Conditions?.IsFifo, { 'Fn::Equals': [ref('QueueType'), 'fifo'] }),
    'IsFifo condition must compare QueueType with fifo.'
  );

  const resources = template.Resources ?? {};
  const sourceQueue = resources.SourceQueue;
  const deadLetterQueue = resources.DeadLetterQueue;
  const queuePolicy = resources.QueueTlsPolicy;

  requireCondition(sourceQueue?.Type === 'AWS::SQS::Queue', 'SourceQueue must be AWS::SQS::Queue.');
  requireCondition(deadLetterQueue?.Type === 'AWS::SQS::Queue', 'DeadLetterQueue must be AWS::SQS::Queue.');

  if (sourceQueue?.Type === 'AWS::SQS::Queue') {
    requireCondition(sourceQueue.DeletionPolicy === 'Retain', 'SourceQueue DeletionPolicy must be Retain.');
    requireCondition(sourceQueue.UpdateReplacePolicy === 'Retain', 'SourceQueue UpdateReplacePolicy must be Retain.');
    const properties = sourceQueue.Properties ?? {};
    validateQueueNameCondition({
      value: properties.QueueName,
      fifoName: 'ai-code-dojo-${EnvironmentName}-grading.fifo',
      standardName: 'ai-code-dojo-${EnvironmentName}-grading',
      field: 'SourceQueue.QueueName',
      errors
    });
    validateFifoCondition({ value: properties.FifoQueue, field: 'SourceQueue.FifoQueue', errors });
    requireCondition(properties.SqsManagedSseEnabled === true, 'SourceQueue must enable SQS-managed SSE.');
    requireCondition(properties.MessageRetentionPeriod === 345600, 'SourceQueue retention must be 4 days.');
    requireCondition(properties.ReceiveMessageWaitTimeSeconds === 20, 'SourceQueue long polling must be 20 seconds.');
    requireCondition(properties.VisibilityTimeout === 90, 'SourceQueue visibility timeout must be 90 seconds.');
    requireCondition(
      sameJson(properties.RedrivePolicy?.deadLetterTargetArn, getAtt('DeadLetterQueue')),
      'SourceQueue RedrivePolicy must target DeadLetterQueue ARN.'
    );
    requireCondition(
      sameJson(properties.RedrivePolicy?.maxReceiveCount, ref('MaxReceiveCount')),
      'SourceQueue RedrivePolicy must use MaxReceiveCount.'
    );
  }

  if (deadLetterQueue?.Type === 'AWS::SQS::Queue') {
    requireCondition(deadLetterQueue.DeletionPolicy === 'Retain', 'DeadLetterQueue DeletionPolicy must be Retain.');
    requireCondition(deadLetterQueue.UpdateReplacePolicy === 'Retain', 'DeadLetterQueue UpdateReplacePolicy must be Retain.');
    const properties = deadLetterQueue.Properties ?? {};
    validateQueueNameCondition({
      value: properties.QueueName,
      fifoName: 'ai-code-dojo-${EnvironmentName}-grading-dlq.fifo',
      standardName: 'ai-code-dojo-${EnvironmentName}-grading-dlq',
      field: 'DeadLetterQueue.QueueName',
      errors
    });
    validateFifoCondition({ value: properties.FifoQueue, field: 'DeadLetterQueue.FifoQueue', errors });
    requireCondition(properties.SqsManagedSseEnabled === true, 'DeadLetterQueue must enable SQS-managed SSE.');
    requireCondition(properties.MessageRetentionPeriod === 1209600, 'DeadLetterQueue retention must be 14 days.');
    requireCondition(properties.RedriveAllowPolicy?.redrivePermission === 'byQueue', 'DeadLetterQueue RedriveAllowPolicy must use byQueue.');
    const sourceArns = properties.RedriveAllowPolicy?.sourceQueueArns;
    requireCondition(Array.isArray(sourceArns) && sourceArns.length === 1, 'DeadLetterQueue must allow exactly one source queue ARN.');
    if (Array.isArray(sourceArns) && sourceArns.length === 1) {
      const sourceArnSub = sourceArns[0]?.['Fn::Sub'];
      requireCondition(
        Array.isArray(sourceArnSub)
          && sourceArnSub[0] === 'arn:${AWS::Partition}:sqs:${AWS::Region}:${AWS::AccountId}:${SourceQueueName}'
          && sourceArnSub[1]?.SourceQueueName?.['Fn::If']?.[0] === 'IsFifo',
        'DeadLetterQueue sourceQueueArns must derive the deterministic source queue ARN without GetAtt.'
      );
      requireCondition(
        !JSON.stringify(sourceArns[0]).includes('Fn::GetAtt'),
        'DeadLetterQueue RedriveAllowPolicy must avoid a SourceQueue GetAtt circular dependency.'
      );
    }
  }

  requireCondition(queuePolicy?.Type === 'AWS::SQS::QueuePolicy', 'QueueTlsPolicy must be AWS::SQS::QueuePolicy.');
  if (queuePolicy?.Type === 'AWS::SQS::QueuePolicy') {
    requireCondition(
      sameJson(queuePolicy.Properties?.Queues, [ref('SourceQueue'), ref('DeadLetterQueue')]),
      'QueueTlsPolicy must apply to source and DLQ.'
    );
    const statements = queuePolicy.Properties?.PolicyDocument?.Statement;
    requireCondition(Array.isArray(statements) && statements.length === 1, 'QueueTlsPolicy must contain one deny statement.');
    const statement = Array.isArray(statements) ? statements[0] : null;
    if (statement) {
      requireCondition(statement.Effect === 'Deny', 'QueueTlsPolicy must deny insecure transport.');
      requireCondition(statement.Principal === '*', 'QueueTlsPolicy TLS deny must apply to every principal.');
      requireCondition(statement.Action === 'sqs:*', 'QueueTlsPolicy TLS deny must cover all SQS actions.');
      requireCondition(
        sameJson(statement.Resource, [getAtt('SourceQueue'), getAtt('DeadLetterQueue')]),
        'QueueTlsPolicy must cover source and DLQ ARNs.'
      );
      requireCondition(
        statement.Condition?.Bool?.['aws:SecureTransport'] === 'false',
        'QueueTlsPolicy must deny aws:SecureTransport=false.'
      );
    }
  }

  validateRole({
    role: resources.ProducerRole,
    roleName: 'ProducerRole',
    expectedActions: ['sqs:SendMessage'],
    errors
  });
  validateRole({
    role: resources.ConsumerRole,
    roleName: 'ConsumerRole',
    expectedActions: [
      'sqs:ReceiveMessage',
      'sqs:DeleteMessage',
      'sqs:ChangeMessageVisibility',
      'sqs:SendMessage'
    ],
    errors
  });

  const requiredOutputs = [
    'SourceQueueUrl',
    'SourceQueueArn',
    'DeadLetterQueueUrl',
    'DeadLetterQueueArn',
    'ProducerRoleArn',
    'ConsumerRoleArn',
    'ApiRuntimeConfiguration',
    'WorkerRuntimeConfiguration'
  ];
  for (const output of requiredOutputs) {
    requireCondition(template.Outputs?.[output]?.Value !== undefined, `Output ${output} is required.`);
  }

  const serialized = JSON.stringify(template);
  requireCondition(!/AKIA[0-9A-Z]{16}/.test(serialized), 'Template must not contain an AWS access key ID.');
  requireCondition(!/\b\d{12}\b/.test(serialized), 'Template must not contain a literal AWS account ID.');
  requireCondition(!serialized.includes('sqs:PurgeQueue'), 'Template must not grant sqs:PurgeQueue.');
  requireCondition(!serialized.includes('sqs:DeleteQueue'), 'Template must not grant sqs:DeleteQueue.');
  requireCondition(!serialized.includes('sqs:SetQueueAttributes'), 'Template must not grant sqs:SetQueueAttributes.');

  return errors;
};

export const loadSqsCloudFormationTemplate = async (templatePath = SQS_CLOUDFORMATION_TEMPLATE_PATH) => {
  const source = await readFile(templatePath, 'utf8');
  return JSON.parse(source);
};

export const assertValidSqsCloudFormationTemplate = (template) => {
  const errors = validateSqsCloudFormationTemplate(template);
  if (errors.length > 0) {
    throw new Error(`SQS CloudFormation validation failed:\n${errors.map((error) => `- ${error}`).join('\n')}`);
  }
  return true;
};
