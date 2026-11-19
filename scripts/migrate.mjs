import pg from 'pg';
import * as fs from 'node:fs';
import * as path from 'node:path';

function loadEnv() {
  const envFiles = ['.env.local', '.env'];
  for (const file of envFiles) {
    const fullPath = path.resolve(process.cwd(), file);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    }
  }
}
loadEnv();

let connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("Missing DATABASE_URL in environment.");
  process.exit(1);
}
if ((connectionString.startsWith('"') && connectionString.endsWith('"')) || (connectionString.startsWith("'") && connectionString.endsWith("'"))) {
  connectionString = connectionString.slice(1, -1);
}

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  await client.connect();
  console.log("Connected to PostgreSQL database successfully.");

  // Ensure supabase_migrations schema and table exist
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS supabase_migrations;
    CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
      version text PRIMARY KEY,
      statements text[],
      name text
    );
  `);

  const { rows } = await client.query("SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;");
  const appliedSet = new Set(rows.map(r => r.version));
  console.log(`Found ${appliedSet.size} previously applied migrations.`);

  const migrationsDir = path.resolve(process.cwd(), "supabase", "migrations");
  const allFiles = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith(".sql"))
    .sort();

  const pending = [];
  for (const file of allFiles) {
    const match = file.match(/^(\d{14})_(.*)\.sql$/);
    if (!match) continue;
    const [, version, name] = match;
    if (!appliedSet.has(version)) {
      pending.push({ file, version, name });
    }
  }

  if (pending.length === 0) {
    console.log("All migrations are already up-to-date! Zero pending migrations.");
    await client.end();
    return;
  }

  console.log(`Applying ${pending.length} pending migration(s):`);
  for (const m of pending) {
    console.log(`  -> [PENDING] ${m.file} (version: ${m.version})`);
  }

  for (const m of pending) {
    const filePath = path.join(migrationsDir, m.file);
    const sql = fs.readFileSync(filePath, "utf8");
    console.log(`\n======================================================`);
    console.log(`Executing: ${m.file}`);
    console.log(`======================================================`);

    const startTime = Date.now();
    await client.query("BEGIN;");
    try {
      await client.query(sql);
      await client.query(
        "INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ($1, $2, $3);",
        [m.version, m.name, []]
      );
      await client.query("COMMIT;");
      const elapsed = Date.now() - startTime;
      console.log(`✓ Successfully applied: ${m.file} (${elapsed}ms)`);
    } catch (err) {
      await client.query("ROLLBACK;");
      console.error(`✗ FAILED to apply: ${m.file}`);
      console.error(err);
      process.exit(1);
    }
  }

  console.log("\n======================================================");
  console.log("All pending database migrations applied successfully!");
  console.log("======================================================");
  await client.end();
}

main().catch(err => {
  console.error("Migration execution fatal error:", err);
  process.exit(1);
});
