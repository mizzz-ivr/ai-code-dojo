import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const PYTHON_RUNNER_STAGING_CLOUDFORMATION_TEMPLATE_PATH = path.resolve(
  process.cwd(),
  'infra/aws/cloudformation/python-runner-staging-stack.json'
);

const ref = (name) => ({ Ref: name });
const getAtt = (resource, attribute) => ({ 'Fn::GetAtt': [resource, attribute] });
const sameJson = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);
const one = (values) => (Array.isArray(values) && values.length === 1 ? values[0] : null);
const getContainer = (task) => one(task?.Properties?.ContainerDefinitions);
const getEnvironment = (container) => Object.fromEntries(
  (container?.Environment ?? []).map(({ Name, Value }) => [Name, Value])
);
const getMount = (container, sourceVolume) =>
  (container?.MountPoints ?? []).find((mount) => mount.SourceVolume === sourceVolume);
const getVolume = (task, name) =>
  (task?.Properties?.Volumes ?? []).find((volume) => volume.Name === name);
const getSinglePolicyStatement = (role) => one(one(role?.Properties?.Policies)?.PolicyDocument?.Statement);
const loopbackOnly = (rules) => sameJson(rules, [{
  IpProtocol: '-1',
  CidrIp: '127.0.0.1/32',
  Description: 'Suppress default allow-all egress; intended egress is defined by standalone rules'
}]);
const httpsOnly = (rules) => sameJson(rules, [{
  IpProtocol: 'tcp',
  FromPort: 443,
  ToPort: 443,
  CidrIp: '0.0.0.0/0',
  Description: 'HTTPS egress for ECR, Secrets Manager, CloudWatch Logs and pinned sandbox image pulls'
}]);

export const validatePythonRunnerStagingCloudFormationTemplate = (template) => {
  const errors = [];
  const require = (condition, message) => { if (!condition) errors.push(message); };
  const resource = (name, type) => {
    const value = template?.Resources?.[name];
    require(value?.Type === type, `${name} must be ${type}.`);
    return value;
  };

  require(template && typeof template === 'object' && !Array.isArray(template), 'Template must be an object.');
  if (errors.length) return errors;
  require(template.AWSTemplateFormatVersion === '2010-09-09', 'AWSTemplateFormatVersion must be 2010-09-09.');
  require(Boolean(template.Description), 'Template Description is required.');
  require(template.Metadata?.DeploymentSafety?.Mode === 'review-only', 'DeploymentSafety.Mode must be review-only.');
  require(template.Metadata?.DeploymentSafety?.RequiresExplicitApproval === true, 'DeploymentSafety must require explicit approval.');
  require(template.Metadata?.DeploymentSafety?.PythonPublicGate === 'disabled', 'Python public gate must remain disabled.');
  require(
    template.Metadata?.DeploymentSafety?.RuntimeModel === 'dedicated-ecs-ec2-docker-host',
    'RuntimeModel must explicitly use dedicated ECS/EC2 Docker host capacity.'
  );

  const parameters = template.Parameters ?? {};
  require(parameters.EnvironmentName?.Default === 'staging', 'EnvironmentName default must be staging.');
  require(
    sameJson(parameters.RunnerInstanceType?.AllowedValues, ['t3.small', 't3.medium']),
    'RunnerInstanceType must be limited to t3.small and t3.medium for staging cost control.'
  );
  require(parameters.RunnerInstanceType?.Default === 't3.small', 'RunnerInstanceType default must be t3.small.');
  require(
    parameters.EcsOptimizedAmiId?.Default === '/aws/service/ecs/optimized-ami/amazon-linux-2023/recommended/image_id',
    'EcsOptimizedAmiId must use the recommended Amazon Linux 2023 ECS optimized AMI parameter.'
  );
  require(
    parameters.RunnerServiceImageUri?.AllowedPattern?.includes('@sha256:'),
    'RunnerServiceImageUri must require a sha256-pinned ECR image.'
  );
  require(parameters.CertificateArn?.Type === 'String', 'CertificateArn parameter is required.');
  require(parameters.PrivateHostedZoneId?.Type === 'AWS::Route53::HostedZone::Id', 'PrivateHostedZoneId must be a Route53 hosted zone parameter.');

  const secret = resource('RunnerSharedSecret', 'AWS::SecretsManager::Secret');
  if (secret?.Type === 'AWS::SecretsManager::Secret') {
    require(secret.DeletionPolicy === 'Retain', 'RunnerSharedSecret DeletionPolicy must be Retain.');
    require(secret.UpdateReplacePolicy === 'Retain', 'RunnerSharedSecret UpdateReplacePolicy must be Retain.');
    require(secret.Properties?.GenerateSecretString?.PasswordLength >= 32, 'RunnerSharedSecret must generate at least 32 characters.');
    require(secret.Properties?.GenerateSecretString?.ExcludePunctuation === true, 'RunnerSharedSecret must use generated alphanumeric secret material.');
    require(!('SecretString' in (secret.Properties ?? {})), 'RunnerSharedSecret must not contain a plaintext SecretString.');
  }

  const clientSg = resource('RunnerClientSecurityGroup', 'AWS::EC2::SecurityGroup');
  const albSg = resource('RunnerAlbSecurityGroup', 'AWS::EC2::SecurityGroup');
  const hostSg = resource('RunnerHostSecurityGroup', 'AWS::EC2::SecurityGroup');
  if (clientSg?.Type === 'AWS::EC2::SecurityGroup') {
    require(!Array.isArray(clientSg.Properties?.SecurityGroupIngress), 'Runner client security group must not allow inbound traffic.');
    require(loopbackOnly(clientSg.Properties?.SecurityGroupEgress), 'Runner client security group must suppress default allow-all egress.');
  }
  if (albSg?.Type === 'AWS::EC2::SecurityGroup') {
    require(!Array.isArray(albSg.Properties?.SecurityGroupIngress), 'Runner ALB must not declare inline ingress rules.');
    require(loopbackOnly(albSg.Properties?.SecurityGroupEgress), 'Runner ALB security group must suppress default allow-all egress.');
  }
  if (hostSg?.Type === 'AWS::EC2::SecurityGroup') {
    require(httpsOnly(hostSg.Properties?.SecurityGroupEgress), 'Runner host egress must be HTTPS 443 only.');
    require(!Array.isArray(hostSg.Properties?.SecurityGroupIngress), 'Runner host must not declare broad inline ingress rules.');
  }

  const albIngress = resource('RunnerAlbFromClientIngress', 'AWS::EC2::SecurityGroupIngress')?.Properties ?? {};
  require(sameJson(albIngress.GroupId, ref('RunnerAlbSecurityGroup')), 'Runner ALB ingress must apply to RunnerAlbSecurityGroup.');
  require(albIngress.IpProtocol === 'tcp' && albIngress.FromPort === 443 && albIngress.ToPort === 443, 'Runner ALB ingress must be HTTPS 443 only.');
  require(sameJson(albIngress.SourceSecurityGroupId, ref('RunnerClientSecurityGroup')), 'Runner ALB ingress must come from RunnerClientSecurityGroup only.');
  require(!('CidrIp' in albIngress) && !('CidrIpv6' in albIngress), 'Runner ALB ingress must not use CIDR sources.');

  const clientEgress = resource('RunnerClientToAlbEgress', 'AWS::EC2::SecurityGroupEgress')?.Properties ?? {};
  require(sameJson(clientEgress.GroupId, ref('RunnerClientSecurityGroup')), 'Runner client egress must modify RunnerClientSecurityGroup only.');
  require(clientEgress.IpProtocol === 'tcp' && clientEgress.FromPort === 443 && clientEgress.ToPort === 443, 'Runner client egress must use HTTPS 443 only.');
  require(sameJson(clientEgress.DestinationSecurityGroupId, ref('RunnerAlbSecurityGroup')), 'Runner client egress must target RunnerAlbSecurityGroup only.');

  const albEgress = resource('RunnerAlbToHostEgress', 'AWS::EC2::SecurityGroupEgress')?.Properties ?? {};
  require(sameJson(albEgress.GroupId, ref('RunnerAlbSecurityGroup')), 'Runner ALB egress must modify RunnerAlbSecurityGroup only.');
  require(albEgress.IpProtocol === 'tcp' && albEgress.FromPort === 8090 && albEgress.ToPort === 8090, 'Runner ALB egress must use runner port 8090 only.');
  require(sameJson(albEgress.DestinationSecurityGroupId, ref('RunnerHostSecurityGroup')), 'Runner ALB egress must target RunnerHostSecurityGroup only.');

  const hostIngress = resource('RunnerHostFromAlbIngress', 'AWS::EC2::SecurityGroupIngress')?.Properties ?? {};
  require(sameJson(hostIngress.GroupId, ref('RunnerHostSecurityGroup')), 'Runner host ingress must apply to RunnerHostSecurityGroup.');
  require(hostIngress.IpProtocol === 'tcp' && hostIngress.FromPort === 8090 && hostIngress.ToPort === 8090, 'Runner host ingress must allow port 8090 only.');
  require(sameJson(hostIngress.SourceSecurityGroupId, ref('RunnerAlbSecurityGroup')), 'Runner host ingress must originate from RunnerAlbSecurityGroup only.');

  const instanceRole = resource('RunnerInstanceRole', 'AWS::IAM::Role');
  if (instanceRole?.Type === 'AWS::IAM::Role') {
    require(!('RoleName' in (instanceRole.Properties ?? {})), 'RunnerInstanceRole must not fix RoleName.');
    require(sameJson(instanceRole.Properties?.AssumeRolePolicyDocument?.Statement, [{
      Effect: 'Allow', Principal: { Service: 'ec2.amazonaws.com' }, Action: 'sts:AssumeRole'
    }]), 'RunnerInstanceRole trust policy must allow ec2.amazonaws.com only.');
    require(sameJson(instanceRole.Properties?.ManagedPolicyArns, [
      { 'Fn::Sub': 'arn:${AWS::Partition}:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role' },
      { 'Fn::Sub': 'arn:${AWS::Partition}:iam::aws:policy/AmazonSSMManagedInstanceCore' }
    ]), 'RunnerInstanceRole managed policies must be limited to ECS container-instance and SSM core policies.');
  }

  const executionRole = resource('RunnerTaskExecutionRole', 'AWS::IAM::Role');
  if (executionRole?.Type === 'AWS::IAM::Role') {
    require(!('RoleName' in (executionRole.Properties ?? {})), 'RunnerTaskExecutionRole must not fix RoleName.');
    require(sameJson(executionRole.Properties?.AssumeRolePolicyDocument?.Statement, [{
      Effect: 'Allow', Principal: { Service: 'ecs-tasks.amazonaws.com' }, Action: 'sts:AssumeRole'
    }]), 'RunnerTaskExecutionRole trust policy must allow ecs-tasks.amazonaws.com only.');
    require(sameJson(executionRole.Properties?.ManagedPolicyArns, [
      { 'Fn::Sub': 'arn:${AWS::Partition}:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy' }
    ]), 'RunnerTaskExecutionRole must use only AmazonECSTaskExecutionRolePolicy as managed policy.');
    const statement = getSinglePolicyStatement(executionRole);
    require(Boolean(statement), 'RunnerTaskExecutionRole must contain exactly one inline secret policy statement.');
    if (statement) {
      require(statement.Effect === 'Allow', 'Runner task secret policy must be Allow.');
      require(sameJson(statement.Action, ['secretsmanager:GetSecretValue']), 'Runner task secret policy must grant only secretsmanager:GetSecretValue.');
      require(sameJson(statement.Resource, ref('RunnerSharedSecret')), 'Runner task secret policy must target RunnerSharedSecret only.');
    }
  }

  const launchTemplate = resource('RunnerLaunchTemplate', 'AWS::EC2::LaunchTemplate');
  if (launchTemplate?.Type === 'AWS::EC2::LaunchTemplate') {
    const data = launchTemplate.Properties?.LaunchTemplateData ?? {};
    require(sameJson(data.ImageId, ref('EcsOptimizedAmiId')), 'Runner host must use EcsOptimizedAmiId.');
    require(!('KeyName' in data), 'Runner host must not configure an SSH key pair.');
    require(data.MetadataOptions?.HttpTokens === 'required', 'Runner host must require IMDSv2 tokens.');
    require(data.MetadataOptions?.HttpPutResponseHopLimit === 1, 'Runner host IMDS hop limit must be 1.');
    const network = one(data.NetworkInterfaces);
    require(Boolean(network), 'Runner host must define exactly one network interface.');
    if (network) {
      require(network.AssociatePublicIpAddress === false, 'Runner host must not receive a public IP address.');
      require(sameJson(network.Groups, [ref('RunnerHostSecurityGroup')]), 'Runner host must use RunnerHostSecurityGroup only.');
    }
    const root = one(data.BlockDeviceMappings)?.Ebs;
    require(root?.Encrypted === true, 'Runner host root volume must be encrypted.');
    require(root?.VolumeType === 'gp3', 'Runner host root volume must use gp3.');
    const userData = JSON.stringify(data.UserData ?? {});
    require(userData.includes('ECS_CLUSTER=${RunnerCluster}'), 'Runner host user data must join RunnerCluster.');
    require(userData.includes('/var/lib/ai-code-dojo/python-runner-workspaces'), 'Runner host user data must create the shared workspace path.');
  }

  const asg = resource('RunnerAutoScalingGroup', 'AWS::AutoScaling::AutoScalingGroup');
  if (asg?.Type === 'AWS::AutoScaling::AutoScalingGroup') {
    const props = asg.Properties ?? {};
    require(props.MinSize === '1' && props.MaxSize === '1' && props.DesiredCapacity === '1', 'Runner Auto Scaling group must be fixed at exactly one instance for staging cost control.');
    require(sameJson(props.VPCZoneIdentifier, ref('PrivateSubnetIds')), 'Runner Auto Scaling group must use PrivateSubnetIds.');
  }

  const task = resource('RunnerTaskDefinition', 'AWS::ECS::TaskDefinition');
  if (task?.Type === 'AWS::ECS::TaskDefinition') {
    const props = task.Properties ?? {};
    require(sameJson(props.RequiresCompatibilities, ['EC2']), 'Runner task must require EC2 only; Fargate is not compatible with the host Docker bind mounts.');
    require(props.NetworkMode === 'bridge', 'Runner task network mode must be bridge.');
    require(!('TaskRoleArn' in props), 'Runner task must not receive an application AWS task role.');
    require(sameJson(props.ExecutionRoleArn, getAtt('RunnerTaskExecutionRole', 'Arn')), 'Runner task must use RunnerTaskExecutionRole as execution role.');
    require(getVolume(task, 'docker-socket')?.Host?.SourcePath === '/var/run/docker.sock', 'Runner task must bind the dedicated host Docker socket.');
    require(getVolume(task, 'runner-workspaces')?.Host?.SourcePath === '/var/lib/ai-code-dojo/python-runner-workspaces', 'Runner task must bind the dedicated shared workspace host path.');

    const container = getContainer(task);
    require(Boolean(container), 'Runner task must contain exactly one container definition.');
    if (container) {
      require(container.Name === 'python-runner', 'Runner container name must be python-runner.');
      require(sameJson(container.Image, ref('RunnerServiceImageUri')), 'Runner container image must come from RunnerServiceImageUri.');
      require(container.ReadonlyRootFilesystem === true, 'Runner container root filesystem must be read-only.');
      require(container.Privileged === false, 'Runner container must not use ECS privileged mode.');
      require(container.User === '0', 'Runner control-plane container user must be explicit because Docker socket access is a reviewed dedicated-host exception.');
      require(sameJson(container.DockerSecurityOptions, ['no-new-privileges']), 'Runner container must enable no-new-privileges.');
      require(sameJson(container.LinuxParameters?.Capabilities?.Drop, ['ALL']), 'Runner container must drop all Linux capabilities.');
      require(container.LinuxParameters?.InitProcessEnabled === true, 'Runner container must enable init process handling.');
      require(sameJson(container.Command, ['node', 'apps/python-runner/src/server.mjs']), 'Runner container command must be fixed to the Python Remote Runner server.');
      require(sameJson(container.PortMappings, [{ ContainerPort: 8090, HostPort: 8090, Protocol: 'tcp' }]), 'Runner container must expose fixed host/container port 8090 only.');
      require(getMount(container, 'docker-socket')?.ContainerPath === '/var/run/docker.sock', 'Runner container must mount the Docker socket at /var/run/docker.sock only.');
      require(getMount(container, 'runner-workspaces')?.ContainerPath === '/var/lib/ai-code-dojo/python-runner-workspaces', 'Runner container must mount the shared workspace at the identical host path.');
      const environment = getEnvironment(container);
      require(environment.NODE_ENV === 'production', 'Runner container NODE_ENV must be production.');
      require(environment.TMPDIR === '/var/lib/ai-code-dojo/python-runner-workspaces', 'Runner container TMPDIR must use the host-shared workspace path.');
      require(environment.PYTHON_RUNNER_PROBLEMS_ROOT === '/app/problems/examples', 'Runner image must expose problems/examples at /app/problems/examples.');
      require(environment.PYTHON_RUNNER_MAX_CONCURRENCY === '1', 'Staging runner max concurrency must be 1.');
      require(environment.PYTHON_RUNNER_MAX_QUEUED_JOBS === '2', 'Staging runner queue limit must be 2.');
      require(environment.PYTHON_RUNNER_PORT === '8090', 'Runner service port must be 8090.');
      require(sameJson(container.Secrets, [{ Name: 'PYTHON_RUNNER_SHARED_SECRET', ValueFrom: ref('RunnerSharedSecret') }]), 'Runner shared secret must be injected from RunnerSharedSecret only.');
    }
  }

  const alb = resource('RunnerLoadBalancer', 'AWS::ElasticLoadBalancingV2::LoadBalancer');
  if (alb?.Type === 'AWS::ElasticLoadBalancingV2::LoadBalancer') {
    require(alb.Properties?.Type === 'application', 'Runner load balancer type must be application.');
    require(alb.Properties?.Scheme === 'internal', 'Runner load balancer must be internal.');
    require(sameJson(alb.Properties?.Subnets, ref('PrivateSubnetIds')), 'Runner load balancer must use PrivateSubnetIds.');
    require(sameJson(alb.Properties?.SecurityGroups, [ref('RunnerAlbSecurityGroup')]), 'Runner load balancer must use RunnerAlbSecurityGroup only.');
    const dropInvalid = (alb.Properties?.LoadBalancerAttributes ?? []).find((item) => item.Key === 'routing.http.drop_invalid_header_fields.enabled');
    require(dropInvalid?.Value === 'true', 'Runner ALB must drop invalid HTTP header fields.');
  }

  const listener = resource('RunnerHttpsListener', 'AWS::ElasticLoadBalancingV2::Listener');
  if (listener?.Type === 'AWS::ElasticLoadBalancingV2::Listener') {
    const props = listener.Properties ?? {};
    require(props.Protocol === 'HTTPS' && props.Port === 443, 'Runner listener must be HTTPS 443 only.');
    require(props.SslPolicy === 'ELBSecurityPolicy-TLS13-1-2-2021-06', 'Runner listener must use the TLS 1.3/1.2 policy.');
    require(sameJson(props.Certificates, [{ CertificateArn: ref('CertificateArn') }]), 'Runner listener must use CertificateArn.');
  }

  const target = resource('RunnerTargetGroup', 'AWS::ElasticLoadBalancingV2::TargetGroup');
  if (target?.Type === 'AWS::ElasticLoadBalancingV2::TargetGroup') {
    const props = target.Properties ?? {};
    require(props.TargetType === 'instance', 'Runner target group must use instance targets for EC2 bridge mode.');
    require(props.Protocol === 'HTTP' && props.Port === 8090, 'Runner target group must forward HTTP to port 8090 inside the private VPC.');
    require(props.HealthCheckPath === '/health' && props.Matcher?.HttpCode === '200', 'Runner target group must health-check /health for HTTP 200.');
  }

  const dns = resource('RunnerDnsRecord', 'AWS::Route53::RecordSet');
  if (dns?.Type === 'AWS::Route53::RecordSet') {
    require(sameJson(dns.Properties?.HostedZoneId, ref('PrivateHostedZoneId')), 'Runner DNS record must use PrivateHostedZoneId.');
    require(sameJson(dns.Properties?.Name, ref('RunnerDnsName')), 'Runner DNS record must use RunnerDnsName.');
    require(dns.Properties?.Type === 'A', 'Runner DNS record must be an A alias record.');
  }

  const service = resource('RunnerService', 'AWS::ECS::Service');
  if (service?.Type === 'AWS::ECS::Service') {
    const props = service.Properties ?? {};
    require(props.LaunchType === 'EC2', 'RunnerService launch type must be EC2, not Fargate.');
    require(props.DesiredCount === 1, 'RunnerService desired count must be 1 for staging cost control.');
    require(props.DeploymentConfiguration?.MaximumPercent === 100, 'RunnerService MaximumPercent must be 100 to avoid a second task on the single host.');
    require(props.DeploymentConfiguration?.MinimumHealthyPercent === 0, 'RunnerService MinimumHealthyPercent must be 0 for single-host rolling updates.');
    require(props.DeploymentConfiguration?.DeploymentCircuitBreaker?.Enable === true, 'RunnerService deployment circuit breaker must be enabled.');
    require(props.DeploymentConfiguration?.DeploymentCircuitBreaker?.Rollback === true, 'RunnerService deployment circuit breaker must roll back failed deployments.');
    require(!('NetworkConfiguration' in props), 'RunnerService must not use awsvpc/Fargate networking in this host-bind design.');
    require(sameJson(service.DependsOn, ['RunnerHttpsListener', 'RunnerHostFromAlbIngress', 'RunnerAlbToHostEgress']), 'RunnerService must depend on listener and private ALB-to-host network rules.');
  }

  for (const output of ['RunnerUrl', 'RunnerSharedSecretArn', 'RunnerClusterName', 'RunnerServiceName', 'RunnerAutoScalingGroupName', 'RunnerClientSecurityGroupId', 'RunnerAlbSecurityGroupId', 'RunnerHostSecurityGroupId']) {
    require(template.Outputs?.[output]?.Value !== undefined, `Output ${output} is required.`);
  }
  require(sameJson(template.Outputs?.RunnerUrl?.Value, { 'Fn::Sub': 'https://${RunnerDnsName}' }), 'RunnerUrl output must use HTTPS and RunnerDnsName.');
  require(sameJson(template.Outputs?.RunnerSharedSecretArn?.Value, ref('RunnerSharedSecret')), 'RunnerSharedSecretArn must output only the secret ARN/reference.');

  const serialized = JSON.stringify(template);
  require(!/AKIA[0-9A-Z]{16}/.test(serialized), 'Template must not contain an AWS access key ID.');
  require(!/\b\d{12}\b/.test(serialized.replaceAll('[0-9]{12}', '')), 'Template must not contain a literal AWS account ID.');
  require(!serialized.includes('"LaunchType":"FARGATE"'), 'Template must not use Fargate for the Docker-host runner.');
  require(!serialized.includes('"Privileged":true'), 'Template must not enable ECS privileged mode.');
  require(!serialized.includes('"FromPort":22') && !serialized.includes('"ToPort":22'), 'Template must not open SSH port 22.');
  for (const [name, item] of Object.entries(template.Resources ?? {})) {
    const rules = item?.Properties?.SecurityGroupIngress ?? (item?.Type === 'AWS::EC2::SecurityGroupIngress' ? [item.Properties] : []);
    for (const rule of rules) {
      require(rule.CidrIp !== '0.0.0.0/0' && rule.CidrIpv6 !== '::/0', `${name} must not expose ingress to the public internet.`);
    }
  }
  return errors;
};

export const loadPythonRunnerStagingCloudFormationTemplate = async (
  templatePath = PYTHON_RUNNER_STAGING_CLOUDFORMATION_TEMPLATE_PATH
) => JSON.parse(await readFile(templatePath, 'utf8'));

export const assertValidPythonRunnerStagingCloudFormationTemplate = (template) => {
  const errors = validatePythonRunnerStagingCloudFormationTemplate(template);
  if (errors.length) {
    throw new Error(`Python Runner staging CloudFormation validation failed:\n${errors.map((error) => `- ${error}`).join('\n')}`);
  }
  return true;
};
