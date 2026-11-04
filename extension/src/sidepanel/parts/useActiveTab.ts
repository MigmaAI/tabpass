import { useEffect, useState } from 'react';

/** The URL of the tab the person is looking at in this window, kept current. */
export function useActiveTabUrl(): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let currentRead = 0;
    let mounted = true;
    const read = (): void => {
      const readId = ++currentRead;
      chrome.tabs
        .query({ active: true, currentWindow: true })
        .then(([tab]) => {
          if (mounted && readId === currentRead) setUrl(tab?.url ?? null);
        })
        .catch(() => {
          if (mounted && readId === currentRead) setUrl(null);
        });
    };
    read();
    const onUpdated = (_id: number, info: chrome.tabs.OnUpdatedInfo): void => {
      if (info.url || info.status === 'complete') read();
    };
    chrome.tabs.onActivated.addListener(read);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.windows.onFocusChanged.addListener(read);
    return () => {
      mounted = false;
      currentRead += 1;
      chrome.tabs.onActivated.removeListener(read);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.windows.onFocusChanged.removeListener(read);
    };
  }, []);
  return url;
}
