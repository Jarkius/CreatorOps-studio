// Starts the background worker for the dashboard e2e suite. The worker has no HTTP port, so this
// wrapper opens a bare TCP port that Playwright can wait on, then runs the worker in-process.
import net from 'node:net';
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.WORKER_PORT);
net.createServer().listen(port, '127.0.0.1');
await import(path.resolve(here, '..', '..', 'api', 'dist', 'worker.js'));
