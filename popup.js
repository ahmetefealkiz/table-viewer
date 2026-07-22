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
  const settingsStatus = document.getElementById('settings-status');
  const inputTargetUrl = document.getElementById('target-url');
  const inputIntervalSeconds = document.getElementById('interval-seconds');
  const inputHeaderDate = document.getElementById('header-date');
  const inputHeaderNarration = document.getElementById('header-narration');
  const inputHeaderRef = document.getElementById('header-ref');
  const inputHeaderCredit = document.getElementById('header-credit');

  const DEFAULT_SETTINGS = {
    targetUrl: '',
    intervalSeconds: 300,
    headerDate: 'Transaction Date',
    headerNarration: 'Narration',
    headerRef: 'Transaction Reference',
    headerCredit: 'Credit'
  };

  // --- 1. Tab Navigation (İzleme Ekranı is Default Active) ---
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;
      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      document.getElementById(`tab-${tabName}`).classList.add('active');
    });
  });

  // --- 2. Load Saved Settings into Settings Form ---
  function loadSettings() {
    chrome.storage.local.get(['bankBotSettings'], (result) => {
      const settings = result.bankBotSettings || DEFAULT_SETTINGS;
      inputTargetUrl.value = settings.targetUrl || '';
      inputIntervalSeconds.value = settings.intervalSeconds || 300;
      inputHeaderDate.value = settings.headerDate || DEFAULT_SETTINGS.headerDate;
      inputHeaderNarration.value = settings.headerNarration || DEFAULT_SETTINGS.headerNarration;
      inputHeaderRef.value = settings.headerRef || DEFAULT_SETTINGS.headerRef;
      inputHeaderCredit.value = settings.headerCredit || DEFAULT_SETTINGS.headerCredit;
    });
  }

  loadSettings();

  // Save Settings
  settingsForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const newSettings = {
      targetUrl: inputTargetUrl.value.trim(),
      intervalSeconds: parseInt(inputIntervalSeconds.value, 10) || 10,
      headerDate: inputHeaderDate.value.trim(),
      headerNarration: inputHeaderNarration.value.trim(),
      headerRef: inputHeaderRef.value.trim(),
      headerCredit: inputHeaderCredit.value.trim()
    };

    chrome.storage.local.set({ bankBotSettings: newSettings }, () => {
      showToast(settingsStatus, 'Ayarlar başarıyla kaydedildi!', 'success');
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
      globalBadge.textContent = 'İzleniyor...';
      globalBadge.className = 'badge badge-running';

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

  // Force Read Button (Now Read & Reset Timer)
  btnForceRead.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (!activeTab) return;

      chrome.tabs.sendMessage(activeTab.id, { action: 'FORCE_READ' }, (response) => {
        if (chrome.runtime.lastError) {
          showStatus('Sayfa verileri okunamadı. Sayfayı yenileyip tekrar deneyin.', 'error');
          return;
        }

        if (response && response.success) {
          updateUIFromState(response.state);
          showToast(settingsStatus, 'Veriler anında okundu ve sayaç sıfırlandı.', 'success');
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
          showToast(settingsStatus, 'Tablo ve hafızadaki tüm veriler temizlendi.', 'success');
        }
      });
    });
  });

  // --- Helper Render Functions ---
  function renderTableData(data) {
    if (!data || data.length === 0) {
      resultsBody.innerHTML = `<tr class="empty-row"><td colspan="4">Okunan işlem verisi bulunamadı.</td></tr>`;
      rowCountEl.textContent = '0';
      return;
    }

    rowCountEl.textContent = data.length;
    resultsBody.innerHTML = '';

    data.forEach(item => {
      const tr = document.createElement('tr');
      
      const tdDate = document.createElement('td');
      tdDate.textContent = item.date || '-';
      
      const tdNarration = document.createElement('td');
      tdNarration.textContent = item.narration || '-';
      
      const tdRef = document.createElement('td');
      tdRef.textContent = item.ref || '-';

      const tdCredit = document.createElement('td');
      tdCredit.textContent = item.credit || '-';

      tr.appendChild(tdDate);
      tr.appendChild(tdNarration);
      tr.appendChild(tdRef);
      tr.appendChild(tdCredit);

      resultsBody.appendChild(tr);
    });
  }

  function showToast(element, message, type = 'success') {
    element.textContent = message;
    element.className = `toast ${type}`;
    element.classList.remove('hidden');
    setTimeout(() => {
      element.classList.add('hidden');
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
  const btnConnectSheet = document.getElementById('btn-connect-sheet');

  const connectedSheetInfo = document.getElementById('connected-sheet-info');
  const connectedSheetName = document.getElementById('connected-sheet-name');
  const connectedSheetDate = document.getElementById('connected-sheet-date');
  const btnDisconnectSheet = document.getElementById('btn-disconnect-sheet');
  const sheetsStatus = document.getElementById('sheets-status');

  let isFetchingSheets = false;

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
      // Automatically load spreadsheets when logged in
      loadSpreadsheets();
    } else {
      googleAuthLoggedOut.classList.remove('hidden');
      googleAuthLoggedIn.classList.add('hidden');
      sheetSelectionCard.classList.add('hidden');
      userEmailText.textContent = '--';
    }

    if (sheet && sheet.id) {
      connectedSheetInfo.classList.remove('hidden');
      connectedSheetName.textContent = sheet.name || 'Bilinmeyen Tablo';
      connectedSheetDate.textContent = sheet.connectedAt || '--';
    } else {
      connectedSheetInfo.classList.add('hidden');
      connectedSheetName.textContent = '--';
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
        }
      });
    });
  }

  // Fetch Spreadsheets Function
  function loadSpreadsheets() {
    if (isFetchingSheets) return;
    isFetchingSheets = true;

    const currentVal = sheetsSelect.value;
    
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
    });
  }

  // Refetch spreadsheets every time user opens / interacts with dropdown
  if (sheetsSelect) {
    sheetsSelect.addEventListener('focus', () => {
      loadSpreadsheets();
    });
  }

  // Refresh sheets list button click
  if (btnRefreshSheets) {
    btnRefreshSheets.addEventListener('click', (e) => {
      e.preventDefault();
      loadSpreadsheets();
    });
  }

  // Connect and Validate Sheet
  if (btnConnectSheet) {
    btnConnectSheet.addEventListener('click', () => {
      const selectedId = sheetsSelect.value;
      const selectedOption = sheetsSelect.options[sheetsSelect.selectedIndex];
      const selectedName = selectedOption ? selectedOption.textContent : '';

      if (!selectedId) {
        showToast(sheetsStatus, 'Lütfen bir E-Tablo seçin.', 'error');
        return;
      }

      btnConnectSheet.disabled = true;
      btnConnectSheet.textContent = 'Kolonlar Kontrol Ediliyor...';

      chrome.runtime.sendMessage({
        action: 'VALIDATE_AND_CONNECT_SHEET',
        spreadsheetId: selectedId,
        spreadsheetName: selectedName
      }, (response) => {
        btnConnectSheet.disabled = false;
        btnConnectSheet.textContent = 'Tabloyu Bağla ve Kontrol Et';

        if (response && response.success) {
          showToast(sheetsStatus, 'E-Tablo başarıyla doğrulandı ve bağlandı!', 'success');
          syncGoogleStatus();
        } else {
          const errorMsg = response?.error || 'Tablo doğrulanamadı.';
          showToast(sheetsStatus, errorMsg, 'error');
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
        }
      });
    });
  }
});

