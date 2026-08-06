import { loadDatabaseProvider } from '../apps/api/src/db/adapters/database-client-factory.mjs';

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

const toSafeResult = (plan) => ({
  event: `db.migration.${mode}`,
  provider: plan.provider,
  applied: plan.applied.map(({ version, name }) => ({ version, name })),
  pending: plan.pending.map(({ version, name }) => ({ version, name }))
});

const runSqlite = async () => {
  const {
    planMigrations,
    runMigrations
  } = await import('../apps/api/src/db/database.mjs');

  if (mode === 'apply') {
    runMigrations();
  }
  return planMigrations();
};

const runPostgresql = async () => {
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

const provider = loadDatabaseProvider();
const plan = provider === 'sqlite'
  ? await runSqlite()
  : await runPostgresql();

console.log(JSON.stringify(toSafeResult(plan)));
