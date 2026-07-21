document.addEventListener('DOMContentLoaded', () => {
  // Navigation & Tab Elements
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const globalBadge = document.getElementById('global-status-badge');

  // Tracking Screen Controls
  const btnToggleTracking = document.getElementById('btn-toggle-tracking');
  const btnToggleText = document.getElementById('btn-toggle-text');
  const btnForceRead = document.getElementById('btn-force-read');
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
    intervalSeconds: 10,
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
      inputIntervalSeconds.value = settings.intervalSeconds || 10;
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

  // --- 3. Initial State Fetch & Sync ---
  function syncStateWithActiveTab() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (!activeTab) {
        fallbackToStorageState();
        return;
      }

      chrome.tabs.sendMessage(activeTab.id, { action: 'GET_STATE' }, (response) => {
        if (chrome.runtime.lastError || !response || !response.success) {
          // Content script not loaded or page not supported yet
          fallbackToStorageState();
          return;
        }

        updateUIFromState(response.state);
      });
    });
  }

  function fallbackToStorageState() {
    chrome.storage.local.get(['bankBotTrackingState'], (result) => {
      if (result.bankBotTrackingState) {
        updateUIFromState(result.bankBotTrackingState);
      }
    });
  }

  syncStateWithActiveTab();

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
});
