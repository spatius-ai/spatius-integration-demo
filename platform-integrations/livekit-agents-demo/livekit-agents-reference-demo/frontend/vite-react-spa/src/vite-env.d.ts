/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SPATIUS_APP_ID: string;
  readonly VITE_SPATIUS_AVATAR_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
