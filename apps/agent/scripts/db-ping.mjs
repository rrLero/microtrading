// Connection diagnostic: prints the REAL error drizzle-kit swallows.
// Usage: pnpm --filter @microtrading/agent db:ping
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set — is apps/agent/.env present?');
  process.exit(1);
}
console.log(`Connecting to ${url.replace(/:\/\/([^:]+):[^@]+@/, '://$1:***@')} …`);

const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
try {
  await client.connect();
  const { rows } = await client.query('select version(), current_database()');
  console.log(`OK: ${rows[0].current_database} @ ${rows[0].version.split(',')[0]}`);
} catch (err) {
  console.error('CONNECTION FAILED:');
  console.error(err);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
