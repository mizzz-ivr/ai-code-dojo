import {
  planMigrations,
  runMigrations
} from '../apps/api/src/db/database.mjs';

const args = process.argv.slice(2);
const supportedArgs = new Set(['--plan', '--status']);
const unsupportedArgs = args.filter((arg) => !supportedArgs.has(arg));

if (unsupportedArgs.length > 0 || args.length > 1) {
  throw new Error('Usage: pnpm db:migrate [--plan|--status]');
}

const mode = args[0] === '--plan'
  ? 'plan'
  : args[0] === '--status'
    ? 'status'
    : 'apply';

if (mode === 'apply') {
  runMigrations();
}

const plan = planMigrations();
const result = {
  event: `db.migration.${mode}`,
  provider: plan.provider,
  applied: plan.applied.map(({ version, name }) => ({ version, name })),
  pending: plan.pending.map(({ version, name }) => ({ version, name }))
};

console.log(JSON.stringify(result));
