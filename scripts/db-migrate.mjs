import { loadDatabaseProvider } from '../apps/api/src/db/adapters/database-client-factory.mjs';

const supportedArgs = new Set(['--plan', '--status']);

const resolveMode = (args) => {
  const unsupportedArgs = args.filter((arg) => !supportedArgs.has(arg));
  if (unsupportedArgs.length > 0 || args.length > 1) {
    throw new Error('Usage: pnpm db:migrate [--plan|--status]');
  }

  return args[0] === '--plan'
    ? 'plan'
    : args[0] === '--status'
      ? 'status'
      : 'apply';
};

const toSafeResult = (plan, mode) => ({
  event: `db.migration.${mode}`,
  provider: plan.provider,
  applied: plan.applied.map(({ version, name }) => ({ version, name })),
  pending: plan.pending.map(({ version, name }) => ({ version, name }))
});

const runSqlite = async (mode) => {
  const {
    planMigrations,
    runMigrations
  } = await import('../apps/api/src/db/database.mjs');

  if (mode === 'apply') {
    runMigrations();
  }
  return planMigrations();
};

const runPostgresql = async (mode) => {
  const {
    createPostgresqlPool,
    loadPostgresqlConfig
  } = await import('../apps/api/src/db/postgresql/postgresql-config.mjs');
  const {
    planPostgresqlMigrations,
    runPostgresqlMigrations
  } = await import('../apps/api/src/db/migrations/postgresql-migration-runner.mjs');

  const config = loadPostgresqlConfig();
  const pool = await createPostgresqlPool({ config });
  try {
    if (mode === 'apply') {
      return await runPostgresqlMigrations({
        pool,
        schema: config.schema
      });
    }
    return await planPostgresqlMigrations({
      pool,
      schema: config.schema
    });
  } finally {
    await pool.end();
  }
};

let provider = 'unknown';
let mode = 'unknown';

try {
  mode = resolveMode(process.argv.slice(2));
  provider = loadDatabaseProvider();
  const plan = provider === 'sqlite'
    ? await runSqlite(mode)
    : await runPostgresql(mode);

  console.log(JSON.stringify(toSafeResult(plan, mode)));
} catch (error) {
  console.error(JSON.stringify({
    event: 'db.migration.failed',
    provider,
    mode,
    errorType: typeof error?.name === 'string' && error.name
      ? error.name
      : 'Error'
  }));
  process.exitCode = 1;
}
