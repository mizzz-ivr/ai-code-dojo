import { readFile } from 'node:fs/promises';
import {
  assertValidPythonRunnerStagingChangeSetParameters,
  createPythonRunnerStagingChangeSetParameters
} from './lib/python-runner-staging-change-set-validator.mjs';

const [manifestPath] = process.argv.slice(2);

if (!manifestPath || process.argv.length !== 3) {
  console.error('usage: node scripts/create-python-runner-staging-change-set-parameters.mjs <manifest.json>');
  process.exit(1);
}

const requiredEnv = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
};

try {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const config = {
    accountId: requiredEnv('AWS_STAGING_ACCOUNT_ID'),
    region: requiredEnv('AWS_STAGING_REGION'),
    vpcId: requiredEnv('AWS_STAGING_VPC_ID'),
    privateSubnetIds: requiredEnv('AWS_STAGING_PRIVATE_SUBNET_IDS'),
    privateHostedZoneId: requiredEnv('AWS_STAGING_PRIVATE_HOSTED_ZONE_ID'),
    runnerDnsName: requiredEnv('AWS_STAGING_PYTHON_RUNNER_DNS_NAME'),
    certificateArn: requiredEnv('AWS_STAGING_PYTHON_RUNNER_CERTIFICATE_ARN'),
    runnerInstanceType: requiredEnv('AWS_STAGING_PYTHON_RUNNER_INSTANCE_TYPE')
  };
  const parameters = createPythonRunnerStagingChangeSetParameters(config, manifest);
  assertValidPythonRunnerStagingChangeSetParameters(parameters);
  process.stdout.write(`${JSON.stringify(parameters, null, 2)}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
