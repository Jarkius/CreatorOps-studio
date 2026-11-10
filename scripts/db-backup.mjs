// Backup, restore and a tested restore for the database and the media files (D-088).
//
//   pnpm backup                      dump the database, then copy the files, into .data/backups/<time>/
//   pnpm backup:check                make a backup, restore it into a scratch database and folder,
//                                    check what came back, then drop the scratch copies
//   pnpm restore -- <dir> --database <new name> --data-dir <new folder>
//                                    restore into a NEW database and folder, never over live data
//
// Options: --database <name> (default: the database in DATABASE_URL), --data-dir <path> (default:
// DATA_DIR or .data/media), --out <dir> (default .data/backups). The database password is passed to
// the PostgreSQL tools through the environment, never on a command line, and never printed.
// NOT in a backup: SECRETS_ENCRYPTION_KEY. Keep it separately; without it the saved provider keys
// cannot be read and must be entered again.
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** How many migrations the code in this checkout has. */
const codeMigrationCount = () => {
  const dir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'infra',
    'migrations',
  );
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.sql')).length : null;
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pg = createRequire(path.join(root, 'apps', 'api', 'package.json'))('pg');
const NAME = /^[a-z][a-z0-9_]{0,62}$/;

export const defaults = () => ({
  dataDir: path.resolve(root, process.env.DATA_DIR ?? '.data/media'),
  outRoot: path.resolve(root, '.data', 'backups'),
});

const withDatabase = (url, database) => {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
};
const databaseOf = (url) => decodeURIComponent(new URL(url).pathname.slice(1));

/** Connection details for the PostgreSQL tools as environment variables (no URL in argv). */
function pgEnv(url) {
  const u = new URL(url);
  return {
    ...process.env,
    PGHOST: u.hostname,
    PGPORT: u.port || '5432',
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.slice(1)),
  };
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'ignore', 'pipe'], shell: false });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr = (stderr + chunk).slice(-1500)));
    child.on('error', (error) =>
      reject(
        error.code === 'ENOENT'
          ? new Error(`${command} was not found. Install the PostgreSQL client tools.`)
          : error,
      ),
    );
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} failed (${code}): ${stderr.trim()}`)),
    );
  });
}

const major = (text) => Number(/(\d+)(?:\.\d+)?/.exec(text)?.[1] ?? 0);

/**
 * The pg_dump and pg_restore tools must be the same major version as the server. An older pg_dump
 * cannot read a newer server. A newer one writes a dump with settings the older server rejects when
 * restoring (PostgreSQL 17 and later write `SET transaction_timeout`, which PostgreSQL 16 refuses),
 * so the backup would look fine and then fail to restore.
 */
export function checkClientVersion(dumpVersion, serverVersion) {
  const client = major(dumpVersion);
  const server = major(serverVersion);
  if (client === server) return;
  const relation = client < server ? 'older' : 'newer';
  throw new Error(
    `pg_dump is ${relation} (${dumpVersion}) than the server (${serverVersion}). Install the PostgreSQL ${server} client tools (pg_dump and pg_restore) so a backup can be restored.`,
  );
}

async function sha256File(file) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

/** Every file under a folder (relative, sorted). */
function walk(dir) {
  const out = [];
  const visit = (current) => {
    for (const name of readdirSync(current).sort()) {
      const full = path.join(current, name);
      if (statSync(full).isDirectory()) visit(full);
      else out.push(path.relative(dir, full));
    }
  };
  if (existsSync(dir)) visit(dir);
  return out;
}

/** Copies a file with a stream, hashing as it goes. Returns its size and sha256. */
async function copyHashed(from, to, mode = 0o600) {
  mkdirSync(path.dirname(to), { recursive: true, mode: 0o700 });
  const hash = createHash('sha256');
  let size = 0;
  const tap = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      size += chunk.length;
      callback(null, chunk);
    },
  });
  await pipeline(createReadStream(from), tap, createWriteStream(to, { mode }));
  return { size, sha256: hash.digest('hex') };
}

const quote = (identifier) => `"${identifier.replaceAll('"', '""')}"`;

async function tableCounts(client) {
  const tables = await client.query(
    `select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`,
  );
  const counts = {};
  for (const { table_name: name } of tables.rows) {
    counts[name] = Number(
      (await client.query(`select count(*) as n from public.${quote(name)}`)).rows[0].n,
    );
  }
  return counts;
}

async function migrationState(client) {
  const state = await client.query(
    `select count(*)::int as n, max(id) as last from drizzle.__drizzle_migrations`,
  );
  return { count: state.rows[0].n, lastId: state.rows[0].last };
}

/**
 * Dumps the database, then copies the files. The row counts and the dump come from one snapshot, so
 * they match exactly. Files are copied after the dump, so every row in the dump has its file
 * (files newer than the dump are only orphans the sweepers remove).
 */
export async function backup({ databaseUrl, dataDir, outRoot }) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(outRoot, stamp);
  try {
    const serverVersion = (await client.query('show server_version')).rows[0].server_version;
    const dumpVersion = execFileSync('pg_dump', ['--version'], { encoding: 'utf8' }).trim();
    checkClientVersion(dumpVersion, serverVersion);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);

    await client.query('begin isolation level repeatable read read only');
    const snapshot = (await client.query('select pg_export_snapshot() as id')).rows[0].id;
    const tables = await tableCounts(client);
    const migrations = { ...(await migrationState(client)), expected: codeMigrationCount() };
    const dumpFile = path.join(dir, 'db.dump');
    await run(
      'pg_dump',
      ['--format=custom', '--no-owner', '--no-acl', `--snapshot=${snapshot}`, '--file', dumpFile],
      pgEnv(databaseUrl),
    );
    await client.query('commit');
    chmodSync(dumpFile, 0o600);
    const dump = {
      file: 'db.dump',
      size: statSync(dumpFile).size,
      sha256: await sha256File(dumpFile),
    };

    const files = [];
    for (const relative of walk(dataDir)) {
      const copied = await copyHashed(
        path.join(dataDir, relative),
        path.join(dir, 'files', relative),
      );
      files.push({ path: relative.split(path.sep).join('/'), ...copied });
    }
    const manifest = {
      format: 1,
      createdAt: new Date().toISOString(),
      database: databaseOf(databaseUrl),
      serverVersion,
      pgDump: dumpVersion,
      migrations,
      tables,
      dump,
      filesCopiedAt: new Date().toISOString(),
      files,
    };
    const manifestFile = path.join(dir, 'manifest.json');
    writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), { mode: 0o600 });
    return { dir, manifest };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Restores a backup into a NEW database and a NEW (empty) folder, then checks what came back.
 * Refuses the current database and folder, and anything that is not empty.
 */
export async function restoreBackup({
  backupDir,
  databaseUrl,
  targetDatabase,
  targetDataDir,
  currentDatabase = databaseOf(databaseUrl),
  currentDataDir = defaults().dataDir,
  skipMigrateCheck = false,
  scratch = false,
}) {
  if (!NAME.test(targetDatabase)) {
    throw new Error('The target database name must be lower-case letters, digits and underscores.');
  }
  if (targetDatabase === currentDatabase) {
    throw new Error('Refusing to restore over the current database. Use a new database name.');
  }
  if (path.resolve(targetDataDir) === path.resolve(currentDataDir)) {
    throw new Error('Refusing to restore into the current data folder. Use a new folder.');
  }
  if (existsSync(targetDataDir) && readdirSync(targetDataDir).length > 0) {
    throw new Error('The target data folder is not empty.');
  }
  const manifest = JSON.parse(readFileSync(path.join(backupDir, 'manifest.json'), 'utf8'));
  const dumpFile = path.join(backupDir, manifest.dump.file);
  if ((await sha256File(dumpFile)) !== manifest.dump.sha256) {
    throw new Error('The database dump does not match its recorded hash: the backup is damaged.');
  }

  const targetUrl = withDatabase(databaseUrl, targetDatabase);
  const admin = new pg.Client({ connectionString: withDatabase(databaseUrl, 'postgres') });
  await admin.connect();
  try {
    const found = await admin.query('select 1 from pg_database where datname = $1', [
      targetDatabase,
    ]);
    if (found.rowCount === 0) await admin.query(`create database ${quote(targetDatabase)}`);
  } finally {
    await admin.end();
  }
  const target = new pg.Client({ connectionString: targetUrl });
  await target.connect();
  try {
    const present = await target.query(
      `select count(*)::int as n from information_schema.tables where table_schema in ('public', 'drizzle')`,
    );
    if (present.rows[0].n > 0) throw new Error('The target database is not empty.');
  } finally {
    await target.end();
  }

  try {
    // The database name is not secret; the password travels in the environment.
    await run(
      'pg_restore',
      ['--no-owner', '--no-acl', '--exit-on-error', '--dbname', targetDatabase, dumpFile],
      pgEnv(targetUrl),
    );

    mkdirSync(targetDataDir, { recursive: true, mode: 0o700 });
    for (const file of manifest.files) {
      const copied = await copyHashed(
        path.join(backupDir, 'files', ...file.path.split('/')),
        path.join(targetDataDir, ...file.path.split('/')),
      );
      if (copied.sha256 !== file.sha256) {
        throw new Error(`A backed-up file is damaged: ${file.path}`);
      }
    }
    const problems = await checkRestore({ manifest, targetUrl, targetDataDir, skipMigrateCheck });
    return { ok: problems.length === 0, problems, manifest, targetDatabase, targetDataDir };
  } catch (error) {
    if (scratch) throw error;
    // Never dropped for you: say what was left and how to remove it.
    throw new Error(
      `${error.message}\nThe partly restored database "${targetDatabase}" and the folder ${targetDataDir} were left in place. Remove them before trying again: psql -c 'drop database ${targetDatabase} with (force)' (from the postgres database) and rm -r ${targetDataDir}`,
    );
  }
}

/** What a restore must show to count as proven. Returns a list of problems (empty means proven). */
async function checkRestore({ manifest, targetUrl, targetDataDir, skipMigrateCheck }) {
  const problems = [];
  const client = new pg.Client({ connectionString: targetUrl });
  await client.connect();
  try {
    const counts = await tableCounts(client);
    for (const [table, expected] of Object.entries(manifest.tables)) {
      if (counts[table] !== expected) {
        problems.push(
          `table ${table}: ${String(counts[table])} rows after restore, ${String(expected)} in the backup`,
        );
      }
    }
    const state = await migrationState(client);
    if (state.count !== manifest.migrations.count || state.lastId !== manifest.migrations.lastId) {
      problems.push('the applied migrations differ from the backup');
    }
    // Every ready asset needs its file, with the recorded size and hash.
    const assets = await client.query(
      `select id, storage_key, sha256, size_bytes from assets where status = 'ready'`,
    );
    for (const row of assets.rows) {
      const file = path.join(targetDataDir, ...row.storage_key.split('/'));
      if (!existsSync(file)) problems.push(`asset ${row.id}: file is missing`);
      else if (
        statSync(file).size !== Number(row.size_bytes) ||
        (await sha256File(file)) !== row.sha256
      ) {
        problems.push(`asset ${row.id}: file does not match its recorded size or hash`);
      }
    }
    // Ready packages that were still valid when the files were copied.
    const exports = await client.query(
      `select id, storage_key, sha256 from draft_exports where status = 'ready' and expires_at > $1::timestamptz`,
      [manifest.filesCopiedAt],
    );
    for (const row of exports.rows) {
      const file = path.join(targetDataDir, ...row.storage_key.split('/'));
      if (!existsSync(file)) problems.push(`export ${row.id}: file is missing`);
      else if ((await sha256File(file)) !== row.sha256) {
        problems.push(`export ${row.id}: file does not match its hash`);
      }
    }
  } finally {
    await client.end();
  }
  // Applying the migrations to the restored database must change nothing.
  const cli = path.join(root, 'apps', 'api', 'dist', 'db', 'cli.js');
  if (!skipMigrateCheck && existsSync(cli)) {
    try {
      await run(process.execPath, [cli, 'migrate'], { ...process.env, DATABASE_URL: targetUrl });
      const after = new pg.Client({ connectionString: targetUrl });
      await after.connect();
      const state = await migrationState(after);
      await after.end();
      if (state.count !== manifest.migrations.count) {
        const behind =
          (manifest.migrations.expected ?? manifest.migrations.count) - manifest.migrations.count;
        problems.push(
          behind > 0
            ? `this database was ${String(behind)} migration(s) behind the code, so db:migrate changed the restored copy. The backup itself is fine; back up the database you actually use (pnpm demo uses creatorops_demo: --database creatorops_demo).`
            : 'migrate changed the restored database',
        );
      }
    } catch (error) {
      problems.push(`migrate failed on the restored database: ${error.message}`);
    }
  }
  return problems;
}

/** Restores into a scratch database and folder, checks, and always removes both. */
export async function verifyBackup({ backupDir, databaseUrl, skipMigrateCheck = false }) {
  const stamp = Date.now().toString(36);
  const scratchDb = `backup_verify_${stamp}`;
  const scratchDir = path.join(path.dirname(backupDir), `.verify-${stamp}`);
  try {
    return await restoreBackup({
      backupDir,
      databaseUrl,
      targetDatabase: scratchDb,
      targetDataDir: scratchDir,
      skipMigrateCheck,
      scratch: true,
    });
  } finally {
    const admin = new pg.Client({ connectionString: withDatabase(databaseUrl, 'postgres') });
    await admin.connect();
    await admin
      .query(`drop database if exists ${quote(scratchDb)} with (force)`)
      .catch(() => undefined);
    await admin.end();
    rmSync(scratchDir, { recursive: true, force: true });
  }
}

function option(args, name) {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
}

function summary(manifest) {
  const rows = Object.values(manifest.tables).reduce((sum, n) => sum + n, 0);
  const bytes = manifest.files.reduce((sum, f) => sum + f.size, 0);
  return `${String(rows)} rows in ${String(Object.keys(manifest.tables).length)} tables, ${String(manifest.files.length)} files (${String(bytes)} bytes), ${String(manifest.migrations.count)} migrations`;
}

async function main(argv) {
  // pnpm passes a literal `--` through; it is not an argument.
  const [command, ...rest] = argv.filter((arg) => arg !== '--');
  const databaseUrlEnv = process.env.DATABASE_URL;
  if (!databaseUrlEnv) {
    throw new Error(
      'DATABASE_URL is not set (for example: export DATABASE_URL="$(bash scripts/pg-local.sh url)").',
    );
  }
  const databaseUrl =
    option(rest, 'database') && command !== 'restore'
      ? withDatabase(databaseUrlEnv, option(rest, 'database'))
      : databaseUrlEnv;
  const base = defaults();
  const dataDir = path.resolve(option(rest, 'data-dir') ?? base.dataDir);
  const outRoot = path.resolve(option(rest, 'out') ?? base.outRoot);

  if (command === 'backup' || command === 'check') {
    console.log(`Backing up database "${databaseOf(databaseUrl)}" and the files in ${dataDir}`);
    const result = await backup({ databaseUrl, dataDir, outRoot });
    console.log(`Backup written to ${result.dir}\n  ${summary(result.manifest)}`);
    const { count, expected } = result.manifest.migrations;
    if (expected !== null && count < expected) {
      console.log(
        `Note: this database is ${String(expected - count)} migration(s) behind the code. If you meant the database you actually use, run again with --database <name> (pnpm demo uses creatorops_demo).`,
      );
    }
    console.log(
      'Keep SECRETS_ENCRYPTION_KEY separately: it is not in the backup, and the saved provider keys cannot be read without it.',
    );
    if (command === 'check') {
      const checked = await verifyBackup({ backupDir: result.dir, databaseUrl });
      if (!checked.ok) {
        console.error('RESTORE CHECK FAILED:\n  ' + checked.problems.join('\n  '));
        process.exit(1);
      }
      console.log(
        'Restore check passed: restored into a scratch database and folder, counts, migrations, files and hashes all match (scratch copies removed).',
      );
    }
    return;
  }
  if (command === 'restore') {
    const backupDir = path.resolve(rest[0] ?? '');
    const targetDatabase = option(rest, 'database');
    const targetDataDir = option(rest, 'data-dir');
    if (!rest[0] || !targetDatabase || !targetDataDir) {
      throw new Error(
        'Usage: pnpm restore -- <backup folder> --database <new database name> --data-dir <new folder>',
      );
    }
    const result = await restoreBackup({
      backupDir,
      databaseUrl,
      targetDatabase,
      targetDataDir: path.resolve(targetDataDir),
      currentDataDir: base.dataDir,
    });
    if (!result.ok) {
      console.error('RESTORE CHECK FAILED:\n  ' + result.problems.join('\n  '));
      process.exit(1);
    }
    console.log(
      `Restored ${summary(result.manifest)}.\nTo use it, run the API and the worker with:\n  DATABASE_URL pointing at database "${targetDatabase}"\n  DATA_DIR=${path.resolve(targetDataDir)}\nand set the same SECRETS_ENCRYPTION_KEY as before.`,
    );
    return;
  }
  throw new Error('Usage: backup | check | restore <folder> --database <new> --data-dir <new>');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`error: ${error.message}`);
    process.exit(1);
  });
}
