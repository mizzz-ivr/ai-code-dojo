import { readFile } from 'node:fs/promises';
import { assertValidPythonRunnerImageReleaseManifest } from './lib/python-runner-image-release-validator.mjs';
import { assertValidPythonRunnerReleaseArtifactChecksum } from './lib/python-runner-staging-change-set-validator.mjs';

const [manifestPath, checksumPath] = process.argv.slice(2);

if (!manifestPath || !checksumPath || process.argv.length !== 4) {
  console.error('usage: node scripts/validate-python-runner-release-artifact.mjs <manifest.json> <manifest.json.sha256>');
  process.exit(1);
}

try {
  const [manifestSource, checksumSource] = await Promise.all([
    readFile(manifestPath, 'utf8'),
    readFile(checksumPath, 'utf8')
  ]);
  assertValidPythonRunnerReleaseArtifactChecksum(manifestSource, checksumSource);
  const manifest = JSON.parse(manifestSource);
  assertValidPythonRunnerImageReleaseManifest(manifest);
  console.log('Python Runner release artifact validation passed.');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
