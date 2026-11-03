/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin of the API. Defaults to http://localhost:3000. */
  readonly VITE_API_BASE_URL?: string;
  /** Set to "mock" to enable development sign-in. */
  readonly VITE_AUTH_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
