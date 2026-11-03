import type { RouteObject } from 'react-router';

import { OverviewPage } from '../features/overview/OverviewPage.js';
import { Layout } from './Layout.js';
import { NotFoundPage } from './NotFoundPage.js';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
