import {
  assertValidSqsCloudFormationTemplate,
  loadSqsCloudFormationTemplate,
  SQS_CLOUDFORMATION_TEMPLATE_PATH
} from './lib/sqs-cloudformation-validator.mjs';

try {
  const template = await loadSqsCloudFormationTemplate();
  assertValidSqsCloudFormationTemplate(template);
  console.log(`infra validation passed: ${SQS_CLOUDFORMATION_TEMPLATE_PATH}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
