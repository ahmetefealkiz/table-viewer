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

    case 'VALIDATE_AND_CONNECT_SHEET':
      validateAndConnectSheet(request.spreadsheetId, request.spreadsheetName, sendResponse);
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
 * Validate Columns in Selected Sheet
 * Required headers: Date, Narration, Reference, Credit (case-insensitive)
 */
function validateAndConnectSheet(spreadsheetId, spreadsheetName, sendResponse) {
  if (!spreadsheetId) {
    sendResponse({ success: false, error: 'Geçersiz tablo ID.' });
    return;
  }

  getToken((token, err) => {
    if (err || !token) {
      sendResponse({ success: false, error: err || 'Oturum açık değil.' });
      return;
    }

    // Fetch the first row of the sheet (A1:Z1 or 1:1)
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/1:1`;

    fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => {
        if (res.status === 401) {
          throw new Error('Oturum süresi doldu. Lütfen tekrar giriş yapın.');
        }
        if (!res.ok) {
          throw new Error(`Sheets API Hatası: ${res.statusText}`);
        }
        return res.json();
      })
      .then(async data => {
        const rows = data.values;
        if (!rows || rows.length === 0 || !rows[0]) {
          throw new Error('Seçilen tablonun ilk satırında hiçbir başlık verisi bulunamadı.');
        }

        const headers = rows[0].map(h => (h || '').toString().trim().toLowerCase());
        const REQUIRED_HEADERS = ['date', 'narration', 'reference', 'credit'];
        const missingHeaders = [];

        REQUIRED_HEADERS.forEach(req => {
          if (!headers.includes(req)) {
            // Capitalize for display
            missingHeaders.push(req.charAt(0).toUpperCase() + req.slice(1));
          }
        });

        if (missingHeaders.length > 0) {
          sendResponse({
            success: false,
            error: `Seçilen E-Tabloda zorunlu kolon(lar) bulunamadı: ${missingHeaders.join(', ')}.\nLütfen tablonun ilk satırına Date, Narration, Reference ve Credit başlıklarını ekleyin.`
          });
          return;
        }

        // Save selected sheet details
        const selectedSheetData = {
          id: spreadsheetId,
          name: spreadsheetName,
          connectedAt: new Date().toLocaleString(),
          headers: rows[0]
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

      // 1. Fetch current values from Google Sheet
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/1:100000`;

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
            throw new Error('E-Tablo tamamen boş. Lütfen ilk satıra kolon başlıklarını (Date, Narration, Reference, Credit) ekleyin.');
          }

          // Header row is index 0
          const headerRow = values[0].map(h => (h || '').toString().trim().toLowerCase());

          const dateIdx = headerRow.indexOf('date');
          const narrationIdx = headerRow.indexOf('narration');
          const refIdx = headerRow.indexOf('reference');
          const creditIdx = headerRow.indexOf('credit');

          if (dateIdx === -1 || narrationIdx === -1 || refIdx === -1 || creditIdx === -1) {
            throw new Error('Seçilen E-Tabloda zorunlu kolon başlıklarından (Date, Narration, Reference, Credit) biri eksik.');
          }

          let itemsToWrite = [];

          // Find data rows (excluding header)
          const dataRows = values.slice(1).filter(row => row.some(cell => cell && cell.toString().trim() !== ''));

          if (dataRows.length === 0) {
            // Sheet has no data rows yet! Write ALL items in chronological order (oldest first)
            itemsToWrite = [...dataList].reverse();
          } else {
            // Find the last recorded transaction from the sheet
            const lastRecordedRow = dataRows[dataRows.length - 1];
            
            const lastRecordedObj = {
              date: lastRecordedRow[dateIdx],
              narration: lastRecordedRow[narrationIdx],
              ref: lastRecordedRow[refIdx],
              credit: lastRecordedRow[creditIdx]
            };

            // Search for lastRecordedObj starting from index 0 (VERY TOP of web page table)
            let matchIndex = -1;
            for (let i = 0; i < dataList.length; i++) {
              if (isRowMatch(dataList[i], lastRecordedObj)) {
                matchIndex = i;
                break;
              }
            }

            if (matchIndex === -1) {
              // Last saved transaction in sheet was NOT found starting from top of webpage table
              sendResponse({
                success: false,
                error: "E-Tablodaki son kaydedilmiş işlem web sayfasında bulunamadı. Lütfen web sayfasındaki listeleme filtresini 'son 7 gün'den 'son 1 ay'a (veya daha geniş bir aralığa) güncelleyip tekrar okutun."
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

          // Format itemsToWrite into 2D row arrays matching the Sheet column order
          const formattedRows = itemsToWrite.map(item => {
            const row = new Array(headerRow.length).fill('');
            row[dateIdx] = item.date || '';
            row[narrationIdx] = item.narration || '';
            row[refIdx] = item.ref || '';
            row[creditIdx] = item.credit || '';
            return row;
          });

          // 2. Append formattedRows to Google Sheet
          const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/1:1:append?valueInputOption=USER_ENTERED`;

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
 * Row Matcher: Requires ALL 4 columns (Date, Narration, Reference, Credit) to match strictly
 */
function isRowMatch(item, lastRecordedObj) {
  if (!item || !lastRecordedObj) return false;

  // Normalize string: strip HTML non-breaking spaces (\u00a0), replace multiple spaces, trim, lowercase
  const norm = (val) => (val || '').toString().replace(/[\s\u00a0]+/g, ' ').trim().toLowerCase();

  // Normalize numeric string for credit (e.g. "100.00 TL" vs "100.00")
  const normCredit = (val) => {
    const s = norm(val).replace(/[^0-9.,-]/g, '');
    if (!s) return norm(val);
    if (s.includes(',') && s.includes('.')) {
      const parsed = parseFloat(s.replace(/\./g, '').replace(',', '.'));
      return isNaN(parsed) ? norm(val) : parsed.toFixed(2);
    }
    const parsed = parseFloat(s.replace(',', '.'));
    return isNaN(parsed) ? norm(val) : parsed.toFixed(2);
  };

  const dateMatch = norm(item.date) === norm(lastRecordedObj.date);
  const narrationMatch = norm(item.narration) === norm(lastRecordedObj.narration);
  const refMatch = norm(item.ref) === norm(lastRecordedObj.ref);
  const creditMatch = (norm(item.credit) === norm(lastRecordedObj.credit)) || (normCredit(item.credit) === normCredit(lastRecordedObj.credit));

  // ALL 4 COLUMNS MUST MATCH
  return dateMatch && narrationMatch && refMatch && creditMatch;
}
