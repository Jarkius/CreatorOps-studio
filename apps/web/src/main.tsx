import { createRoot } from 'react-dom/client';

import { API_BASE_URL, AUTH_MODE } from './api/config.js';
import { createDashboardClient } from './api/client.js';
import { createTokenStore } from './api/session.js';
import { App } from './app/App.js';
import './styles.css';

const rootElement = document.getElementById('root');
if (rootElement === null) throw new Error('Missing #root element in index.html.');

const tokenStore = createTokenStore();
const client = createDashboardClient({ baseUrl: API_BASE_URL, getToken: tokenStore.get });

createRoot(rootElement).render(
  <App client={client} tokenStore={tokenStore} authMode={AUTH_MODE} />,
);
