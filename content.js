// Persistent Content Script & Background Tracking Engine

let trackingTimer = null;
let trackingState = {
  isRunning: false,
  intervalSeconds: 10,
  secondsLeft: 10,
  lastData: [],
  lastUpdatedTime: null,
  error: null
};

// Load initial state from storage if present
chrome.storage.local.get(['bankBotTrackingState'], (result) => {
  if (result.bankBotTrackingState) {
    trackingState = { ...trackingState, ...result.bankBotTrackingState };
    // If it was running when tab reloaded/started, resume tracking
    if (trackingState.isRunning) {
      startTrackingEngine();
    } else {
      stopTrackingEngine();
    }
  }
});

// Listen for messages from Popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'GET_STATE':
      sendResponse({ success: true, state: trackingState });
      break;

    case 'START_TRACKING':
      getSettings((settings) => {
        const interval = parseInt(settings.intervalSeconds, 10) || 10;
        trackingState.intervalSeconds = interval;
        trackingState.secondsLeft = interval;
        trackingState.isRunning = true;
        trackingState.error = null;

        // Perform initial immediate scan
        runDataScan(settings);
        startTrackingEngine();
        saveState();

        sendResponse({ success: true, state: trackingState });
      });
      return true; // async response

    case 'STOP_TRACKING':
      stopTrackingEngine();
      saveState();
      sendResponse({ success: true, state: trackingState });
      break;

    case 'FORCE_READ':
      getSettings((settings) => {
        const interval = parseInt(settings.intervalSeconds, 10) || trackingState.intervalSeconds || 10;
        trackingState.intervalSeconds = interval;
        trackingState.secondsLeft = interval;
        trackingState.error = null;

        runDataScan(settings);
        saveState();

        sendResponse({ success: true, state: trackingState });
      });
      return true; // async response

    default:
      sendResponse({ success: false, error: 'Bilinmeyen işlem' });
  }
  return true;
});

function getSettings(callback) {
  const DEFAULT_SETTINGS = {
    targetUrl: '',
    intervalSeconds: 10,
    headerDate: 'Transaction Date',
    headerNarration: 'Narration',
    headerRef: 'Transaction Reference',
    headerCredit: 'Credit'
  };

  chrome.storage.local.get(['bankBotSettings'], (result) => {
    callback(result.bankBotSettings || DEFAULT_SETTINGS);
  });
}

function startTrackingEngine() {
  // Always stop existing timer first to prevent duplicate timer leaks
  stopTrackingEngine();

  trackingState.isRunning = true;

  trackingTimer = setInterval(() => {
    if (!trackingState.isRunning) {
      stopTrackingEngine();
      return;
    }

    trackingState.secondsLeft--;

    if (trackingState.secondsLeft <= 0) {
      getSettings((settings) => {
        if (!trackingState.isRunning) return; // Prevent execution if stopped during async call
        runDataScan(settings);
        trackingState.secondsLeft = trackingState.intervalSeconds;
        saveState();
      });
    } else {
      saveState();
    }
  }, 1000);
}

function stopTrackingEngine() {
  if (trackingTimer !== null) {
    clearInterval(trackingTimer);
    trackingTimer = null;
  }
  trackingState.isRunning = false;
}

function runDataScan(settings) {
  const currentUrl = window.location.href.toLowerCase();
  const targetUrl = (settings.targetUrl || '').trim().toLowerCase();

  // URL Containment Check
  if (targetUrl && !currentUrl.includes(targetUrl)) {
    trackingState.error = `Mevcut URL ("${window.location.href}"), hedef URL'yi ("${settings.targetUrl}") kapsamıyor.`;
    return;
  }

  const targetHeaders = {
    date: (settings.headerDate || 'Transaction Date').trim(),
    narration: (settings.headerNarration || 'Narration').trim(),
    ref: (settings.headerRef || 'Transaction Reference').trim(),
    credit: (settings.headerCredit || 'Credit').trim()
  };

  const headerMap = findColumnHeaderMap(targetHeaders);

  if (!headerMap.date && !headerMap.narration && !headerMap.ref && !headerMap.credit) {
    trackingState.error = `Sayfada belirtilen başlıkların hiçbiri bulunamadı.`;
    return;
  }

  let rowElements = document.querySelectorAll('.x-grid3-row');
  if (!rowElements || rowElements.length === 0) {
    const tableEl = headerMap.tableContainer || document;
    rowElements = tableEl.querySelectorAll('tbody tr, tr:not(:first-child)');
  }

  if (!rowElements || rowElements.length === 0) {
    trackingState.error = 'Başlıklar bulundu ancak verileri içeren tablo satırları bulunamadı.';
    return;
  }

  const dataList = [];
  rowElements.forEach((row) => {
    const dateText = extractCellValue(row, headerMap.date);
    const narrationText = extractCellValue(row, headerMap.narration);
    const refText = extractCellValue(row, headerMap.ref);
    const creditText = extractCellValue(row, headerMap.credit);

    if (dateText || narrationText || refText || creditText) {
      dataList.push({
        date: dateText,
        narration: narrationText,
        ref: refText,
        credit: creditText
      });
    }
  });

  trackingState.lastData = dataList;
  trackingState.lastUpdatedTime = new Date().toLocaleTimeString();
  trackingState.error = null;
}

function saveState() {
  chrome.storage.local.set({ bankBotTrackingState: trackingState });
  // Broadcast update to popup if listening
  chrome.runtime.sendMessage({ action: 'STATE_UPDATE', state: trackingState }).catch(() => {
    // Ignore errors when popup is closed
  });
}

function findColumnHeaderMap(targetHeaders) {
  const result = {
    date: null,
    narration: null,
    ref: null,
    credit: null,
    tableContainer: null
  };

  const candidateElements = document.querySelectorAll('th, td.x-grid3-hd, div.x-grid3-hd-inner, td, div');

  candidateElements.forEach((el) => {
    const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) return;

    for (const key of ['date', 'narration', 'ref', 'credit']) {
      if (!result[key] && isTextMatch(text, targetHeaders[key])) {
        result[key] = analyzeHeaderElement(el);
        if (!result.tableContainer) {
          result.tableContainer = el.closest('table') || el.closest('.x-panel') || el.closest('.x-grid3');
        }
      }
    }
  });

  return result;
}

function isTextMatch(elementText, targetText) {
  if (!elementText || !targetText) return false;
  const cleanElement = elementText.toLowerCase();
  const cleanTarget = targetText.toLowerCase();
  return cleanElement === cleanTarget || cleanElement.startsWith(cleanTarget);
}

function analyzeHeaderElement(headerEl) {
  const classList = Array.from(headerEl.classList || []);
  const parentTd = headerEl.closest('td');
  const parentClasses = parentTd ? Array.from(parentTd.classList || []) : [];
  const allClasses = [...classList, ...parentClasses];

  for (const cls of allClasses) {
    if (cls.startsWith('x-grid3-hd-') || cls.startsWith('x-grid3-td-')) {
      const fieldName = cls.replace('x-grid3-hd-', '').replace('x-grid3-td-', '');
      if (fieldName && fieldName !== 'inner' && fieldName !== 'cell') {
        return {
          type: 'class',
          selector: `.x-grid3-td-${fieldName}`
        };
      }
    }
  }

  const cellEl = parentTd || headerEl.closest('th, td');
  if (cellEl && cellEl.parentElement) {
    const siblings = Array.from(cellEl.parentElement.children);
    const index = siblings.indexOf(cellEl);
    if (index !== -1) {
      return {
        type: 'index',
        index: index
      };
    }
  }

  return null;
}

function extractCellValue(row, headerInfo) {
  if (!headerInfo) return '';

  let cellEl = null;
  if (headerInfo.type === 'class' && headerInfo.selector) {
    cellEl = row.querySelector(headerInfo.selector);
  } else if (headerInfo.type === 'index' && typeof headerInfo.index === 'number') {
    const cells = row.querySelectorAll('td, th');
    cellEl = cells[headerInfo.index] || row.children[headerInfo.index];
  }

  if (!cellEl) return '';
  return (cellEl.innerText || cellEl.textContent || '').replace(/\s+/g, ' ').trim();
}
