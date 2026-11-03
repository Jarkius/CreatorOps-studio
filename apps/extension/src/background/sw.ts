// Service worker. Stateless by design (D-029): Chrome may stop it at any time, so it keeps no
// variables between events and imports nothing. All durable state lives on the backend.

async function enableActionPanel(): Promise<void> {
  // Clicking the toolbar icon opens the side panel.
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

function onLifecycle(): void {
  enableActionPanel().catch((error: unknown) => {
    console.error('CreatorOps: could not enable the side panel action', error);
  });
}

chrome.runtime.onInstalled.addListener(onLifecycle);
chrome.runtime.onStartup.addListener(onLifecycle);

// Marks this file as a module for TypeScript. It compiles to nothing and adds no import.
export {};
