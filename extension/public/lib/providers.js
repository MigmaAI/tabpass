// Account providers: services that can pair this browser with a person's account in one click
// (Migma today). A provider's website talks to Tabpass through `externally_connectable`, which
// must list the same origins in manifest.json.

import { BUILD_MODE, DEV_PROVIDER_ORIGIN } from './build-config.js';

const MIGMA = {
  id: 'migma',
  name: 'Migma',
  origins: [/^https:\/\/([a-z0-9-]+\.)*migma\.ai$/],
  connectUrl: 'https://migma.ai/connect/browser',
  // The relay a provider hands us must live on its own domain, over TLS.
  relayHosts: [/^([a-z0-9-]+\.)*migma\.ai$/],
  allowInsecureRelay: false,
};

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1)$/;

export const PROVIDERS =
  BUILD_MODE === 'development' && DEV_PROVIDER_ORIGIN
    ? [
        {
          ...MIGMA,
          origins: [...MIGMA.origins, LOCAL_ORIGIN],
          connectUrl: `${DEV_PROVIDER_ORIGIN}/connect/browser`,
          relayHosts: [...MIGMA.relayHosts, LOCAL_HOST],
          allowInsecureRelay: true,
        },
      ]
    : [MIGMA];

export function providerById(id) {
  return PROVIDERS.find((provider) => provider.id === id) ?? null;
}

export function providerForOrigin(origin) {
  if (typeof origin !== 'string') return null;
  return PROVIDERS.find((provider) => provider.origins.some((pattern) => pattern.test(origin))) ?? null;
}

/** A provider may only point us at its own relay, so a compromised page cannot redirect the browser. */
export function relayAllowed(provider, relayUrl) {
  let url;
  try {
    url = new URL(relayUrl);
  } catch {
    return false;
  }
  const secure = url.protocol === 'wss:';
  const insecureOk = url.protocol === 'ws:' && provider.allowInsecureRelay && LOCAL_HOST.test(url.hostname);
  return (secure || insecureOk) && provider.relayHosts.some((pattern) => pattern.test(url.hostname));
}
