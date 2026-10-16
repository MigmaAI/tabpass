// Replaced at build time by vite.config.ts. Production builds trust only the real providers and
// use the Migma-hosted relay; `yarn build:dev` uses a local relay and trusts a local fake Migma.
export const BUILD_MODE = 'production';
export const DEV_PROVIDER_ORIGIN = '';
export const DEFAULT_RELAY_URL = 'wss://tabs.migma.ai/extension';
