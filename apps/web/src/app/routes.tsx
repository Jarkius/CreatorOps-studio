import type { RouteObject } from 'react-router';

import { OverviewPage } from '../features/overview/OverviewPage.js';
import { NewProductPage } from '../features/products/NewProductPage.js';
import { ProductEditPage } from '../features/products/ProductEditPage.js';
import { ProductsPage } from '../features/products/ProductsPage.js';
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
        path: 'w/:workspaceId/products',
        element: (
          <SessionGate>
            <ProductsPage />
          </SessionGate>
        ),
      },
      {
        path: 'w/:workspaceId/products/new',
        element: (
          <SessionGate>
            <NewProductPage />
          </SessionGate>
        ),
      },
      {
        path: 'w/:workspaceId/products/:productId',
        element: (
          <SessionGate>
            <ProductEditPage />
          </SessionGate>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
