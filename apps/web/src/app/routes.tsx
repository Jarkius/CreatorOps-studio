import type { RouteObject } from 'react-router';

import { AssetLibraryPage } from '../features/assets/AssetLibraryPage.js';
import { OverviewPage } from '../features/overview/OverviewPage.js';
import { NewProductPage } from '../features/products/NewProductPage.js';
import { ProductEditPage } from '../features/products/ProductEditPage.js';
import { ProductsPage } from '../features/products/ProductsPage.js';
import { NewWorkspacePage } from '../features/workspaces/NewWorkspacePage.js';
import { WorkspaceRequired } from '../features/workspaces/WorkspaceRequired.js';
import { Layout } from './Layout.js';
import { NotFoundPage } from './NotFoundPage.js';
import { SessionGate } from './SessionGate.js';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <OverviewPage /> },
      {
        path: 'w/:workspaceId/assets',
        element: (
          <SessionGate>
            <AssetLibraryPage />
          </SessionGate>
        ),
      },
      {
        path: 'w/:workspaceId/products',
        element: (
          <SessionGate>
            <WorkspaceRequired>
              <ProductsPage />
            </WorkspaceRequired>
          </SessionGate>
        ),
      },
      {
        path: 'w/:workspaceId/products/new',
        element: (
          <SessionGate>
            <WorkspaceRequired>
              <NewProductPage />
            </WorkspaceRequired>
          </SessionGate>
        ),
      },
      {
        path: 'w/:workspaceId/products/:productId',
        element: (
          <SessionGate>
            <WorkspaceRequired>
              <ProductEditPage />
            </WorkspaceRequired>
          </SessionGate>
        ),
      },
      {
        path: 'workspaces/new',
        element: (
          <SessionGate>
            <NewWorkspacePage />
          </SessionGate>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
