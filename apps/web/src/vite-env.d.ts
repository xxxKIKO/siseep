/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API base URL. Defaults to `/api/v1` (same origin through the Vite proxy / Vercel rewrite). */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
