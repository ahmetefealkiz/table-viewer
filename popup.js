document.addEventListener('DOMContentLoaded', () => {
  // Navigation & Tab Elements
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const globalBadge = document.getElementById('global-status-badge');

  // Tracking Screen Controls
  const btnToggleTracking = document.getElementById('btn-toggle-tracking');
  const btnToggleText = document.getElementById('btn-toggle-text');
  const btnForceRead = document.getElementById('btn-force-read');
  const btnClearData = document.getElementById('btn-clear-data');
  const countdownTimer = document.getElementById('countdown-timer');
  const trackingStatus = document.getElementById('tracking-status');
  const resultsBody = document.getElementById('results-body');
  const rowCountEl = document.getElementById('row-count');
  const lastUpdatedEl = document.getElementById('last-updated-text');

  // Settings Form Inputs
  const settingsForm = document.getElementById('settings-form');
  const btnSaveSettings = document.getElementById('btn-save-settings');
  const inputTargetUrl = document.getElementById('target-url');
  const inputBaseMinutes = document.getElementById('base-interval-minutes');
  const inputWaitSeconds = document.getElementById('wait-seconds');
  const inputFallbackCurrency = document.getElementById('fallback-currency');
  const inputAccountNumbers = document.getElementById('account-numbers');
  const inputHeaderDate = document.getElementById('header-date');
  const inputHeaderNarration = document.getElementById('header-narration');
  const inputHeaderRef = document.getElementById('header-ref');
  const inputHeaderCredit = document.getElementById('header-credit');

  const DEFAULT_SETTINGS = {
    targetUrl: '',
    baseMinutes: 4,
    waitSeconds: 15,
    fallbackCurrency: '',
    accountNumbers: '',
    headerDate: 'Transaction Date',
    headerNarration: 'Narration',
    headerRef: 'Transaction Reference',
    headerCredit: 'Credit'
  };

  const accountsContainer = document.getElementById('account-buttons-container');
  const accountsStatus = document.getElementById('accounts-status');

  function showAccountsStatus(msg, type = 'info') {
    if (accountsStatus) {
      accountsStatus.textContent = msg;
      accountsStatus.className = `status-banner ${type}`;
      accountsStatus.classList.remove('hidden');
    }
  }

  function hideAccountsStatus() {
    if (accountsStatus) {
      accountsStatus.classList.add('hidden');
    }
  }

  function renderAccountButtons() {
    if (!accountsContainer) return;
    chrome.storage.local.get(['bankBotSettings'], (result) => {
      const settings = result.bankBotSettings || DEFAULT_SETTINGS;
      const rawAccs = settings.accountNumbers || '';
      const accList = rawAccs
        .split(/[\n,;]+/)
        .map(a => a.trim())
        .filter(a => a.length > 0);

      accountsContainer.innerHTML = '';

      if (accList.length === 0) {
        accountsContainer.innerHTML = '<div class="empty-accounts-notice">Ayarlar sekmesinden henüz hesap numarası eklenmemiş.</div>';
        return;
      }

      accList.forEach(acc => {
        const btn = document.createElement('button');
        btn.className = 'account-btn';
        btn.innerHTML = `
          <svg class="acc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="5" width="20" height="14" rx="2"></rect>
            <line x1="2" y1="10" x2="22" y2="10"></line>
          </svg>
          <span>${acc}</span>
        `;

        btn.addEventListener('click', () => {
          hideAccountsStatus();
          btn.classList.remove('account-btn-success', 'account-btn-error');
          
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const activeTab = tabs[0];
            if (!activeTab) {
              showAccountsStatus('Aktif sekme bulunamadı.', 'error');
              return;
            }

            chrome.tabs.sendMessage(activeTab.id, { action: 'OPEN_SPECIFIC_ACCOUNT', accountNumber: acc }, (response) => {
              if (chrome.runtime.lastError) {
                showAccountsStatus('Banka sayfası yanıt vermiyor. Lütfen doğru sekmede olduğunuzdan emin olun.', 'error');
                btn.classList.add('account-btn-error');
                setTimeout(() => btn.classList.remove('account-btn-error'), 1000);
                return;
              }

              if (response && response.success) {
                showAccountsStatus(`"${acc}" numaralı hesap ekranda bulundu ve açıldı.`, 'success');
                btn.classList.add('account-btn-success');
                setTimeout(() => btn.classList.remove('account-btn-success'), 1200);
              } else {
                const err = (response && response.error) || `"${acc}" numaralı hesap ekranda bulunamadı.`;
                showAccountsStatus(err, 'error');
                btn.classList.add('account-btn-error');
                setTimeout(() => btn.classList.remove('account-btn-error'), 1000);
              }
            });
          });
        });

        accountsContainer.appendChild(btn);
      });
    });
  }

  // --- 1. Tab Navigation (İzleme Ekranı is Default Active) ---
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;
      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      document.getElementById(`tab-${tabName}`).classList.add('active');

      if (tabName === 'accounts') {
        renderAccountButtons();
      }
    });
  });

  // --- 2. Load Saved Settings into Settings Form ---
  function loadSettings() {
    chrome.storage.local.get(['bankBotSettings'], (result) => {
      const settings = result.bankBotSettings || DEFAULT_SETTINGS;
      inputTargetUrl.value = settings.targetUrl || '';
      inputBaseMinutes.value = settings.baseMinutes || 4;
      inputWaitSeconds.value = settings.waitSeconds || settings.intervalSeconds || 15;
      inputFallbackCurrency.value = settings.fallbackCurrency || '';
      inputAccountNumbers.value = settings.accountNumbers !== undefined ? settings.accountNumbers : '';
      inputHeaderDate.value = settings.headerDate || DEFAULT_SETTINGS.headerDate;
      inputHeaderNarration.value = settings.headerNarration || DEFAULT_SETTINGS.headerNarration;
      inputHeaderRef.value = settings.headerRef || DEFAULT_SETTINGS.headerRef;
      inputHeaderCredit.value = settings.headerCredit || DEFAULT_SETTINGS.headerCredit;

      renderAccountButtons();
    });
  }

  loadSettings();

  const settingsError = document.getElementById('settings-error');

  function showSettingsError(msg) {
    if (settingsError) {
      settingsError.textContent = msg;
      settingsError.classList.remove('hidden');
    }
  }

  function hideSettingsError() {
    if (settingsError) {
      settingsError.classList.add('hidden');
    }
  }

  // Helper to validate target URL strictly (prevents http://, https://, wildcards, or empty inputs)
  function isValidTargetUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return false;
    const trimmed = rawUrl.trim().toLowerCase();
    let clean = trimmed.replace(/^https?:\/\//i, '').replace(/^\/\//, '').replace(/[\/*]+$/, '').trim();
    if (!clean || clean === 'http' || clean === 'https' || clean === 'http:' || clean === 'https:') {
      return false;
    }
    return true;
  }

  // Save Settings
  settingsForm.addEventListener('submit', (e) => {
    e.preventDefault();

    hideSettingsError();

    const targetUrlVal = inputTargetUrl.value.trim();

    if (!isValidTargetUrl(targetUrlVal)) {
      inputTargetUrl.focus();
      showSettingsError('Lütfen geçerli ve net bir Hedef URL girin (Örn: banka.com/hesap veya https://banka.com). Sadece "http://" veya "https://" kabul edilmez.');
      return;
    }

    const newSettings = {
      targetUrl: targetUrlVal,
      baseMinutes: parseInt(inputBaseMinutes.value, 10) || 4,
      waitSeconds: parseInt(inputWaitSeconds.value, 10) || 15,
      fallbackCurrency: inputFallbackCurrency.value.trim(),
      accountNumbers: inputAccountNumbers.value.trim(),
      headerDate: inputHeaderDate.value.trim(),
      headerNarration: inputHeaderNarration.value.trim(),
      headerRef: inputHeaderRef.value.trim(),
      headerCredit: inputHeaderCredit.value.trim()
    };

    chrome.storage.local.set({ bankBotSettings: newSettings }, () => {
      hideSettingsError();
      renderAccountButtons();
      if (btnSaveSettings) {
        btnSaveSettings.classList.remove('btn-saved-success');
        void btnSaveSettings.offsetWidth; // Force CSS reflow to re-trigger animation
        btnSaveSettings.classList.add('btn-saved-success');
        setTimeout(() => {
          btnSaveSettings.classList.remove('btn-saved-success');
        }, 1200);
      }
    });
  });

  // --- 3. Initial State Sync ---
  function syncState() {
    // Read directly from storage first to get the most up-to-date global state
    chrome.storage.local.get(['bankBotTrackingState'], (result) => {
      if (result.bankBotTrackingState) {
        updateUIFromState(result.bankBotTrackingState);
      }
    });

    // Query active tab as fallback to ensure the script is responding
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (!activeTab) return;

      chrome.tabs.sendMessage(activeTab.id, { action: 'GET_STATE' }, (response) => {
        if (chrome.runtime.lastError || !response || !response.success) {
          return;
        }
        updateUIFromState(response.state);
      });
    });
  }

  syncState();

  // --- 4. Listen for Live State Updates from Content Script ---
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'STATE_UPDATE' && message.state) {
      updateUIFromState(message.state);
    }
  });

  // --- 5. Update UI Components based on State ---
  function updateUIFromState(state) {
    if (!state) return;

    // Header Badge & Start/Stop Button
    if (state.isRunning) {
      if (state.isWaitingForData) {
        globalBadge.textContent = 'Yenileniyor...';
        globalBadge.className = 'badge badge-running';
      } else {
        globalBadge.textContent = 'İzleniyor...';
        globalBadge.className = 'badge badge-running';
      }

      btnToggleTracking.className = 'btn btn-stop btn-full';
      btnToggleText.textContent = 'İzlemeyi Durdur';
      btnToggleTracking.querySelector('svg').innerHTML = '<rect x="6" y="6" width="12" height="12"></rect>';
      
      countdownTimer.textContent = `${state.secondsLeft || 0}s`;
    } else {
      globalBadge.textContent = 'Durduruldu';
      globalBadge.className = 'badge badge-stopped';

      btnToggleTracking.className = 'btn btn-start btn-full';
      btnToggleText.textContent = 'İzlemeyi Başlat';
      btnToggleTracking.querySelector('svg').innerHTML = '<polygon points="5 3 19 12 5 21 5 3"></polygon>';

      countdownTimer.textContent = '--';
    }

    // Last Updated Time
    if (state.lastUpdatedTime) {
      lastUpdatedEl.textContent = `Son Güncelleme: ${state.lastUpdatedTime}`;
    } else {
      lastUpdatedEl.textContent = 'Son Güncelleme: Henüz yapılmadı';
    }

    // Error status banner
    if (state.error) {
      showStatus(state.error, 'error');
    } else {
      hideStatus();
    }

    // Render Table Data
    renderTableData(state.lastData);
  }

  // --- 6. Button Click Actions ---

  // Start / Stop Toggle Button
  btnToggleTracking.addEventListener('click', () => {
    const isRunningNow = globalBadge.classList.contains('badge-running');
    const action = isRunningNow ? 'STOP_TRACKING' : 'START_TRACKING';

    // Optimistically update local storage and UI if stopping
    if (isRunningNow) {
      chrome.storage.local.get(['bankBotTrackingState'], (result) => {
        const state = result.bankBotTrackingState || {};
        state.isRunning = false;
        chrome.storage.local.set({ bankBotTrackingState: state });
        updateUIFromState(state);
      });
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (!activeTab) return;

      chrome.tabs.sendMessage(activeTab.id, { action }, (response) => {
        if (chrome.runtime.lastError) {
          if (!isRunningNow) {
            showStatus('İzleme başlatılamadı. Lütfen banka sayfasında olduğunuzdan emin olun.', 'error');
          }
          return;
        }

        if (response && response.success) {
          updateUIFromState(response.state);
        }
      });
    });
  });

  // Force Read Button (Read open account data & sync to Excel)
  btnForceRead.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (!activeTab) return;

      chrome.tabs.sendMessage(activeTab.id, { action: 'FORCE_READ' }, (response) => {
        if (chrome.runtime.lastError) {
          showStatus('Sayfa verileri okunamadı. Lütfen banka sayfasında olduğunuzdan ve bir hesabın açık olduğundan emin olun.', 'error');
          return;
        }

        if (response && response.success) {
          updateUIFromState(response.state);
          showStatus('Açık hesaptaki veriler okundu ve Excel\'e aktarıldı.', 'info');
        }
      });
    });
  });

  // Clear Data Button
  btnClearData.addEventListener('click', () => {
    // Optimistically clear storage and UI
    chrome.storage.local.get(['bankBotTrackingState'], (result) => {
      const state = result.bankBotTrackingState || {};
      state.lastData = [];
      state.lastUpdatedTime = null;
      state.error = null;
      chrome.storage.local.set({ bankBotTrackingState: state });
      updateUIFromState(state);
    });

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (!activeTab) return;

      chrome.tabs.sendMessage(activeTab.id, { action: 'CLEAR_DATA' }, (response) => {
        if (chrome.runtime.lastError) {
          return;
        }
        if (response && response.success) {
          updateUIFromState(response.state);
          showStatus('Tablo ve hafızadaki tüm veriler temizlendi.', 'info');
        }
      });
    });
  });

  // --- Helper Render Functions ---
  function renderTableData(data) {
    if (!data || data.length === 0) {
      resultsBody.innerHTML = `<tr class="empty-row"><td colspan="5">Okunan işlem verisi bulunamadı.</td></tr>`;
      rowCountEl.textContent = '0';
      return;
    }

    rowCountEl.textContent = data.length;
    resultsBody.innerHTML = '';

    data.forEach(item => {
      const tr = document.createElement('tr');
      
      const tdCurrency = document.createElement('td');
      tdCurrency.textContent = item.currency || '-';

      const tdDate = document.createElement('td');
      tdDate.textContent = item.date || '-';
      
      const tdNarration = document.createElement('td');
      tdNarration.textContent = item.narration || '-';
      
      const tdRef = document.createElement('td');
      tdRef.textContent = item.ref || '-';

      const tdCredit = document.createElement('td');
      tdCredit.textContent = item.credit || '-';

      tr.appendChild(tdCurrency);
      tr.appendChild(tdDate);
      tr.appendChild(tdNarration);
      tr.appendChild(tdRef);
      tr.appendChild(tdCredit);

      resultsBody.appendChild(tr);
    });
  }

  function showToast(element, message, type = 'success') {
    if (!element) return;
    element.textContent = message;
    element.className = `toast ${type}`;
    element.classList.remove('hidden');
    setTimeout(() => {
      if (element) element.classList.add('hidden');
    }, 3000);
  }

  function showStatus(message, type = 'info') {
    trackingStatus.textContent = message;
    trackingStatus.className = `status-banner ${type}`;
    trackingStatus.classList.remove('hidden');
  }

  function hideStatus() {
    trackingStatus.classList.add('hidden');
  }

  // --- 7. Google Sheets Tab Logic ---
  const btnGoogleLogin = document.getElementById('btn-google-login');
  const btnGoogleLogout = document.getElementById('btn-google-logout');
  const googleAuthLoggedOut = document.getElementById('google-auth-logged-out');
  const googleAuthLoggedIn = document.getElementById('google-auth-logged-in');
  const userEmailText = document.getElementById('user-email-text');

  const sheetSelectionCard = document.getElementById('sheet-selection-card');
  const sheetsSelect = document.getElementById('sheets-select');
  const btnRefreshSheets = document.getElementById('btn-refresh-sheets');
  const worksheetsContainer = document.getElementById('worksheets-container');
  const transactionSheetSelect = document.getElementById('transaction-sheet-select');
  const errorSheetSelect = document.getElementById('error-sheet-select');
  const btnConnectSheet = document.getElementById('btn-connect-sheet');

  const connectedSheetInfo = document.getElementById('connected-sheet-info');
  const connectedSheetName = document.getElementById('connected-sheet-name');
  const connectedTransactionName = document.getElementById('connected-transaction-name');
  const connectedErrorName = document.getElementById('connected-error-name');
  const connectedSheetDate = document.getElementById('connected-sheet-date');
  const btnDisconnectSheet = document.getElementById('btn-disconnect-sheet');
  const sheetsStatus = document.getElementById('sheets-status');

  let isFetchingSheets = false;
  let isFetchingWorksheets = false;

  // Sync Google Auth & Sheet Connection Status on Load
  function syncGoogleStatus() {
    chrome.runtime.sendMessage({ action: 'GET_GOOGLE_STATUS' }, (response) => {
      if (chrome.runtime.lastError || !response) return;

      const { auth, sheet } = response;
      updateGoogleUI(auth, sheet);
    });
  }

  syncGoogleStatus();

  function updateGoogleUI(auth, sheet) {
    if (auth && auth.isLoggedIn) {
      googleAuthLoggedOut.classList.add('hidden');
      googleAuthLoggedIn.classList.remove('hidden');
      userEmailText.textContent = auth.userEmail || 'Giriş Yapıldı';
      sheetSelectionCard.classList.remove('hidden');
      loadSpreadsheets(sheet ? sheet.id : null, sheet);
    } else {
      googleAuthLoggedOut.classList.remove('hidden');
      googleAuthLoggedIn.classList.add('hidden');
      sheetSelectionCard.classList.add('hidden');
      userEmailText.textContent = '--';
    }

    if (sheet && sheet.id) {
      connectedSheetInfo.classList.remove('hidden');
      connectedSheetName.textContent = sheet.name || 'Bilinmeyen Tablo';
      if (connectedTransactionName) connectedTransactionName.textContent = sheet.transactionSheet || 'Bilinmiyor';
      if (connectedErrorName) connectedErrorName.textContent = sheet.errorSheet || 'Bilinmiyor';
      connectedSheetDate.textContent = sheet.connectedAt || '--';
    } else {
      connectedSheetInfo.classList.add('hidden');
      connectedSheetName.textContent = '--';
      if (connectedTransactionName) connectedTransactionName.textContent = '--';
      if (connectedErrorName) connectedErrorName.textContent = '--';
      connectedSheetDate.textContent = '--';
    }
  }

  // Google Login
  if (btnGoogleLogin) {
    btnGoogleLogin.addEventListener('click', () => {
      btnGoogleLogin.disabled = true;
      btnGoogleLogin.textContent = 'Giriş Yapılıyor...';

      chrome.runtime.sendMessage({ action: 'GOOGLE_LOGIN' }, (response) => {
        btnGoogleLogin.disabled = false;
        btnGoogleLogin.innerHTML = `
          <svg class="btn-icon" viewBox="0 0 24 24" width="18" height="18">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
          </svg>
          Google ile Giriş Yap
        `;

        if (response && response.success) {
          showToast(sheetsStatus, 'Google hesabıyla başarıyla giriş yapıldı!', 'success');
          syncGoogleStatus();
        } else {
          const errStr = response?.error || 'Giriş yapılamadı.';
          showToast(sheetsStatus, errStr, 'error');
        }
      });
    });
  }

  // Google Logout
  if (btnGoogleLogout) {
    btnGoogleLogout.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'GOOGLE_LOGOUT' }, (response) => {
        if (response && response.success) {
          showToast(sheetsStatus, 'Google hesabından çıkış yapıldı.', 'success');
          syncGoogleStatus();
          sheetsSelect.innerHTML = `<option value="">-- Menüyü açarak tabloları yükleyin --</option>`;
          if (worksheetsContainer) worksheetsContainer.classList.add('hidden');
        }
      });
    });
  }

  // Fetch Spreadsheets Function
  function loadSpreadsheets(presetId = null, connectedData = null) {
    if (isFetchingSheets) return;
    isFetchingSheets = true;

    const currentVal = presetId || sheetsSelect.value;
    
    // Show loading state in first option if empty
    if (!sheetsSelect.options.length || sheetsSelect.options[0].value === '') {
      sheetsSelect.innerHTML = `<option value="">Tablolar yükleniyor...</option>`;
    }

    chrome.runtime.sendMessage({ action: 'FETCH_SPREADSHEETS' }, (response) => {
      isFetchingSheets = false;

      if (chrome.runtime.lastError || !response || !response.success) {
        const errorMsg = response?.error || 'Tablo listesi alınamadı.';
        showToast(sheetsStatus, errorMsg, 'error');
        sheetsSelect.innerHTML = `<option value="">-- Hata: Yenile butonuna basın --</option>`;
        return;
      }

      const files = response.files || [];
      if (files.length === 0) {
        sheetsSelect.innerHTML = `<option value="">-- Hesabınızda E-Tablo bulunamadı --</option>`;
        return;
      }

      sheetsSelect.innerHTML = `<option value="">-- Lütfen bir E-Tablo seçin --</option>`;
      files.forEach(file => {
        const opt = document.createElement('option');
        opt.value = file.id;
        opt.textContent = file.name;
        if (file.id === currentVal) {
          opt.selected = true;
        }
        sheetsSelect.appendChild(opt);
      });

      if (sheetsSelect.value) {
        loadWorksheets(sheetsSelect.value, connectedData);
      }
    });
  }

  function loadWorksheets(spreadsheetId, connectedData = null) {
    if (!spreadsheetId) {
      if (worksheetsContainer) worksheetsContainer.classList.add('hidden');
      return;
    }
    if (isFetchingWorksheets) return;
    isFetchingWorksheets = true;

    if (transactionSheetSelect) transactionSheetSelect.innerHTML = `<option value="">Sekmeler yükleniyor...</option>`;
    if (errorSheetSelect) errorSheetSelect.innerHTML = `<option value="">Sekmeler yükleniyor...</option>`;
    if (worksheetsContainer) worksheetsContainer.classList.remove('hidden');

    chrome.runtime.sendMessage({ action: 'FETCH_WORKSHEETS', spreadsheetId }, (response) => {
      isFetchingWorksheets = false;
      if (chrome.runtime.lastError || !response || !response.success) {
        const errorMsg = response?.error || 'Sekme listesi alınamadı.';
        showToast(sheetsStatus, errorMsg, 'error');
        if (transactionSheetSelect) transactionSheetSelect.innerHTML = `<option value="">-- Hata (${errorMsg}) --</option>`;
        if (errorSheetSelect) errorSheetSelect.innerHTML = `<option value="">-- Hata (${errorMsg}) --</option>`;
        return;
      }

      const sheets = response.sheets || [];
      let transOptions = `<option value="">-- Transaction sekmesi seçin --</option>`;
      let errOptions = `<option value="">-- Error Log sekmesi seçin --</option>`;

      sheets.forEach((sheetName, index) => {
        let isTransSelected = false;
        let isErrSelected = false;

        if (connectedData && connectedData.transactionSheet) {
          isTransSelected = sheetName === connectedData.transactionSheet;
        } else {
          isTransSelected = index === 0;
        }

        if (connectedData && connectedData.errorSheet) {
          isErrSelected = sheetName === connectedData.errorSheet;
        } else {
          isErrSelected = index === 1 || (sheets.length === 1 && index === 0);
        }

        transOptions += `<option value="${sheetName}" ${isTransSelected ? 'selected' : ''}>${sheetName}</option>`;
        errOptions += `<option value="${sheetName}" ${isErrSelected ? 'selected' : ''}>${sheetName}</option>`;
      });

      if (transactionSheetSelect) transactionSheetSelect.innerHTML = transOptions;
      if (errorSheetSelect) errorSheetSelect.innerHTML = errOptions;
    });
  }

  // Refetch spreadsheets every time user opens / interacts with dropdown
  if (sheetsSelect) {
    sheetsSelect.addEventListener('focus', () => {
      if (!sheetsSelect.options || sheetsSelect.options.length <= 1) {
        loadSpreadsheets();
      }
    });

    sheetsSelect.addEventListener('change', () => {
      loadWorksheets(sheetsSelect.value);
    });
  }

  // Refresh sheets list button click
  if (btnRefreshSheets) {
    btnRefreshSheets.addEventListener('click', (e) => {
      e.preventDefault();
      loadSpreadsheets();
    });
  }
  const sheetsConnMsg = document.getElementById('sheets-connection-message');
  const btnScrollDown = document.getElementById('btn-scroll-down');

  // Floating scroll down button click event
  if (btnScrollDown) {
    btnScrollDown.addEventListener('click', () => {
      window.scrollTo({
        top: document.body.scrollHeight,
        behavior: 'smooth'
      });
    });
  }

  function resetConnectButton() {
    if (btnConnectSheet) {
      btnConnectSheet.classList.remove('btn-connect-success', 'btn-connect-error');
      btnConnectSheet.textContent = 'Tabloları Bağla ve Kontrol Et';
    }
    if (sheetsConnMsg) {
      sheetsConnMsg.classList.add('hidden');
    }
  }

  // Reset button state when dropdown selection changes
  [sheetsSelect, transactionSheetSelect, errorSheetSelect].forEach(selectEl => {
    if (selectEl) {
      selectEl.addEventListener('change', resetConnectButton);
    }
  });

  // Connect and Validate Sheet
  if (btnConnectSheet) {
    btnConnectSheet.addEventListener('click', () => {
      const selectedId = sheetsSelect.value;
      const selectedOption = sheetsSelect.options[sheetsSelect.selectedIndex];
      const selectedName = selectedOption ? selectedOption.textContent : '';
      const transSheet = transactionSheetSelect ? transactionSheetSelect.value : '';
      const errSheet = errorSheetSelect ? errorSheetSelect.value : '';

      resetConnectButton();

      if (!selectedId) {
        const msg = 'Lütfen bir E-Tablo dosyası seçin.';
        if (sheetsConnMsg) {
          sheetsConnMsg.textContent = msg;
          sheetsConnMsg.className = 'status-banner error';
          sheetsConnMsg.classList.remove('hidden');
        }
        btnConnectSheet.classList.add('btn-connect-error');
        btnConnectSheet.textContent = 'Bağlantı Hatası - Tekrar Dene';
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        return;
      }

      if (!transSheet || !errSheet) {
        const msg = 'Lütfen hem Transaction hem de Error Log sekmelerini seçin.';
        if (sheetsConnMsg) {
          sheetsConnMsg.textContent = msg;
          sheetsConnMsg.className = 'status-banner error';
          sheetsConnMsg.classList.remove('hidden');
        }
        btnConnectSheet.classList.add('btn-connect-error');
        btnConnectSheet.textContent = 'Bağlantı Hatası - Tekrar Dene';
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        return;
      }

      btnConnectSheet.disabled = true;
      btnConnectSheet.textContent = 'Kolonlar Kontrol Ediliyor...';

      chrome.runtime.sendMessage({
        action: 'VALIDATE_AND_CONNECT_SHEET',
        spreadsheetId: selectedId,
        spreadsheetName: selectedName,
        transactionSheet: transSheet,
        errorSheet: errSheet
      }, (response) => {
        btnConnectSheet.disabled = false;

        if (response && response.success) {
          btnConnectSheet.classList.remove('btn-connect-error');
          btnConnectSheet.classList.add('btn-connect-success');
          btnConnectSheet.textContent = 'Tablolar Başarıyla Bağlandı ✓';

          const successMsg = 'E-Tablo sekmeleri başarıyla doğrulandı ve bağlandı!';
          if (sheetsConnMsg) {
            sheetsConnMsg.textContent = successMsg;
            sheetsConnMsg.className = 'status-banner success';
            sheetsConnMsg.classList.remove('hidden');
          }

          syncGoogleStatus();

          setTimeout(() => {
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
          }, 150);
        } else {
          const errorMsg = response?.error || 'Tablolar doğrulanamadı.';
          btnConnectSheet.classList.remove('btn-connect-success');
          btnConnectSheet.classList.add('btn-connect-error');
          btnConnectSheet.textContent = 'Bağlantı Hatası - Tekrar Dene';

          if (sheetsConnMsg) {
            sheetsConnMsg.textContent = errorMsg;
            sheetsConnMsg.className = 'status-banner error';
            sheetsConnMsg.classList.remove('hidden');
          }

          setTimeout(() => {
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
          }, 150);
        }
      });
    });
  }

  // Disconnect Sheet
  if (btnDisconnectSheet) {
    btnDisconnectSheet.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'DISCONNECT_SHEET' }, (response) => {
        if (response && response.success) {
          showToast(sheetsStatus, 'E-Tablo bağlantısı iptal edildi.', 'success');
          syncGoogleStatus();
          if (worksheetsContainer) worksheetsContainer.classList.add('hidden');
          resetConnectButton();
        }
      });
    });
  }
});

