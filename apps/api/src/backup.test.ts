import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from './platform/config.js';
import { requireDatabaseUrl, validEnv } from './test/db-url.js';
import { createPerson, type Person } from './test/people.js';
import { createTestDb, type TestDb } from './test/test-db.js';

interface Manifest {
  tables: Record<string, number>;
  files: { path: string; sha256: string }[];
  dump: { sha256: string };
}
interface BackupTools {
  backup(o: {
    databaseUrl: string;
    dataDir: string;
    outRoot: string;
  }): Promise<{ dir: string; manifest: Manifest }>;
  restoreBackup(o: {
    backupDir: string;
    databaseUrl: string;
    targetDatabase: string;
    targetDataDir: string;
    currentDatabase?: string;
    currentDataDir?: string;
  }): Promise<{ ok: boolean; problems: string[] }>;
  verifyBackup(o: {
    backupDir: string;
    databaseUrl: string;
  }): Promise<{ ok: boolean; problems: string[] }>;
}

const HAS_PG_TOOLS = (() => {
  try {
    execFileSync('pg_dump', ['--version'], { stdio: 'ignore' });
    execFileSync('pg_restore', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
if (!HAS_PG_TOOLS && process.env.SKIP_BACKUP_TESTS !== '1') {
  throw new Error(
    'pg_dump and pg_restore are not installed. Install the PostgreSQL client tools, or set SKIP_BACKUP_TESTS=1 to skip the backup tests on purpose.',
  );
}

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

let tools: BackupTools;
let testDb: TestDb;
let alice: Person;
let dataDir = '';
let outRoot = '';
let assetKey = '';
let assetBytes: Buffer;
const targets: string[] = [];
const scratchDirs: string[] = [];

const sql = (text: string, values: unknown[] = []) => testDb.pool.query(text, values);
const one = async (text: string, values: unknown[]): Promise<string> =>
  (await sql(text, values)).rows[0].id as string;
const freshName = () => {
  const name = `bk_${Math.random().toString(36).slice(2, 10)}`;
  targets.push(name);
  return name;
};
const freshDir = () => {
  const dir = path.join(mkdtempSync(path.join(os.tmpdir(), 'bk-restore-')), 'data');
  scratchDirs.push(path.dirname(dir));
  return dir;
};

beforeAll(async () => {
  if (!HAS_PG_TOOLS) return;
  tools = (await import(
    new URL('../../../scripts/db-backup.mjs', import.meta.url).href
  )) as BackupTools;
  testDb = await createTestDb(requireDatabaseUrl());
  alice = await createPerson(testDb.db, loadConfig(validEnv()).SESSION_SECRET, 'backup-alice');
  const base = mkdtempSync(path.join(os.tmpdir(), 'bk-source-'));
  scratchDirs.push(base);
  dataDir = path.join(base, 'media');
  outRoot = path.join(base, 'backups');
  // One ready asset with a real file, one ready export package with a real file, one stray file.
  const assetId = randomUUID();
  assetKey = `ws/${alice.workspaceId}/${assetId}/original.png`;
  assetBytes = Buffer.from(randomUUID().repeat(50));
  mkdirSync(path.dirname(path.join(dataDir, assetKey)), { recursive: true });
  writeFileSync(path.join(dataDir, assetKey), assetBytes);
  await sql(
    `insert into assets (id, workspace_id, type, status, mime_type, size_bytes, original_filename, sha256, storage_key, created_by)
     values ($1, $2, 'image', 'ready', 'image/png', $3, 'a.png', $4, $5, $6)`,
    [assetId, alice.workspaceId, assetBytes.length, sha(assetBytes), assetKey, alice.userId],
  );
  const product = await one(
    'insert into products (workspace_id, name) values ($1, $2) returning id',
    [alice.workspaceId, 'P'],
  );
  const campaign = await one(
    `insert into campaigns (workspace_id, product_id, name, template_id, template_version, language, duration_seconds, created_by)
     values ($1, $2, 'C', 'product-showcase', 1, 'th', 30, $3) returning id`,
    [alice.workspaceId, product, alice.userId],
  );
  const sections = {
    title: 't',
    hook: 'h',
    script: 's',
    storyboard: ['a'],
    caption: 'c',
    hashtags: ['#a'],
    callToAction: 'x',
  };
  const state = Object.fromEntries(
    Object.keys(sections).map((n) => [n, { rev: 1, origin: 'generated', jobId: null }]),
  );
  const draft = await one(
    `insert into content_drafts (workspace_id, campaign_id, product_id, sections, section_state) values ($1, $2, $3, $4, $5) returning id`,
    [alice.workspaceId, campaign, product, JSON.stringify(sections), JSON.stringify(state)],
  );
  const job = await one(
    `insert into jobs (workspace_id, type, status, input, output, created_by, idempotency_key, request_hash, draft_id, attempts, started_at, finished_at)
     values ($1, 'export_package', 'succeeded', '{}', '{}', $2, $3, repeat('b', 64), $4, 1, now(), now()) returning id`,
    [alice.workspaceId, alice.userId, `backup-test-${randomUUID()}`, draft],
  );
  const zip = Buffer.from('PK-test-package-' + randomUUID());
  const zipKey = `exports/${alice.workspaceId}/${job}.zip`;
  mkdirSync(path.dirname(path.join(dataDir, zipKey)), { recursive: true });
  writeFileSync(path.join(dataDir, zipKey), zip);
  await sql(
    `insert into draft_exports (workspace_id, draft_id, job_id, created_by, draft_version, file_count, size_bytes, sha256, filename, storage_key, manifest, expires_at)
     values ($1, $2, $3, $4, 1, 1, $5, $6, 'p.zip', $7, '{}', now() + interval '2 days')`,
    [alice.workspaceId, draft, job, alice.userId, zip.length, sha(zip), zipKey],
  );
  writeFileSync(path.join(dataDir, 'stray.txt'), 'not referenced by any row');
});

afterAll(async () => {
  if (!HAS_PG_TOOLS) return;
  const admin = (await import('pg')).default;
  const client = new admin.Client({
    connectionString: testDb.url.replace(/\/[^/]*$/, '/postgres'),
  });
  await client.connect();
  for (const name of targets) await client.query(`drop database if exists ${name} with (force)`);
  await client.end();
  await testDb.drop();
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!HAS_PG_TOOLS)('backup and restore', () => {
  it('backs up the database and the files, restores into a new database and folder, and proves it', async () => {
    const backup = await tools.backup({ databaseUrl: testDb.url, dataDir, outRoot });
    expect(backup.manifest.tables.assets).toBe(1);
    expect(backup.manifest.tables.draft_exports).toBe(1);
    const copied = backup.manifest.files.map((f) => f.path);
    expect(copied).toContain(assetKey);
    expect(copied).toContain('stray.txt');
    expect(copied.some((p) => p.startsWith('exports/') && p.endsWith('.zip'))).toBe(true);
    // The dump holds everything: private to the owner.
    expect(statSync(path.join(backup.dir, 'db.dump')).mode & 0o077).toBe(0);
    expect(statSync(backup.dir).mode & 0o077).toBe(0);

    const target = freshName();
    const targetDir = freshDir();
    const restored = await tools.restoreBackup({
      backupDir: backup.dir,
      databaseUrl: testDb.url,
      targetDatabase: target,
      targetDataDir: targetDir,
      currentDatabase: testDb.name,
      currentDataDir: dataDir,
    });
    expect(restored.problems).toEqual([]);
    expect(restored.ok).toBe(true);
    expect(readFileSync(path.join(targetDir, assetKey)).equals(assetBytes)).toBe(true);
    expect(existsSync(path.join(targetDir, 'stray.txt'))).toBe(true);
  });

  it('refuses to restore over the current database or folder, into a non-empty folder, or with a bad name', async () => {
    const backup = await tools.backup({ databaseUrl: testDb.url, dataDir, outRoot });
    const base = {
      backupDir: backup.dir,
      databaseUrl: testDb.url,
      currentDatabase: testDb.name,
      currentDataDir: dataDir,
    };
    await expect(
      tools.restoreBackup({ ...base, targetDatabase: testDb.name, targetDataDir: freshDir() }),
    ).rejects.toThrow('current database');
    await expect(
      tools.restoreBackup({ ...base, targetDatabase: freshName(), targetDataDir: dataDir }),
    ).rejects.toThrow('current data folder');
    const used = freshDir();
    mkdirSync(used, { recursive: true });
    writeFileSync(path.join(used, 'x'), 'x');
    await expect(
      tools.restoreBackup({ ...base, targetDatabase: freshName(), targetDataDir: used }),
    ).rejects.toThrow('not empty');
    await expect(
      tools.restoreBackup({ ...base, targetDatabase: 'Bad Name;drop', targetDataDir: freshDir() }),
    ).rejects.toThrow('lower-case');
  });

  it('notices a damaged dump, a damaged file, and a file that no longer matches its row', async () => {
    const damagedFile = await tools.backup({ databaseUrl: testDb.url, dataDir, outRoot });
    writeFileSync(path.join(damagedFile.dir, 'files', ...assetKey.split('/')), 'tampered');
    await expect(
      tools.restoreBackup({
        backupDir: damagedFile.dir,
        databaseUrl: testDb.url,
        targetDatabase: freshName(),
        targetDataDir: freshDir(),
        currentDatabase: testDb.name,
        currentDataDir: dataDir,
      }),
    ).rejects.toThrow('damaged');

    const damagedDump = await tools.backup({ databaseUrl: testDb.url, dataDir, outRoot });
    writeFileSync(path.join(damagedDump.dir, 'db.dump'), 'not a dump');
    await expect(
      tools.restoreBackup({
        backupDir: damagedDump.dir,
        databaseUrl: testDb.url,
        targetDatabase: freshName(),
        targetDataDir: freshDir(),
        currentDatabase: testDb.name,
        currentDataDir: dataDir,
      }),
    ).rejects.toThrow('damaged');

    // A file that was swapped before the backup, so its copy is "intact" but is not the file the
    // database row describes: only the check against the row can see it.
    const swapped = await tools.backup({ databaseUrl: testDb.url, dataDir, outRoot });
    const fake = Buffer.from('a different picture');
    const file = path.join(swapped.dir, 'files', ...assetKey.split('/'));
    writeFileSync(file, fake);
    const manifestFile = path.join(swapped.dir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as Manifest;
    for (const entry of manifest.files) if (entry.path === assetKey) entry.sha256 = sha(fake);
    writeFileSync(manifestFile, JSON.stringify(manifest));
    const result = await tools.restoreBackup({
      backupDir: swapped.dir,
      databaseUrl: testDb.url,
      targetDatabase: freshName(),
      targetDataDir: freshDir(),
      currentDatabase: testDb.name,
      currentDataDir: dataDir,
    });
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain('does not match its recorded size or hash');
  });

  it('notices a ready export package whose file did not come back', async () => {
    const zipKey = (
      await sql(`select storage_key from draft_exports where status = 'ready' limit 1`)
    ).rows[0].storage_key as string;
    const zipFile = path.join(dataDir, ...zipKey.split('/'));
    const zipBytes = readFileSync(zipFile);
    rmSync(zipFile);
    try {
      const backup = await tools.backup({ databaseUrl: testDb.url, dataDir, outRoot });
      const result = await tools.restoreBackup({
        backupDir: backup.dir,
        databaseUrl: testDb.url,
        targetDatabase: freshName(),
        targetDataDir: freshDir(),
        currentDatabase: testDb.name,
        currentDataDir: dataDir,
      });
      expect(result.ok).toBe(false);
      expect(result.problems.join(' ')).toContain('file is missing');
    } finally {
      writeFileSync(zipFile, zipBytes);
    }
  });

  it('notices when the restored row counts differ from the backup', async () => {
    const backup = await tools.backup({ databaseUrl: testDb.url, dataDir, outRoot });
    const manifestFile = path.join(backup.dir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as Manifest;
    manifest.tables.assets = 5;
    writeFileSync(manifestFile, JSON.stringify(manifest));
    const result = await tools.restoreBackup({
      backupDir: backup.dir,
      databaseUrl: testDb.url,
      targetDatabase: freshName(),
      targetDataDir: freshDir(),
      currentDatabase: testDb.name,
      currentDataDir: dataDir,
    });
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain(
      'table assets: 1 rows after restore, 5 in the backup',
    );
  });

  it('the check restores into a scratch database and folder and removes both', async () => {
    const scratchNames = async () =>
      (await sql(`select datname from pg_database where datname like 'backup_verify_%'`)).rows
        .map((row) => row.datname as string)
        .sort();
    const before = await scratchNames();
    const backup = await tools.backup({ databaseUrl: testDb.url, dataDir, outRoot });
    const checked = await tools.verifyBackup({ backupDir: backup.dir, databaseUrl: testDb.url });
    expect(checked.problems).toEqual([]);
    expect(checked.ok).toBe(true);
    // Only this call's scratch database matters: others may belong to other runs.
    expect(await scratchNames()).toEqual(before);
    const folders = (await import('node:fs'))
      .readdirSync(path.dirname(backup.dir))
      .filter((n) => n.startsWith('.verify-'));
    expect(folders).toEqual([]);
  });
});
