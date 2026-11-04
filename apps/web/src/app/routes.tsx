import type { RouteObject } from 'react-router';

import { AssetLibraryPage } from '../features/assets/AssetLibraryPage.js';
import { CampaignPage } from '../features/campaigns/CampaignPage.js';
import { DraftPage } from '../features/drafts/DraftPage.js';
import { CampaignsPage } from '../features/campaigns/CampaignsPage.js';
import { NewCampaignPage } from '../features/campaigns/NewCampaignPage.js';
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
            <WorkspaceRequired>
              <AssetLibraryPage />
            </WorkspaceRequired>
          </SessionGate>
        ),
      },
      {
        path: 'w/:workspaceId/campaigns',
        element: (
          <SessionGate>
            <WorkspaceRequired>
              <CampaignsPage />
            </WorkspaceRequired>
          </SessionGate>
        ),
      },
      {
        path: 'w/:workspaceId/campaigns/new',
        element: (
          <SessionGate>
            <WorkspaceRequired>
              <NewCampaignPage />
            </WorkspaceRequired>
          </SessionGate>
        ),
      },
      {
        path: 'w/:workspaceId/campaigns/:campaignId',
        element: (
          <SessionGate>
            <WorkspaceRequired>
              <CampaignPage />
            </WorkspaceRequired>
          </SessionGate>
        ),
      },
      {
        path: 'w/:workspaceId/drafts/:draftId',
        element: (
          <SessionGate>
            <WorkspaceRequired>
              <DraftPage />
            </WorkspaceRequired>
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
