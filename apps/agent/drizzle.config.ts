import 'dotenv/config'; // drizzle-kit does not auto-load .env; the app scripts use node --env-file instead
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgres://micro:micro@localhost:55432/microtrading',
  },
});
