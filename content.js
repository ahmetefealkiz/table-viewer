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
  currentPhase: 'IDLE', // 'IDLE', 'REFRESH_LIST', 'OPEN_ACCOUNT', 'CONFIGURE_ACCOUNT', 'READ_DATA', 'CLOSE_ACCOUNT'
  currentAccountIndex: 0, // 0, 1, 2
  lastData: [],
  lastUpdatedTime: null,
  error: null
};

// Load initial state from storage if present
chrome.storage.local.get(['bankBotTrackingState'], (result) => {
  if (result.bankBotTrackingState) {
    trackingState = { ...trackingState, ...result.bankBotTrackingState };
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
        trackingState.secondsLeft = 0; // Trigger process immediately
        trackingState.currentPhase = 'IDLE';
        trackingState.currentAccountIndex = 0;
        trackingState.isRunning = true;
        trackingState.error = null;

        sessionStorage.setItem('isBankBotTracking', 'true');
        startTrackingEngine();
        saveState();

        sendResponse({ success: true, state: trackingState });
      });
      return true;

    case 'STOP_TRACKING':
      sessionStorage.removeItem('isBankBotTracking');
      stopTrackingEngine();
      trackingState.currentPhase = 'IDLE';
      trackingState.currentAccountIndex = 0;
      saveState();
      sendResponse({ success: true, state: trackingState });
      break;

    case 'FORCE_READ':
      getSettings((settings) => {
        trackingState.error = null;
        runDataScan(settings, () => {
          sendResponse({ success: true, state: trackingState });
        });
      });
      return true;

    default:
      sendResponse({ success: false, error: 'Bilinmeyen işlem' });
  }
  return true;
});

const TARGET_ACCOUNTS = [
  '0514575556901',
  '0514575556902',
  '0514575556903',
  '1015865992701',
  '1025865992702',
  '1025865992703',
  '1025865992704'
];

// Single click on element at a random coordinate inside element bounds
function clickElementRandom(element) {
  if (!element) return;
  try {
    // 1. Invoke native click to ensure standard browser event listeners and actions trigger
    element.click();

    // 2. Dispatch MouseEvent with random coordinates inside element
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const offsetX = Math.floor(Math.random() * Math.max(rect.width * 0.6, 5)) + 2;
      const offsetY = Math.floor(Math.random() * Math.max(rect.height * 0.6, 5)) + 2;
      const clientX = rect.left + offsetX;
      const clientY = rect.top + offsetY;

      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window,
        detail: 1,
        clientX: clientX,
        clientY: clientY
      });
      element.dispatchEvent(clickEvent);
    }
  } catch (e) {
    try { element.click(); } catch (err) {}
  }
}

// Double click on element at a random coordinate inside element bounds
function doubleClickElementRandom(element) {
  if (!element) return;
  try {
    element.click();

    const rect = element.getBoundingClientRect();
    const offsetX = Math.floor(Math.random() * Math.max(rect.width * 0.6, 5)) + 2;
    const offsetY = Math.floor(Math.random() * Math.max(rect.height * 0.6, 5)) + 2;
    const clientX = rect.left + offsetX;
    const clientY = rect.top + offsetY;

    const dblClickEvent = new MouseEvent('dblclick', {
      bubbles: true,
      cancelable: true,
      view: window,
      detail: 2,
      clientX: clientX,
      clientY: clientY
    });
    element.dispatchEvent(dblClickEvent);
  } catch (e) {
    try { element.click(); } catch (err) {}
  }
}

// Find element by text content or input value (exact or partial match, case sensitivity option)
function findElementByText(text, container = document, exact = false, caseSensitive = false) {
  if (!text) return null;
  const searchText = caseSensitive ? text.trim() : text.toLowerCase().trim();
  const allElements = container.querySelectorAll('*');
  let bestMatch = null;
  
  for (const el of allElements) {
    // Check input value, innerText, textContent or value attribute
    const rawVal = (el.value || el.innerText || el.textContent || el.getAttribute('value') || '').trim();
    const val = caseSensitive ? rawVal : rawVal.toLowerCase();
    const isMatch = exact ? (val === searchText) : val.includes(searchText);
    if (isMatch) {
      bestMatch = el;
      // Prefer inputs, buttons, list items, or leaf elements
      if (el.tagName === 'INPUT' || el.tagName === 'BUTTON' || el.classList.contains('x-btn-text') || el.classList.contains('x-btn') || el.classList.contains('x-combo-list-item') || el.classList.contains('filter-btn') || el.children.length === 0) {
        break;
      }
    }
  }
  return bestMatch;
}

// 1. Account summary list refresh (Class name based - first refresh button)
function clickListRefresh() {
  try {
    const refreshBtns = document.querySelectorAll('.x-tool-refresh');
    if (refreshBtns && refreshBtns.length > 0) {
      clickElementRandom(refreshBtns[0]);
    }
  } catch (e) {}
}

// Double click account by text number. Returns true if account element found and clicked, false otherwise.
function openAccountByNumber(accountNumber) {
  try {
    const targetEl = findElementByText(accountNumber);
    if (targetEl) {
      doubleClickElementRandom(targetEl);
      return true;
    }
  } catch (e) {}
  return false;
}

// Click Current Day filter by text
function clickCurrentDayFilter() {
  try {
    let el = findElementByText('current day') || findElementByText('bugün');
    if (el) {
      const trigger = el.parentElement ? el.parentElement.querySelector('.x-form-arrow-trigger') : null;
      if (trigger) {
        clickElementRandom(trigger);
      }
      clickElementRandom(el);
    } else {
      const combos = document.querySelectorAll('.x-window .x-form-arrow-trigger, .x-form-arrow-trigger, .x-form-combo, input.x-trigger-noedit');
      if (combos.length > 0) {
        clickElementRandom(combos[combos.length - 1]);
      }
    }
  } catch (e) {}
}

// Click Last 7 Days dropdown option by text
function clickLast7DaysOption() {
  try {
    let el = findElementByText('last 7') || findElementByText('7 day') || findElementByText('7 gün') || findElementByText('son 7');
    if (el) {
      clickElementRandom(el);
    } else {
      const items = document.querySelectorAll('.x-combo-list-item, div, li, td, span');
      for (const item of items) {
        const txt = (item.innerText || item.textContent || '').toLowerCase().trim();
        if (txt.includes('last 7') || txt.includes('7 day') || txt.includes('7 gün') || txt.includes('son 7')) {
          clickElementRandom(item);
          break;
        }
      }
    }
  } catch (e) {}
}

// Click Go button by text (Strict case-sensitive exact match for "Go")
function clickGoButton() {
  try {
    // Search inside open window / modal first, then overall document
    const windows = document.querySelectorAll('.x-window:not([style*="display: none"]), .x-window');
    const containers = windows.length > 0 ? [...Array.from(windows), document] : [document];

    let targetBtn = null;

    for (const container of containers) {
      // 1. Direct search for buttons, inputs, ExtJS button elements whose text is EXACTLY "Go" (case sensitive)
      const candidates = container.querySelectorAll('button, input[type="button"], input[type="submit"], .x-btn-text, .x-btn, .go-btn');
      for (const btn of candidates) {
        const txt = (btn.value || btn.innerText || btn.textContent || '').trim();
        if (txt === 'Go') {
          targetBtn = btn;
          break;
        }
      }
      if (targetBtn) break;

      // 2. Fallback: Case-sensitive exact text match across elements in container
      targetBtn = findElementByText('Go', container, true, true);
      if (targetBtn) break;
    }

    if (targetBtn) {
      clickElementRandom(targetBtn);
    }
  } catch (e) {}
}

// Account page refresh (Class name based - second refresh button)
function clickAccountRefresh() {
  try {
    const refreshBtns = document.querySelectorAll('.x-tool-refresh');
    if (refreshBtns && refreshBtns.length > 0) {
      const targetBtn = refreshBtns.length >= 2 ? refreshBtns[1] : refreshBtns[0];
      clickElementRandom(targetBtn);
    }
  } catch (e) {}
}

// Close account modal (Class name based - 2nd close button)
function closeAccountModal() {
  try {
    const closeBtns = document.querySelectorAll('.x-tool-close');
    if (closeBtns.length > 0) {
      const targetBtn = closeBtns.length >= 2 ? closeBtns[1] : closeBtns[0];
      clickElementRandom(targetBtn);
    }
  } catch (e) {}
}

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

function processNextPhase(settings) {
  switch (trackingState.currentPhase) {
    case 'IDLE':
      trackingState.currentAccountIndex = 0;
      trackingState.currentPhase = 'REFRESH_LIST';
      trackingState.secondsLeft = 0;
      break;

    case 'REFRESH_LIST':
      // Step 1: Click first refresh button (Class based)
      clickListRefresh();
      trackingState.currentPhase = 'OPEN_ACCOUNT';
      trackingState.secondsLeft = 1; // 1 second sleep
      break;

    case 'OPEN_ACCOUNT':
      // Step 2: Double click account number by text if found on page
      const accNumber = TARGET_ACCOUNTS[trackingState.currentAccountIndex];
      const isOpened = openAccountByNumber(accNumber);

      if (isOpened) {
        // Account found -> proceed with modal operations
        trackingState.currentPhase = 'CLICK_FILTER';
        trackingState.secondsLeft = 5; // Wait 5s for modal to open
      } else {
        // Account not found -> skip silently to next account in list
        trackingState.currentAccountIndex++;
        if (trackingState.currentAccountIndex < TARGET_ACCOUNTS.length) {
          trackingState.currentPhase = 'OPEN_ACCOUNT';
          trackingState.secondsLeft = 0; // Check next account immediately
        } else {
          // Finished checking all 7 accounts in list -> reset to IDLE and wait for next interval
          trackingState.currentAccountIndex = 0;
          trackingState.currentPhase = 'IDLE';
          const newInterval = getRandomInterval(settings.baseMinutes);
          trackingState.intervalSeconds = newInterval;
          trackingState.secondsLeft = newInterval;
        }
      }
      break;

    case 'CLICK_FILTER':
      // Step 3: Click 'Current Day' text filter
      clickCurrentDayFilter();
      trackingState.currentPhase = 'CLICK_DROPDOWN';
      trackingState.secondsLeft = 1; // 1 second sleep
      break;

    case 'CLICK_DROPDOWN':
      // Step 4: Click 'Last 7 Days' option from dropdown by text
      clickLast7DaysOption();
      trackingState.currentPhase = 'CLICK_GO';
      trackingState.secondsLeft = 1; // 1 second sleep
      break;

    case 'CLICK_GO':
      // Step 5: Click 'Go' button by text
      clickGoButton();
      trackingState.currentPhase = 'REFRESH_ACCOUNT';
      trackingState.secondsLeft = 1; // 1 second sleep
      break;

    case 'REFRESH_ACCOUNT':
      // Step 6: Click second refresh button on account page (Class based)
      clickAccountRefresh();
      trackingState.currentPhase = 'READ_DATA';
      const waitSec = parseInt(settings.waitSeconds, 10) || 15;
      trackingState.secondsLeft = waitSec; // Wait for data load
      break;

    case 'READ_DATA':
      // Step 7: Read data and sync to sheet
      runDataScan(settings);
      trackingState.currentPhase = 'CLOSE_ACCOUNT';
      trackingState.secondsLeft = 1; // 1 second sleep
      break;

    case 'CLOSE_ACCOUNT':
      // Step 8: Click close icon (Class based)
      closeAccountModal();
      trackingState.currentAccountIndex++;
      
      if (trackingState.currentAccountIndex < TARGET_ACCOUNTS.length) {
        // Move to next account in list
        trackingState.currentPhase = 'OPEN_ACCOUNT';
        trackingState.secondsLeft = 1; // 1 second sleep
      } else {
        // Finished all 7 accounts in list -> reset to IDLE and set random timer
        trackingState.currentAccountIndex = 0;
        trackingState.currentPhase = 'IDLE';
        const newInterval = getRandomInterval(settings.baseMinutes);
        trackingState.intervalSeconds = newInterval;
        trackingState.secondsLeft = newInterval;
      }
      break;

    default:
      trackingState.currentPhase = 'IDLE';
      trackingState.secondsLeft = getRandomInterval(settings.baseMinutes);
      break;
  }
  saveState();
}

function startTrackingEngine() {
  stopTrackingEngine();
  
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
        processNextPhase(settings);
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
