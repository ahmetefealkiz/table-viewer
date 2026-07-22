function getRandomInterval(baseMinutes = 4) {
  const baseSec = (parseInt(baseMinutes, 10) || 4) * 60;
  // baseSec + random 0 to 120 seconds (0 to 2 minutes)
  return baseSec + Math.floor(Math.random() * 121);
}

let trackingTimer = null;
let trackingState = {
  isRunning: false,
  intervalSeconds: getRandomInterval(4),
  secondsLeft: 240,
  lastData: [],
  lastUpdatedTime: null,
  error: null
};

// Load initial state from storage if present
chrome.storage.local.get(['bankBotTrackingState'], (result) => {
  if (result.bankBotTrackingState) {
    trackingState = { ...trackingState, ...result.bankBotTrackingState };
    // If it was running and this tab is the designated tracking instance, resume tracking
    if (trackingState.isRunning && sessionStorage.getItem('isBankBotTracking') === 'true') {
      startTrackingEngine();
    } else if (!trackingState.isRunning) {
      stopTrackingEngine();
    }
  }
});

// Synchronize state changes across tabs
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.bankBotTrackingState) {
    const newState = changes.bankBotTrackingState.newValue;
    if (newState) {
      trackingState = { ...trackingState, ...newState };
      if (trackingState.isRunning) {
        if (sessionStorage.getItem('isBankBotTracking') === 'true') {
          startTrackingEngine();
        }
      } else {
        stopTrackingEngine();
      }
    }
  }
});

// Listen for messages from Popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'GET_STATE':
      sendResponse({ success: true, state: trackingState });
      break;

    case 'CLEAR_DATA':
      trackingState.lastData = [];
      trackingState.lastUpdatedTime = null;
      trackingState.error = null;
      saveState();
      sendResponse({ success: true, state: trackingState });
      break;

    case 'START_TRACKING':
      getSettings((settings) => {
        const interval = getRandomInterval(settings.baseMinutes);
        trackingState.intervalSeconds = interval;
        trackingState.secondsLeft = interval;
        trackingState.isRunning = true;
        trackingState.error = null;

        // Mark this tab as the active tracking instance
        sessionStorage.setItem('isBankBotTracking', 'true');
        
        // Perform initial immediate scan
        runDataScan(settings);
        startTrackingEngine();
        saveState();

        sendResponse({ success: true, state: trackingState });
      });
      return true; // async response

    case 'STOP_TRACKING':
      // Clear tracking mark
      sessionStorage.removeItem('isBankBotTracking');
      stopTrackingEngine();
      saveState();
      sendResponse({ success: true, state: trackingState });
      break;

    case 'FORCE_READ':
      getSettings((settings) => {
        trackingState.error = null;

        // Reset countdown timer
        trackingState.secondsLeft = getRandomInterval(settings.baseMinutes);

        // Trigger refresh icon click if available
        const refreshBtn = document.querySelector('.x-tool-refresh');
        if (refreshBtn) {
          try { refreshBtn.click(); } catch (e) {}
        }

        // Run immediate scan and wait for completion before responding to popup
        runDataScan(settings, () => {
          sendResponse({ success: true, state: trackingState });
        });
      });
      return true; // Keep async channel open

    default:
      sendResponse({ success: false, error: 'Bilinmeyen işlem' });
  }
  return true;
});

function getSettings(callback) {
  const DEFAULT_SETTINGS = {
    targetUrl: '',
    baseMinutes: 4,
    waitSeconds: 15,
    fallbackCurrency: '',
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
  stopTrackingEngine();
  
  // Only start interval if this tab instance is marked for tracking
  if (sessionStorage.getItem('isBankBotTracking') !== 'true') {
    return;
  }

  trackingState.isRunning = true;

  trackingTimer = setInterval(() => {
    if (!trackingState.isRunning) {
      stopTrackingEngine();
      return;
    }

    trackingState.secondsLeft--;

    if (trackingState.secondsLeft <= 0) {
      getSettings((settings) => {
        if (!trackingState.isRunning) return;

        // 1. Click refresh icon .x-tool-refresh
        const refreshBtn = document.querySelector('.x-tool-refresh');
        if (refreshBtn) {
          try { refreshBtn.click(); } catch (e) {}
        }

        // 2. Wait specified seconds (default 15s) for data to reload
        const waitSec = parseInt(settings.waitSeconds, 10) || 15;

        setTimeout(() => {
          if (!trackingState.isRunning) return;
          runDataScan(settings);

          // 3. Reset timer to baseMinutes + random 0-2 minutes interval
          const newInterval = getRandomInterval(settings.baseMinutes);
          trackingState.intervalSeconds = newInterval;
          trackingState.secondsLeft = newInterval;
          saveState();
        }, waitSec * 1000);
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

function runDataScan(settings, onComplete) {
  const finish = () => {
    saveState();
    if (typeof onComplete === 'function') {
      onComplete();
    }
  };

  const currentUrl = window.location.href.toLowerCase();
  const targetUrl = (settings.targetUrl || '').trim().toLowerCase();

  // URL Containment Check
  if (targetUrl && !currentUrl.includes(targetUrl)) {
    trackingState.error = `Mevcut URL ("${window.location.href}"), hedef URL'yi ("${settings.targetUrl}") kapsamıyor.`;
    finish();
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
    trackingState.error = `Tablo içerisinde belirtilen başlıkların hiçbiri bulunamadı.`;
    finish();
    return;
  }

  let rowElements = [];
  try {
    const tableContext = headerMap.tableContainer || document;
    const rows = tableContext.querySelectorAll('.x-grid3-row');
    if (rows && rows.length > 0) {
      rows.forEach(r => {
        if (r.closest('table') || r.querySelector('table')) {
          rowElements.push(r);
        }
      });
    } else {
      const trs = tableContext.querySelectorAll('tbody tr, tr:not(:first-child)');
      if (trs && trs.length > 0) {
        rowElements.push(...Array.from(trs));
      }
    }
  } catch (e) {}

  if (!rowElements || rowElements.length === 0) {
    trackingState.error = 'Tablo başlıkları bulundu fakat tablo veri satırları (rows) bulunamadı.';
    finish();
    return;
  }

  // Extract Currency from Account Information modal (OD_CCY_CODE)
  let currencyVal = '';
  try {
    const ccyEl = document.querySelector('textarea[name="OD_CCY_CODE"], input[name="OD_CCY_CODE"], [name="OD_CCY_CODE"]');
    if (ccyEl) {
      currencyVal = (ccyEl.value || ccyEl.innerText || ccyEl.textContent || '').trim();
    }
  } catch (e) {}

  // Fallback to manual currency setting if not found on page
  if (!currencyVal && settings.fallbackCurrency) {
    currencyVal = settings.fallbackCurrency.trim();
  }

  const dataList = [];
  rowElements.forEach((row) => {
    const dateText = extractCellValue(row, headerMap.date);
    const narrationText = extractCellValue(row, headerMap.narration);
    const refText = extractCellValue(row, headerMap.ref);
    const creditText = extractCellValue(row, headerMap.credit);

    if (dateText || narrationText || refText || creditText) {
      dataList.push({
        currency: currencyVal,
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

  // Trigger Google Sheet Sync if data found
  if (dataList.length > 0) {
    chrome.runtime.sendMessage({ action: 'SYNC_TO_SHEET', dataList }, (response) => {
      if (!chrome.runtime.lastError && response) {
        if (!response.success && response.error) {
          trackingState.error = response.error;
        } else if (response.success && response.addedCount > 0) {
          trackingState.lastSyncMessage = response.message;
        }
      }
      finish();
    });
  } else {
    finish();
  }
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

  try {
    const candidateElements = document.querySelectorAll('th, td.x-grid3-hd, div.x-grid3-hd-inner, td, div');

    candidateElements.forEach((el) => {
      // Must be nested inside a <table> element
      const closestTable = el.closest('table');
      if (!closestTable) return;

      const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) return;

      for (const key of ['date', 'narration', 'ref', 'credit']) {
        if (!result[key] && isTextMatch(text, targetHeaders[key])) {
          result[key] = analyzeHeaderElement(el);
          if (!result.tableContainer) {
            result.tableContainer = el.closest('.x-grid3') || el.closest('.x-panel') || closestTable;
          }
        }
      }
    });
  } catch (e) {}

  return result;
}

function isTextMatch(elementText, targetText) {
  if (!elementText || !targetText) return false;
  const cleanElement = elementText.toLowerCase().trim();
  const cleanTarget = targetText.toLowerCase().trim();
  return cleanElement === cleanTarget;
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
