import { AppError } from '../../platform/errors.js';
import type { RequestContext } from './context.js';

const WRITE_ROLES: ReadonlySet<string> = new Set(['owner', 'admin', 'editor']);

/** Viewers and reviewers can read; only owners, admins and editors can change content. */
export function assertCanWrite(ctx: RequestContext): void {
  if (!WRITE_ROLES.has(ctx.role)) {
    throw new AppError('FORBIDDEN', 'You do not have permission to change this workspace.');
  }
}

const MANAGE_ROLES: ReadonlySet<string> = new Set(['owner', 'admin']);

/** Provider keys and spending limits are for owners and admins only, not editors. */
export function assertCanManageProvider(ctx: RequestContext): void {
  if (!MANAGE_ROLES.has(ctx.role)) {
    throw new AppError('FORBIDDEN', 'Only an owner or admin can change the provider settings.');
  }
}
