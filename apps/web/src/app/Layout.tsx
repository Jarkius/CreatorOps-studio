import { Link, NavLink, Outlet, matchPath, useLocation, useNavigate } from 'react-router';

import { buttonClassName } from '@creatorops/ui';

import { assetsPath } from '../features/assets/paths.js';
import { settingsPath } from '../features/settings/paths.js';
import { campaignsPath } from '../features/campaigns/paths.js';
import { costsPath } from '../features/costs/paths.js';
import { productsPath } from '../features/products/paths.js';
import { NEW_WORKSPACE_PATH } from '../features/workspaces/WorkspaceRequired.js';
import { useWorkspaces } from '../features/workspaces/useWorkspaces.js';

const DISABLED_ITEMS = ['Content drafts', 'Calendar', 'Publishing'] as const;

const linkClass =
  'flex min-h-11 items-center rounded-md px-3 py-2 font-medium leading-relaxed hover:bg-[var(--co-surface)]';

export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const workspaces = useWorkspaces();
  const items = workspaces.data ?? [];

  // The workspace in the URL wins; otherwise the first one the user belongs to.
  const routeMatch = matchPath('/w/:workspaceId/*', location.pathname);
  const routeWorkspaceId = routeMatch?.params.workspaceId;
  const current = items.find((workspace) => workspace.id === routeWorkspaceId) ?? items[0];

  const section = routeMatch?.params['*'];
  const onProductsList = section === 'products';
  const onAssetLibrary = section === 'assets';
  const switchWorkspace = (workspaceId: string) => {
    // Stay on the asset library when already there.
    if (onAssetLibrary) {
      navigate(assetsPath(workspaceId));
      return;
    }
    // Stay on the product list (keeping the status tab) when already there; otherwise open it.
    navigate(`${productsPath(workspaceId)}${onProductsList ? location.search : ''}`);
  };

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-[var(--co-accent)] focus:px-4 focus:py-2 focus:font-medium focus:text-[var(--co-accent-text)]"
      >
        Skip to content
      </a>

      <aside className="border-b border-[var(--co-border)] bg-[var(--co-surface)] p-4 md:w-60 md:shrink-0 md:border-r md:border-b-0">
        <p className="text-lg font-semibold leading-relaxed">CreatorOps Studio</p>
        {items.length > 1 && current !== undefined ? (
          <div className="mt-3">
            <select
              aria-label="Workspace"
              value={current.id}
              onChange={(event) => switchWorkspace(event.target.value)}
              className="w-full min-h-11 rounded-md border border-[var(--co-border)] bg-[var(--co-bg)] px-3 py-2 leading-relaxed text-[var(--co-text)]"
            >
              {items.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <Link to={NEW_WORKSPACE_PATH} className={`${buttonClassName('secondary')} mt-3 w-full`}>
          New workspace
        </Link>
        <nav aria-label="Main" className="mt-4">
          <ul className="flex flex-wrap gap-2 md:flex-col md:gap-1">
            <li>
              <NavLink to="/" end className={linkClass}>
                Overview
              </NavLink>
            </li>
            <li>
              {current === undefined ? (
                <span
                  aria-disabled="true"
                  className="flex min-h-11 items-center rounded-md px-3 py-2 leading-relaxed text-[var(--co-text-muted)]"
                >
                  Products
                </span>
              ) : (
                <NavLink to={productsPath(current.id)} className={linkClass}>
                  Products
                </NavLink>
              )}
            </li>
            <li>
              {current === undefined ? (
                <span
                  aria-disabled="true"
                  className="flex min-h-11 items-center rounded-md px-3 py-2 leading-relaxed text-[var(--co-text-muted)]"
                >
                  Campaigns
                </span>
              ) : (
                <NavLink to={campaignsPath(current.id)} className={linkClass}>
                  Campaigns
                </NavLink>
              )}
            </li>
            <li>
              {current === undefined ? (
                <span
                  aria-disabled="true"
                  className="flex min-h-11 items-center rounded-md px-3 py-2 leading-relaxed text-[var(--co-text-muted)]"
                >
                  Costs
                </span>
              ) : (
                <NavLink to={costsPath(current.id)} className={linkClass}>
                  Costs
                </NavLink>
              )}
            </li>
            <li>
              {current === undefined ? (
                <span
                  aria-disabled="true"
                  className="flex min-h-11 items-center rounded-md px-3 py-2 leading-relaxed text-[var(--co-text-muted)]"
                >
                  Asset library
                </span>
              ) : (
                <NavLink to={assetsPath(current.id)} className={linkClass}>
                  Asset library
                </NavLink>
              )}
            </li>
            <li>
              {current === undefined ? (
                <span
                  aria-disabled="true"
                  className="flex min-h-11 items-center rounded-md px-3 py-2 leading-relaxed text-[var(--co-text-muted)]"
                >
                  Settings
                </span>
              ) : (
                <NavLink to={settingsPath(current.id)} className={linkClass}>
                  Settings
                </NavLink>
              )}
            </li>
            {DISABLED_ITEMS.map((item) => (
              <li key={item}>
                <span
                  aria-disabled="true"
                  className="flex min-h-11 items-center gap-2 rounded-md px-3 py-2 leading-relaxed text-[var(--co-text-muted)]"
                >
                  {item}
                  <span className="rounded-full border border-[var(--co-border)] px-2 text-xs">
                    Soon
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 p-4 md:p-8">
        <Outlet />
      </main>
    </div>
  );
}
