// Background Service Worker for Google OAuth and Sheets Integration

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'GOOGLE_LOGIN':
      handleGoogleLogin(sendResponse);
      return true; // Keep async channel open

    case 'GOOGLE_LOGOUT':
      handleGoogleLogout(sendResponse);
      return true;

    case 'FETCH_SPREADSHEETS':
      fetchSpreadsheets(sendResponse);
      return true;

    case 'FETCH_WORKSHEETS':
      fetchWorksheets(request.spreadsheetId, sendResponse);
      return true;

    case 'VALIDATE_AND_CONNECT_SHEET':
      validateAndConnectSheet(request.spreadsheetId, request.spreadsheetName, request.transactionSheet, request.errorSheet, request.activitySheet, sendResponse);
      return true;

    case 'DISCONNECT_SHEET':
      disconnectSheet(sendResponse);
      return true;

    case 'GET_GOOGLE_STATUS':
      getGoogleStatus(sendResponse);
      return true;

    case 'SYNC_TO_SHEET':
      syncDataToSheet(request.dataList, sendResponse);
      return true;

    case 'LOG_ERROR_TO_SHEET':
      logErrorToSheet(request.errorCode, request.errorMessage, sendResponse);
      return true;

    case 'LOG_ACTIVITY_TO_SHEET':
      logActivityToSheet(request.accountType, request.activity, sendResponse);
      return true;
  }
});

/**
 * Get Google Auth Token (Interactive)
 */
function handleGoogleLogin(sendResponse) {
  chrome.identity.getAuthToken({ interactive: true }, async (token) => {
    if (chrome.runtime.lastError || !token) {
      const errorMsg = chrome.runtime.lastError ? chrome.runtime.lastError.message : 'Giriş yapılamadı.';
      sendResponse({ success: false, error: errorMsg });
      return;
    }

    try {
      const userInfo = await fetchUserInfo(token);
      const authData = {
        isLoggedIn: true,
        token: token,
        userEmail: userInfo.email || 'Bilinmeyen Kullanıcı',
        userPicture: userInfo.picture || null
      };

      await chrome.storage.local.set({ bankBotGoogleAuth: authData });
      sendResponse({ success: true, authData });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  });
}

/**
 * Revoke and Logout
 */
function handleGoogleLogout(sendResponse) {
  chrome.storage.local.get(['bankBotGoogleAuth'], (result) => {
    const token = result.bankBotGoogleAuth?.token;
    
    const clearStorage = async () => {
      await chrome.storage.local.remove(['bankBotGoogleAuth', 'bankBotSelectedSheet']);
      sendResponse({ success: true });
    };

    if (token) {
      chrome.identity.removeCachedAuthToken({ token }, () => {
        // Optionally revoke token online
        fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`)
          .catch(() => {})
          .finally(clearStorage);
      });
    } else {
      clearStorage();
    }
  });
}

/**
 * Fetch User Info (Email/Profile)
 */
async function fetchUserInfo(token) {
  const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    throw new Error('Kullanıcı bilgisi alınamadı.');
  }
  return await response.json();
}

/**
 * Fetch List of Spreadsheets from Google Drive API
 */
function fetchSpreadsheets(sendResponse) {
  getToken((token, err) => {
    if (err || !token) {
      sendResponse({ success: false, error: err || 'Oturum açık değil.' });
      return;
    }

    const query = encodeURIComponent("mimeType='application/vnd.google-apps.spreadsheet' and trashed=false");
    const url = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)&pageSize=100&orderBy=name`;

    fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => {
        if (res.status === 401) {
          throw new Error('Oturum süresi doldu. Lütfen tekrar giriş yapın.');
        }
        if (!res.ok) {
          throw new Error(`Drive API Hatası: ${res.statusText}`);
        }
        return res.json();
      })
      .then(data => {
        sendResponse({ success: true, files: data.files || [] });
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });
  });
}

/**
 * Fetch Worksheets (Tabs) inside a specific Spreadsheet
 */
function fetchWorksheets(spreadsheetId, sendResponse) {
  if (!spreadsheetId) {
    sendResponse({ success: false, error: 'Geçersiz tablo ID.' });
    return;
  }

  getToken((token, err) => {
    if (err || !token) {
      sendResponse({ success: false, error: err || 'Oturum açık değil.' });
      return;
    }

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?includeGridData=false`;

    fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(async res => {
        if (res.status === 401) throw new Error('Oturum süresi doldu. Lütfen tekrar giriş yapın.');
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          const apiMsg = errData.error ? errData.error.message : res.statusText;
          throw new Error(`Sheets API Hatası (${res.status}): ${apiMsg}`);
        }
        return res.json();
      })
      .then(data => {
        const sheets = (data.sheets || []).map(s => s.properties && s.properties.title).filter(Boolean);
        if (sheets.length === 0) {
          throw new Error('E-Tablo içerisinde hiçbir sekme (sayfa) bulunamadı.');
        }
        sendResponse({ success: true, sheets });
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });
  });
}

/**
 * Validate Columns in Selected Transaction and Error Worksheets
 */
/**
 * Validate Columns in Selected Transaction, Error and Activity Worksheets
 */
function validateAndConnectSheet(spreadsheetId, spreadsheetName, transactionSheet, errorSheet, activitySheet, sendResponse) {
  if (!spreadsheetId || !transactionSheet || !errorSheet || !activitySheet) {
    sendResponse({ success: false, error: 'Lütfen Transaction, Error Log ve Activity Log sayfalarının (sekmelerinin) tümünü seçin.' });
    return;
  }

  getToken((token, err) => {
    if (err || !token) {
      sendResponse({ success: false, error: err || 'Oturum açık değil.' });
      return;
    }

    // 1. Validate Transaction Sheet Headers
    const transUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/'${encodeURIComponent(transactionSheet)}'!1:1`;

    fetch(transUrl, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => {
        if (res.status === 401) throw new Error('Oturum süresi doldu. Lütfen tekrar giriş yapın.');
        if (!res.ok) throw new Error(`Transaction sekmesi okunamadı: ${res.statusText}`);
        return res.json();
      })
      .then(transData => {
        const transRows = transData.values;
        if (!transRows || transRows.length === 0 || !transRows[0]) {
          throw new Error(`'${transactionSheet}' sekmesinin ilk satırında başlık bulunamadı.`);
        }
        const transHeaders = transRows[0].map(h => (h || '').toString().trim().toLowerCase());
        const REQUIRED_TRANS = ['timestamp', 'currency', 'date', 'narration', 'reference', 'credit'];
        const missingTrans = REQUIRED_TRANS.filter(req => !transHeaders.includes(req));

        if (missingTrans.length > 0) {
          const capMissing = missingTrans.map(m => m === 'timestamp' ? 'TIMESTAMP' : m.charAt(0).toUpperCase() + m.slice(1));
          throw new Error(`Transaction sekmesinde ('${transactionSheet}') zorunlu kolon(lar) bulunamadı: ${capMissing.join(', ')}.\nLütfen ilk satıra TIMESTAMP, Currency, Date, Narration, Reference ve Credit başlıklarını ekleyin.`);
        }

        // 2. Validate Error Sheet Headers
        const errorUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/'${encodeURIComponent(errorSheet)}'!1:1`;
        return fetch(errorUrl, { headers: { Authorization: `Bearer ${token}` } });
      })
      .then(res => {
        if (res.status === 401) throw new Error('Oturum süresi doldu. Lütfen tekrar giriş yapın.');
        if (!res.ok) throw new Error(`Error Log sekmesi okunamadı: ${res.statusText}`);
        return res.json();
      })
      .then(errData => {
        const errRows = errData.values;
        if (!errRows || errRows.length === 0 || !errRows[0]) {
          throw new Error(`'${errorSheet}' sekmesinin ilk satırında başlık bulunamadı.`);
        }
        const errHeaders = errRows[0].map(h => (h || '').toString().trim().toLowerCase().replace(/[\s_]+/g, '_'));
        const missingErr = [];

        if (!errHeaders.includes('timestamp')) missingErr.push('TIMESTAMP');
        if (!errHeaders.includes('error_code')) missingErr.push('ERROR_CODE');
        if (!errHeaders.includes('error_details') && !errHeaders.includes('error_detail')) missingErr.push('ERROR_DETAILS');

        if (missingErr.length > 0) {
          throw new Error(`Error Log sekmesinde ('${errorSheet}') zorunlu kolon(lar) bulunamadı: ${missingErr.join(', ')}.\nLütfen ilk satıra TIMESTAMP, ERROR_CODE ve ERROR_DETAILS başlıklarını ekleyin.`);
        }

        // 3. Validate Activity Sheet Headers
        const activityUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/'${encodeURIComponent(activitySheet)}'!1:1`;
        return fetch(activityUrl, { headers: { Authorization: `Bearer ${token}` } });
      })
      .then(res => {
        if (res.status === 401) throw new Error('Oturum süresi doldu. Lütfen tekrar giriş yapın.');
        if (!res.ok) throw new Error(`Activity Log sekmesi okunamadı: ${res.statusText}`);
        return res.json();
      })
      .then(async actData => {
        const actRows = actData.values;
        if (!actRows || actRows.length === 0 || !actRows[0]) {
          throw new Error(`'${activitySheet}' sekmesinin ilk satırında başlık bulunamadı.`);
        }
        const actHeaders = actRows[0].map(h => (h || '').toString().trim().toLowerCase().replace(/[\s_]+/g, '_'));
        const missingAct = [];

        if (!actHeaders.includes('timestamp')) missingAct.push('TIMESTAMP');
        if (!actHeaders.includes('account_type')) missingAct.push('ACCOUNT_TYPE');
        if (!actHeaders.includes('activity')) missingAct.push('ACTIVITY');

        if (missingAct.length > 0) {
          throw new Error(`Activity Log sekmesinde ('${activitySheet}') zorunlu kolon(lar) bulunamadı: ${missingAct.join(', ')}.\nLütfen ilk satıra TIMESTAMP, ACCOUNT_TYPE ve ACTIVITY başlıklarını ekleyin.`);
        }

        // Save selected sheet details
        const selectedSheetData = {
          id: spreadsheetId,
          name: spreadsheetName,
          transactionSheet: transactionSheet,
          errorSheet: errorSheet,
          activitySheet: activitySheet,
          connectedAt: new Date().toLocaleString()
        };

        await chrome.storage.local.set({ bankBotSelectedSheet: selectedSheetData });
        sendResponse({ success: true, sheet: selectedSheetData });
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });
  });
}

/**
 * Disconnect current sheet
 */
function disconnectSheet(sendResponse) {
  chrome.storage.local.remove(['bankBotSelectedSheet'], () => {
    sendResponse({ success: true });
  });
}

/**
 * Get current Google login and connected sheet status
 */
function getGoogleStatus(sendResponse) {
  chrome.storage.local.get(['bankBotGoogleAuth', 'bankBotSelectedSheet'], (result) => {
    sendResponse({
      auth: result.bankBotGoogleAuth || null,
      sheet: result.bankBotSelectedSheet || null
    });
  });
}

function getToken(callback) {
  chrome.identity.getAuthToken({ interactive: false }, (token) => {
    if (token) {
      callback(token, null);
      return;
    }

    // Fallback: check storage for saved token
    chrome.storage.local.get(['bankBotGoogleAuth'], (result) => {
      const storedToken = result.bankBotGoogleAuth?.token;
      if (storedToken) {
        callback(storedToken, null);
      } else {
        callback(null, 'Oturum açık değil. Lütfen Google ile Giriş Yap butonuna basın.');
      }
    });
  });
}

/**
 * Helper to get formatted timestamp string (DD.MM.YYYY HH:mm:ss) right before writing to Sheet
 */
function getFormattedTimestamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${day}.${month}.${year} ${hours}:${minutes}:${seconds}`;
}

/**
 * Sync scraped data to connected Google Sheet
 */
function syncDataToSheet(dataList, sendResponse) {
  if (!dataList || dataList.length === 0) {
    sendResponse({ success: true, message: 'Yazılacak veri bulunamadı.', addedCount: 0 });
    return;
  }

  chrome.storage.local.get(['bankBotSelectedSheet'], (result) => {
    const sheetData = result.bankBotSelectedSheet;
    if (!sheetData || !sheetData.id) {
      sendResponse({ success: false, error: 'Bağlı bir Google E-Tablo bulunamadı. Lütfen Ayarlardan tabloyu bağlayın.' });
      return;
    }

    getToken((token, err) => {
      if (err || !token) {
        sendResponse({ success: false, error: err || 'Oturum açık değil.' });
        return;
      }

      const spreadsheetId = sheetData.id;
      const transSheet = sheetData.transactionSheet || 'Sheet1';

      // 1. Fetch current values from Google Sheet
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/'${encodeURIComponent(transSheet)}'!1:100000`;

      fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(res => {
          if (res.status === 401) throw new Error('Oturum süresi doldu. Lütfen tekrar giriş yapın.');
          if (!res.ok) throw new Error(`Sheets API GET Hatası: ${res.statusText}`);
          return res.json();
        })
        .then(async responseData => {
          const values = responseData.values || [];

          if (values.length === 0) {
            throw new Error('E-Tablo tamamen boş. Lütfen ilk satıra kolon başlıklarını (TIMESTAMP, Currency, Date, Narration, Reference, Credit) ekleyin.');
          }

          // Header row is index 0
          const headerRow = values[0].map(h => (h || '').toString().trim().toLowerCase());

          const timestampIdx = headerRow.indexOf('timestamp');
          const currencyIdx = headerRow.indexOf('currency');
          const dateIdx = headerRow.indexOf('date');
          const narrationIdx = headerRow.indexOf('narration');
          const refIdx = headerRow.indexOf('reference');
          const creditIdx = headerRow.indexOf('credit');

          if (timestampIdx === -1 || currencyIdx === -1 || dateIdx === -1 || narrationIdx === -1 || refIdx === -1 || creditIdx === -1) {
            throw new Error('Seçilen E-Tabloda zorunlu kolon başlıklarından (TIMESTAMP, Currency, Date, Narration, Reference, Credit) biri eksik.');
          }

          let itemsToWrite = [];

          // Find data rows (excluding header)
          const dataRows = values.slice(1).filter(row => row.some(cell => cell && cell.toString().trim() !== ''));

          // Get the current currency being synced from dataList
          const currentCurrency = (dataList[0]?.currency || '').toString().trim().toLowerCase();
          const normStr = (val) => (val || '').toString().replace(/[\s\u00a0]+/g, ' ').trim().toLowerCase();

          // 1. Filter rows in E-Tablo that match the selected currency
          const sameCurrencyRows = dataRows.filter(row => normStr(row[currencyIdx]) === currentCurrency);

          if (sameCurrencyRows.length === 0) {
            // 1.2. No rows with the selected currency exist in E-Tablo yet! Append ALL items without matching
            itemsToWrite = [...dataList].reverse();
          } else {
            // 1.1. Rows with the selected currency exist in E-Tablo!
            // Get the LAST recorded transaction for this specific currency (TIMESTAMP is ignored in matching)
            const lastRecordedRow = sameCurrencyRows[sameCurrencyRows.length - 1];
            
            const lastRecordedObj = {
              currency: lastRecordedRow[currencyIdx],
              date: lastRecordedRow[dateIdx],
              narration: lastRecordedRow[narrationIdx],
              ref: lastRecordedRow[refIdx],
              credit: lastRecordedRow[creditIdx]
            };

            // Search for lastRecordedObj starting from index 0 in scraped dataList
            let matchIndex = -1;
            for (let i = 0; i < dataList.length; i++) {
              if (isRowMatch(dataList[i], lastRecordedObj)) {
                matchIndex = i;
                break;
              }
            }

            if (matchIndex === -1) {
              // 1.1.1. Last saved transaction for this currency was NOT found in read data
              const currencyName = (dataList[0]?.currency || '').toUpperCase();
              sendResponse({
                success: false,
                errorCode: 'ERR_DAT_002',
                error: `E-Tablodaki ${currencyName ? currencyName + ' para birimine ait ' : ''}son kaydedilmiş işlem web sayfasında bulunamadı. Lütfen web sayfasındaki listeleme filtresini 'son 7 gün'den 'son 1 ay'a (veya daha geniş bir aralığa) güncelleyip tekrar okutun.`
              });
              return;
            }

            // Items newer than matchIndex are dataList.slice(0, matchIndex)
            // Reverse them to maintain chronological order (oldest -> newest) when appending
            itemsToWrite = dataList.slice(0, matchIndex).reverse();
          }

          if (itemsToWrite.length === 0) {
            sendResponse({ success: true, addedCount: 0, message: 'Tüm işlemler E-Tablo ile güncel, yeni eklenecek işlem yok.' });
            return;
          }

          // Take timestamp right before saving to Google Sheets
          const currentTimestamp = getFormattedTimestamp();

          // Format itemsToWrite into 2D row arrays matching the Sheet column order
          const formattedRows = itemsToWrite.map(item => {
            item.timestamp = currentTimestamp;
            const row = new Array(headerRow.length).fill('');
            if (timestampIdx !== -1) row[timestampIdx] = currentTimestamp;
            row[currencyIdx] = item.currency || '';
            row[dateIdx] = item.date || '';
            row[narrationIdx] = item.narration || '';
            row[refIdx] = item.ref || '';
            row[creditIdx] = item.credit || '';
            return row;
          });

          // 2. Append formattedRows to Google Sheet
          const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/'${encodeURIComponent(transSheet)}'!1:1:append?valueInputOption=USER_ENTERED`;

          const appendRes = await fetch(appendUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ values: formattedRows })
          });

          if (!appendRes.ok) {
            const errText = await appendRes.text();
            throw new Error(`Sheets API Append Hatası: ${appendRes.statusText}`);
          }

          sendResponse({
            success: true,
            addedCount: itemsToWrite.length,
            message: `${itemsToWrite.length} yeni işlem Google Sheet'e başarıyla yazıldı!`
          });
        })
        .catch(error => {
          sendResponse({ success: false, error: error.message });
        });
    });
  });
}

/**
 * Sync error details (Timestamp, Error Code, Error Details) to Error Log Worksheet
 */
function logErrorToSheet(errorCode, errorMessage, sendResponse) {
  if (!errorMessage) {
    if (sendResponse) sendResponse({ success: false, error: 'Hata mesajı boş.' });
    return;
  }

  const code = errorCode || 'ERR_SYS_000';

  chrome.storage.local.get(['bankBotSelectedSheet'], (result) => {
    const sheetData = result.bankBotSelectedSheet;
    if (!sheetData || !sheetData.id || !sheetData.errorSheet) {
      if (sendResponse) sendResponse({ success: false, error: 'Bağlı Error Log sekmesi bulunamadı.' });
      return;
    }

    getToken((token, err) => {
      if (err || !token) {
        if (sendResponse) sendResponse({ success: false, error: err || 'Oturum açık değil.' });
        return;
      }

      const spreadsheetId = sheetData.id;
      const errorSheet = sheetData.errorSheet;
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/'${encodeURIComponent(errorSheet)}'!1:100`;

      fetch(url, { headers: { Authorization: `Bearer ${token}` } })
        .then(res => res.json())
        .then(async data => {
          const values = data.values || [];
          let timestampIdx = 0;
          let errorCodeIdx = 1;
          let errorDetailsIdx = 2;
          let colCount = 3;

          if (values.length > 0 && values[0]) {
            const headerRow = values[0].map(h => (h || '').toString().trim().toLowerCase().replace(/[\s_]+/g, '_'));
            const tIdx = headerRow.indexOf('timestamp');
            const cIdx = headerRow.indexOf('error_code');
            const dIdx = headerRow.findIndex(h => h === 'error_details' || h === 'error_detail');

            if (tIdx !== -1) timestampIdx = tIdx;
            if (cIdx !== -1) errorCodeIdx = cIdx;
            if (dIdx !== -1) errorDetailsIdx = dIdx;
            colCount = Math.max(headerRow.length, 3);
          }

          const currentTimestamp = getFormattedTimestamp();
          const row = new Array(colCount).fill('');
          row[timestampIdx] = currentTimestamp;
          row[errorCodeIdx] = code;
          row[errorDetailsIdx] = errorMessage.toString();

          const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/'${encodeURIComponent(errorSheet)}'!1:1:append?valueInputOption=USER_ENTERED`;

          const appendRes = await fetch(appendUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ values: [row] })
          });

          if (!appendRes.ok) {
            throw new Error(`Error log kaydetme hatası: ${appendRes.statusText}`);
          }

          if (sendResponse) sendResponse({ success: true });
        })
        .catch(error => {
          if (sendResponse) sendResponse({ success: false, error: error.message });
        });
    });
  });
}

/**
 * Sync activity details (Timestamp, Account Type, Activity) to Activity Log Worksheet
 */
function logActivityToSheet(accountType, activity, sendResponse) {
  if (!activity) {
    if (sendResponse) sendResponse({ success: false, error: 'Aktivite açıklaması boş.' });
    return;
  }

  const accType = accountType || 'GENEL';

  chrome.storage.local.get(['bankBotSelectedSheet'], (result) => {
    const sheetData = result.bankBotSelectedSheet;
    if (!sheetData || !sheetData.id || !sheetData.activitySheet) {
      if (sendResponse) sendResponse({ success: false, error: 'Bağlı Activity Log sekmesi bulunamadı.' });
      return;
    }

    getToken((token, err) => {
      if (err || !token) {
        if (sendResponse) sendResponse({ success: false, error: err || 'Oturum açık değil.' });
        return;
      }

      const spreadsheetId = sheetData.id;
      const activitySheet = sheetData.activitySheet;
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/'${encodeURIComponent(activitySheet)}'!1:100`;

      fetch(url, { headers: { Authorization: `Bearer ${token}` } })
        .then(res => res.json())
        .then(async data => {
          const values = data.values || [];
          let timestampIdx = 0;
          let accountTypeIdx = 1;
          let activityIdx = 2;
          let colCount = 3;

          if (values.length > 0 && values[0]) {
            const headerRow = values[0].map(h => (h || '').toString().trim().toLowerCase().replace(/[\s_]+/g, '_'));
            const tIdx = headerRow.indexOf('timestamp');
            const aTypeIdx = headerRow.indexOf('account_type');
            const actIdx = headerRow.indexOf('activity');

            if (tIdx !== -1) timestampIdx = tIdx;
            if (aTypeIdx !== -1) accountTypeIdx = aTypeIdx;
            if (actIdx !== -1) activityIdx = actIdx;
            colCount = Math.max(headerRow.length, 3);
          }

          const currentTimestamp = getFormattedTimestamp();
          const row = new Array(colCount).fill('');
          row[timestampIdx] = currentTimestamp;
          row[accountTypeIdx] = accType;
          row[activityIdx] = activity.toString();

          const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/'${encodeURIComponent(activitySheet)}'!1:1:append?valueInputOption=USER_ENTERED`;

          const appendRes = await fetch(appendUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ values: [row] })
          });

          if (!appendRes.ok) {
            throw new Error(`Activity log kaydetme hatası: ${appendRes.statusText}`);
          }

          if (sendResponse) sendResponse({ success: true });
        })
        .catch(error => {
          if (sendResponse) sendResponse({ success: false, error: error.message });
        });
    });
  });
}

/**
 * Row Matcher: Compares ONLY the Reference (REF) column to determine existing vs new data.
 */
function isRowMatch(item, lastRecordedObj) {
  if (!item || !lastRecordedObj) return false;

  // Normalize string: strip HTML non-breaking spaces (\u00a0), replace multiple spaces, trim, lowercase
  const norm = (val) => (val || '').toString().replace(/[\s\u00a0]+/g, ' ').trim().toLowerCase();

  const itemRef = norm(item.ref);
  const targetRef = norm(lastRecordedObj.ref);

  if (!itemRef || !targetRef) return false;

  return itemRef === targetRef;
}

/**
 * Service Worker Keep-Alive & Anti-Sleep Engine (Manifest V3)
 * Prevents background service worker from sleeping / dying by utilizing:
 * 1. chrome.alarms periodic pings (every 30s)
 * 2. Port connection heartbeat from content scripts (every 20s)
 * 3. Automatic tab wakeup & state persistence
 */
function setupKeepAliveAlarm() {
  chrome.alarms.get('bankBotKeepAlive', (alarm) => {
    if (!alarm) {
      chrome.alarms.create('bankBotKeepAlive', { periodInMinutes: 0.5 });
    }
  });

  // Request system CPU to stay awake even when screen is locked or turned off
  if (chrome.power) {
    chrome.power.requestKeepAwake('system');
  }
}

chrome.runtime.onInstalled.addListener(() => {
  setupKeepAliveAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  setupKeepAliveAlarm();
});

// Ensure alarm is created on startup / load
setupKeepAliveAlarm();

// Fire on alarm: Wake up service worker, check state, and ping open tabs
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'bankBotKeepAlive') {
    if (chrome.power) {
      chrome.power.requestKeepAwake('system');
    }
    chrome.storage.local.get(['bankBotTrackingState'], (result) => {
      const state = result.bankBotTrackingState;
      if (state && state.isRunning) {
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach((tab) => {
            if (tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
              chrome.tabs.sendMessage(tab.id, { action: 'PING' }).catch(() => {});
            }
          });
        });
      } else if (state && !state.isRunning) {
        if (chrome.power) {
          chrome.power.releaseKeepAwake();
        }
      }
    });
  }
});

// Keep-Alive Long-Lived Port listener to keep SW active when tab is open
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'bankBotKeepAlive') {
    port.onMessage.addListener((msg) => {
      if (msg && msg.ping) {
        try {
          port.postMessage({ pong: true });
        } catch (e) {}
      }
    });
  }
});
