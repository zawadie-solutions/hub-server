// Clicking the toolbar icon opens the side panel. That click also gives the extension temporary access
// to the current tab (activeTab), which is how it reads the page's photos without broad permissions.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
