// Offscreen Script for Unthrottled Timer & Keep-Alive Engine

let tickInterval = null;

function startTicker() {
  if (tickInterval) return;
  tickInterval = setInterval(() => {
    try {
      chrome.runtime.sendMessage({ action: 'OFFSCREEN_TICK' }).catch(() => {});
    } catch (e) {}
  }, 1000);
}

function stopTicker() {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

// Start ticker immediately when offscreen document is mounted
startTicker();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'OFFSCREEN_START_TICKER') {
    startTicker();
    sendResponse({ success: true });
  } else if (request.action === 'OFFSCREEN_STOP_TICKER') {
    stopTicker();
    sendResponse({ success: true });
  }
  return true;
});
