import { startup } from './startup.js';

process.exitCode = await startup(process.env, {
  stdout: process.stdout,
  stderr: process.stderr,
});
