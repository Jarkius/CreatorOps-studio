import { MetaAiError, type MetaAiBrowser } from './runner.js';
import { META_AI_ORIGIN, META_AI_TAB_PATTERN } from './selectors.js';

const ORIGINS = [`${META_AI_ORIGIN}/*`];

/**
 * The real browser behind `MetaAiBrowser`: `chrome.permissions`, `chrome.tabs` and
 * `chrome.scripting`, limited to the one allowed site. The tab is found by its address pattern
 * and opened visibly, never in the background.
 */
export function createChromeBrowser(): MetaAiBrowser {
  return {
    hasPermission: () => chrome.permissions.contains({ origins: ORIGINS }),
    requestPermission: () => chrome.permissions.request({ origins: ORIGINS }),
    async findTab() {
      const tabs = await chrome.tabs.query({ url: META_AI_TAB_PATTERN });
      return tabs.find((tab) => tab.id !== undefined)?.id ?? null;
    },
    openTab(url, timeoutMs) {
      return new Promise<number>((resolve, reject) => {
        let openedId: number | undefined;
        const finish = (outcome: () => void) => {
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(onUpdated);
          outcome();
        };
        const onUpdated = (id: number, change: chrome.tabs.OnUpdatedInfo) => {
          if (id === openedId && change.status === 'complete') finish(() => resolve(id));
        };
        const timer = setTimeout(
          () => finish(() => reject(new Error('The tab did not finish loading.'))),
          timeoutMs,
        );
        chrome.tabs.onUpdated.addListener(onUpdated);
        chrome.tabs.create({ url, active: true }).then(
          (tab) => {
            openedId = tab.id;
            if (tab.id !== undefined && tab.status === 'complete') {
              finish(() => resolve(tab.id as number));
            }
          },
          (error: unknown) => finish(() => reject(error)),
        );
      });
    },
    async run(tabId, func, args) {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: func as (...input: unknown[]) => unknown,
          args,
        });
        return results[0]?.result as never;
      } catch {
        throw new MetaAiError(
          'PAGE_NOT_RECOGNISED',
          'The helper could not reach the Meta AI tab. Keep it open on meta.ai and try again.',
        );
      }
    },
  };
}
