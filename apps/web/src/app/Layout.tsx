import { NavLink, Outlet } from 'react-router';

const DISABLED_ITEMS = [
  'Products',
  'Campaigns',
  'Content drafts',
  'Asset library',
  'Calendar',
  'Publishing',
  'Usage',
  'Settings',
] as const;

const linkClass =
  'flex min-h-11 items-center rounded-md px-3 py-2 font-medium leading-relaxed hover:bg-[var(--co-surface)]';

export function Layout() {
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
        <nav aria-label="Main" className="mt-4">
          <ul className="flex flex-wrap gap-2 md:flex-col md:gap-1">
            <li>
              <NavLink to="/" end className={linkClass}>
                Overview
              </NavLink>
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
