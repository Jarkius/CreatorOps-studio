/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the CreatorOps API. Defaults to http://localhost:3000. */
  readonly VITE_API_BASE_URL?: string;
  /** URL of the web dashboard that "Open dashboard" links to. */
  readonly VITE_DASHBOARD_URL?: string;
  /** "mock" enables development sign-in against the API's mock-token endpoint. */
  readonly VITE_AUTH_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
