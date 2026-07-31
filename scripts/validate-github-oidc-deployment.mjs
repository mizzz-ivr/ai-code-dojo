import {
  assertValidGitHubOidcDeployment,
  GITHUB_OIDC_DEPLOYMENT_TEMPLATE_PATH,
  loadGitHubOidcDeploymentTemplate,
  loadStagingChangeSetWorkflow,
  STAGING_CHANGE_SET_WORKFLOW_PATH
} from './lib/github-oidc-deployment-validator.mjs';

try {
  const [template, workflowSource] = await Promise.all([
    loadGitHubOidcDeploymentTemplate(),
    loadStagingChangeSetWorkflow()
  ]);
  assertValidGitHubOidcDeployment(template, workflowSource);
  console.log(
    `infra validation passed: ${GITHUB_OIDC_DEPLOYMENT_TEMPLATE_PATH}, ${STAGING_CHANGE_SET_WORKFLOW_PATH}`
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
