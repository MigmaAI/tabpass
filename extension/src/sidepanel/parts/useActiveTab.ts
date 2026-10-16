import { useEffect, useState } from 'react';

/** The URL of the tab the person is looking at in this window, kept current. */
export function useActiveTabUrl(): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const read = (): void => {
      chrome.tabs
        .query({ active: true, currentWindow: true })
        .then(([tab]) => setUrl(tab?.url ?? null))
        .catch(() => setUrl(null));
    };
    read();
    const onUpdated = (_id: number, info: chrome.tabs.OnUpdatedInfo): void => {
      if (info.url || info.status === 'complete') read();
    };
    chrome.tabs.onActivated.addListener(read);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(read);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);
  return url;
}
