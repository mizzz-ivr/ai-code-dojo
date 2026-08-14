import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadPythonRunnerStagingCloudFormationTemplate,
  validatePythonRunnerStagingCloudFormationTemplate
} from '../../scripts/lib/python-runner-staging-cloudformation-validator.mjs';

const loadTemplate = async () => structuredClone(await loadPythonRunnerStagingCloudFormationTemplate());
const includesError = (errors, fragment) => errors.some((error) => error.includes(fragment));
const getContainer = (template) => template.Resources.RunnerTaskDefinition.Properties.ContainerDefinitions[0];

test('Python Runner staging CloudFormation templateはreview-only隔離契約を満たす', async () => {
  const template = await loadTemplate();
  assert.deepEqual(validatePythonRunnerStagingCloudFormationTemplate(template), []);
});

test('validatorはFargate・awsvpc・host bind欠落を拒否する', async () => {
  const template = await loadTemplate();
  template.Resources.RunnerTaskDefinition.Properties.RequiresCompatibilities = ['FARGATE'];
  template.Resources.RunnerTaskDefinition.Properties.NetworkMode = 'awsvpc';
  template.Resources.RunnerService.Properties.LaunchType = 'FARGATE';
  template.Resources.RunnerService.Properties.NetworkConfiguration = { AwsvpcConfiguration: {} };
  template.Resources.RunnerTaskDefinition.Properties.Volumes = [];

  const errors = validatePythonRunnerStagingCloudFormationTemplate(template);
  assert.equal(includesError(errors, 'must require EC2 only'), true);
  assert.equal(includesError(errors, 'network mode must be bridge'), true);
  assert.equal(includesError(errors, 'launch type must be EC2'), true);
  assert.equal(includesError(errors, 'must not use awsvpc'), true);
  assert.equal(includesError(errors, 'bind the dedicated host Docker socket'), true);
  assert.equal(includesError(errors, 'bind the dedicated shared workspace host path'), true);
});

test('validatorはpublic ingress・public IP・SSHを拒否する', async () => {
  const template = await loadTemplate();
  const albIngress = template.Resources.RunnerAlbFromClientIngress.Properties;
  delete albIngress.SourceSecurityGroupId;
  albIngress.CidrIp = '0.0.0.0/0';
  template.Resources.RunnerLaunchTemplate.Properties.LaunchTemplateData.NetworkInterfaces[0].AssociatePublicIpAddress = true;
  template.Resources.RunnerLaunchTemplate.Properties.LaunchTemplateData.KeyName = 'staging-debug-key';
  template.Resources.RunnerHostSecurityGroup.Properties.SecurityGroupIngress = [{
    IpProtocol: 'tcp', FromPort: 22, ToPort: 22, CidrIp: '0.0.0.0/0'
  }];

  const errors = validatePythonRunnerStagingCloudFormationTemplate(template);
  assert.equal(includesError(errors, 'must come from RunnerClientSecurityGroup only'), true);
  assert.equal(includesError(errors, 'must not use CIDR sources'), true);
  assert.equal(includesError(errors, 'must not receive a public IP address'), true);
  assert.equal(includesError(errors, 'must not configure an SSH key pair'), true);
  assert.equal(includesError(errors, 'must not open SSH port 22'), true);
  assert.equal(includesError(errors, 'must not expose ingress to the public internet'), true);
});

test('validatorはstaging capacity・queue上限の拡大を拒否する', async () => {
  const template = await loadTemplate();
  template.Resources.RunnerAutoScalingGroup.Properties.MaxSize = '2';
  template.Resources.RunnerAutoScalingGroup.Properties.DesiredCapacity = '2';
  template.Resources.RunnerService.Properties.DesiredCount = 2;
  const container = getContainer(template);
  container.Environment.find((item) => item.Name === 'PYTHON_RUNNER_MAX_CONCURRENCY').Value = '2';
  container.Environment.find((item) => item.Name === 'PYTHON_RUNNER_MAX_QUEUED_JOBS').Value = '20';

  const errors = validatePythonRunnerStagingCloudFormationTemplate(template);
  assert.equal(includesError(errors, 'fixed at exactly one instance'), true);
  assert.equal(includesError(errors, 'desired count must be 1'), true);
  assert.equal(includesError(errors, 'max concurrency must be 1'), true);
  assert.equal(includesError(errors, 'queue limit must be 2'), true);
});

test('validatorはplaintext secret・secret権限wildcardを拒否する', async () => {
  const template = await loadTemplate();
  template.Resources.RunnerSharedSecret.Properties.SecretString = 'do-not-store-this';
  const statement = template.Resources.RunnerTaskExecutionRole.Properties.Policies[0].PolicyDocument.Statement[0];
  statement.Action = ['secretsmanager:*'];
  statement.Resource = '*';

  const errors = validatePythonRunnerStagingCloudFormationTemplate(template);
  assert.equal(includesError(errors, 'must not contain a plaintext SecretString'), true);
  assert.equal(includesError(errors, 'must grant only secretsmanager:GetSecretValue'), true);
  assert.equal(includesError(errors, 'must target RunnerSharedSecret only'), true);
});

test('validatorはDocker socket・同一workspace path・TMPDIR契約の破壊を拒否する', async () => {
  const template = await loadTemplate();
  const volumes = template.Resources.RunnerTaskDefinition.Properties.Volumes;
  volumes.find((volume) => volume.Name === 'docker-socket').Host.SourcePath = '/tmp/docker.sock';
  volumes.find((volume) => volume.Name === 'runner-workspaces').Host.SourcePath = '/tmp/runner-workspaces';
  const container = getContainer(template);
  container.MountPoints.find((mount) => mount.SourceVolume === 'runner-workspaces').ContainerPath = '/workspace-host';
  container.Environment.find((item) => item.Name === 'TMPDIR').Value = '/tmp';

  const errors = validatePythonRunnerStagingCloudFormationTemplate(template);
  assert.equal(includesError(errors, 'bind the dedicated host Docker socket'), true);
  assert.equal(includesError(errors, 'bind the dedicated shared workspace host path'), true);
  assert.equal(includesError(errors, 'mount the shared workspace at the identical host path'), true);
  assert.equal(includesError(errors, 'TMPDIR must use the host-shared workspace path'), true);
});

test('validatorはinternet-facing ALB・HTTP listener・TLS downgradeを拒否する', async () => {
  const template = await loadTemplate();
  template.Resources.RunnerLoadBalancer.Properties.Scheme = 'internet-facing';
  const listener = template.Resources.RunnerHttpsListener.Properties;
  listener.Protocol = 'HTTP';
  listener.Port = 80;
  listener.SslPolicy = 'ELBSecurityPolicy-2016-08';

  const errors = validatePythonRunnerStagingCloudFormationTemplate(template);
  assert.equal(includesError(errors, 'load balancer must be internal'), true);
  assert.equal(includesError(errors, 'listener must be HTTPS 443 only'), true);
  assert.equal(includesError(errors, 'TLS 1.3/1.2 policy'), true);
});

test('validatorはdigest未固定Runner service imageを拒否する', async () => {
  const template = await loadTemplate();
  template.Parameters.RunnerServiceImageUri.AllowedPattern = '.*';

  const errors = validatePythonRunnerStagingCloudFormationTemplate(template);
  assert.equal(includesError(errors, 'must require a sha256-pinned ECR image'), true);
});

test('validatorはprivileged mode・writable root・capability復活を拒否する', async () => {
  const template = await loadTemplate();
  const container = getContainer(template);
  container.Privileged = true;
  container.ReadonlyRootFilesystem = false;
  container.LinuxParameters.Capabilities.Drop = [];
  container.DockerSecurityOptions = [];

  const errors = validatePythonRunnerStagingCloudFormationTemplate(template);
  assert.equal(includesError(errors, 'must not use ECS privileged mode'), true);
  assert.equal(includesError(errors, 'root filesystem must be read-only'), true);
  assert.equal(includesError(errors, 'drop all Linux capabilities'), true);
  assert.equal(includesError(errors, 'enable no-new-privileges'), true);
});

test('validatorはEC2 / ECS task execution roleのtrust拡大を拒否する', async () => {
  const template = await loadTemplate();
  template.Resources.RunnerInstanceRole.Properties.AssumeRolePolicyDocument.Statement[0].Principal.Service = '*';
  template.Resources.RunnerTaskExecutionRole.Properties.AssumeRolePolicyDocument.Statement[0].Principal.Service = '*';

  const errors = validatePythonRunnerStagingCloudFormationTemplate(template);
  assert.equal(includesError(errors, 'RunnerInstanceRole trust policy must allow ec2.amazonaws.com only'), true);
  assert.equal(includesError(errors, 'RunnerTaskExecutionRole trust policy must allow ecs-tasks.amazonaws.com only'), true);
});
