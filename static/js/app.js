/**
 * PikminGPS Web — Main application logic.
 * Connects map, joystick, Socket.IO, and UI controls.
 */
(function () {
  'use strict';

  // ── Initialize components ──
  const mapCtrl = initMap();
  const socket = io();

  const joystickCanvas = initJoystick('joystick',
    function onMove(dx, dy) {
      const speed = parseFloat(document.getElementById('speedInput').value) || 5;
      socket.emit('joystick_move', { dx, dy, speed });
    },
    function onRelease() { /* nothing */ }
  );

  // ── DOM references ──
  const $ = id => document.getElementById(id);
  const btnConnect = $('btnConnect');
  const btnStop = $('btnStop');
  const coordInput = $('coordInput');
  const btnTeleport = $('btnTeleport');
  const deviceLabel = $('deviceLabel');
  const deviceChips = $('deviceChips');
  const connType = $('connType');
  const statusBar = $('statusBar');

  const btnFavSave = $('btnFavSave');
  const btnFavDel = $('btnFavDel');
  const favListEl = $('favList');
  const favTabsEl = $('favTabs');
  const btnFavAddCat = $('btnFavAddCat');
  const favModal = $('favModal');
  const favNameInput = $('favNameInput');
  const favCatSelect = $('favCatSelect');
  const favCatInput = $('favCatInput');
  const btnFavModalCancel = $('btnFavModalCancel');
  const btnFavModalOk = $('btnFavModalOk');

  const historyListEl = $('historyList');
  const btnHistoryClear = $('btnHistoryClear');

  const speedPreset = $('speedPreset');
  const speedInput = $('speedInput');

  const jumpMode = $('jumpMode');
  const jumpPreDelay = $('jumpPreDelay');
  const jumpPostDelay = $('jumpPostDelay');

  const btnNavMode = $('btnNavMode');
  const btnGpxImport = $('btnGpxImport');
  const btnNavPlan = $('btnNavPlan');
  const btnNavStart = $('btnNavStart');
  const btnNavStop = $('btnNavStop');
  const btnNavClear = $('btnNavClear');
  const navInfoLabel = $('navInfoLabel');
  const navRemainingLabel = $('navRemainingLabel');
  const navLoop = $('navLoop');
  const btnCenter = $('btnCenter');

  const randomRadius = $('randomRadius');
  const randomCount = $('randomCount');
  const randomLoop = $('randomLoop');
  const randomLaps = $('randomLaps');
  const btnRandomStart = $('btnRandomStart');
  const btnRandomStop = $('btnRandomStop');
  const btnRandomClear = $('btnRandomClear');
  const randomLabel = $('randomLabel');

  const btnRouteMode = $('btnRouteMode');
  const btnRouteRedraw = $('btnRouteRedraw');
  const btnRouteStart = $('btnRouteStart');
  const btnRouteStop = $('btnRouteStop');
  const btnRouteExport = $('btnRouteExport');
  const routeLoop = $('routeLoop');
  const routeLabel = $('routeLabel');
  const savedRouteListEl = $('savedRouteList');

  const goldDittoAInput = $('goldDittoA');
  const btnGoldDittoStart = $('btnGoldDittoStart');
  const btnGoldDittoUseCurrent = $('btnGoldDittoUseCurrent');
  const btnGoldDittoToggleHide = $('btnGoldDittoToggleHide');

  const deviceModal = $('deviceModal');
  const deviceListModal = $('deviceListModal');
  const btnModalCancel = $('btnModalCancel');
  const coordsModal = $('coordsModal');
  const coordsInput = $('coordsInput');
  const btnCoordsOk = $('btnCoordsOk');
  const btnCoordsCancel = $('btnCoordsCancel');
  const exportModal = $('exportModal');
  const exportOutput = $('exportOutput');
  const btnExportCopy = $('btnExportCopy');
  const btnExportClose = $('btnExportClose');

  // ── State ──
  let connectedDevices = [];   // 多裝置群組：目前已連接的裝置清單
  let maxDevices = 3;
  let lastScannedDevices = [];  // 最近一次掃描結果（供裝置選擇彈窗重繪）
  let favorites = [];
  let selectedFavIdx = -1;
  let selectedCategory = '全部';
  let extraCategories = [];  // 使用者手動新增、尚無座標的分類（僅在本次工作階段）
  let navModeActive = false;
  let routeModeActive = false;
  let routePoints = [];
  let navWaypoints = [];
  let walking = false;

  function setStatus(msg) {
    statusBar.textContent = msg;
  }

  function setActive(btn, active) {
    if (active) btn.classList.add('active');
    else btn.classList.remove('active');
  }

  // ── Initial state fetch ──
  fetch('/api/state')
    .then(r => r.json())
    .then(data => {
      mapCtrl.setPosition(data.lat, data.lng);
      coordInput.value = data.lat.toFixed(6) + ', ' + data.lng.toFixed(6);
      connectedDevices = data.devices || [];
      renderDeviceChips();
      favorites = data.favorites || [];
      renderFavTabs();
      renderFavorites();
      if (data.is_day !== undefined) {
        mapCtrl.setDayNight(data.is_day);
      }
    });

  // ── Map callbacks ──
  mapCtrl.callbacks.onMapClick = function (lat, lng) {
    coordInput.value = lat.toFixed(6) + ', ' + lng.toFixed(6);
    socket.emit('teleport', { lat, lng });
    recordHistory(lat, lng);
  };

  mapCtrl.callbacks.onRoutePoint = function (lat, lng, idx) {
    routePoints.push([lat, lng]);
    routeLabel.textContent = '路徑點: ' + routePoints.length;
  };

  mapCtrl.callbacks.onNavPoint = function (lat, lng, idx) {
    navWaypoints.push([lat, lng]);
    const label = String.fromCharCode(65 + idx);
    navInfoLabel.textContent = '已設定 ' + navWaypoints.length + ' 個路徑點 (' + label + ')';
    if (navWaypoints.length >= 2) {
      btnNavPlan.disabled = false;
    }
  };

  // ── iOS 17+ tunneld ──
  const btnTunneld = $('btnTunneld');

  function refreshTunneldStatus() {
    fetch('/api/tunneld_status').then(r => r.json()).then(d => {
      if (d.running) {
        btnTunneld.textContent = 'iOS 17+ 通道已啟動';
        btnTunneld.disabled = true;
        btnTunneld.classList.add('active');
      } else {
        btnTunneld.textContent = '啟動 iOS 17+ 通道';
        btnTunneld.disabled = false;
        btnTunneld.classList.remove('active');
      }
    }).catch(() => {});
  }

  btnTunneld.addEventListener('click', function () {
    btnTunneld.disabled = true;
    btnTunneld.textContent = '啟動中… 請輸入密碼';
    setStatus('正在啟動 iOS 17+ 通道，請在系統彈窗輸入管理員密碼…');
    fetch('/api/start_tunneld', { method: 'POST' }).then(r => r.json().then(d => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (ok && d.ok) {
          setStatus(d.already_running ? 'iOS 17+ 通道已在執行中' : 'iOS 17+ 通道啟動成功');
        } else {
          setStatus('啟動失敗: ' + (d.error || '未知錯誤'));
        }
        refreshTunneldStatus();
      }).catch(err => {
        setStatus('啟動失敗: ' + err);
        refreshTunneldStatus();
      });
  });

  refreshTunneldStatus();
  setInterval(refreshTunneldStatus, 5000);

  // ── Multi-device group ──
  function isConnected(udid) {
    return connectedDevices.some(function (d) { return d.udid === udid; });
  }

  // 目前群組狀態：更新「連接」按鈕、「全部停止」按鈕與摘要文字
  function updateDeviceUI() {
    const n = connectedDevices.length;
    if (n === 0) {
      deviceLabel.textContent = '尚未連接裝置';
      btnConnect.textContent = '連接 iPhone';
      btnConnect.disabled = false;
      setActive(btnConnect, false);
      btnStop.disabled = true;
    } else {
      deviceLabel.textContent = '群組已連接 ' + n + '/' + maxDevices + ' 台（操作同步）';
      setActive(btnConnect, true);
      btnStop.disabled = false;
      if (n >= maxDevices) {
        btnConnect.textContent = '已達上限 (' + n + '/' + maxDevices + ')';
        btnConnect.disabled = true;
      } else {
        btnConnect.textContent = '新增 iPhone (' + n + '/' + maxDevices + ')';
        btnConnect.disabled = false;
      }
    }
  }

  // 已連接裝置以晶片方式呈現，每個晶片可單獨移除
  function renderDeviceChips() {
    deviceChips.innerHTML = '';
    connectedDevices.forEach(function (d) {
      const name = (d.name && !d.name.startsWith('usbmux-')) ? d.name : (d.model || d.name || 'iPhone');
      const chip = document.createElement('div');
      chip.className = 'device-chip';
      const label = document.createElement('span');
      label.className = 'device-chip-label';
      label.textContent = name + ' · iOS ' + d.ios_version;
      label.title = (d.display || name) + '\nUDID: ' + d.udid;
      chip.appendChild(label);
      const del = document.createElement('button');
      del.className = 'device-chip-del';
      del.textContent = '×';
      del.title = '移除此裝置';
      del.addEventListener('click', function () {
        socket.emit('remove_device', { udid: d.udid });
      });
      chip.appendChild(del);
      deviceChips.appendChild(chip);
    });
    updateDeviceUI();
  }

  // ── Device connection ──
  btnConnect.addEventListener('click', function () {
    if (connectedDevices.length >= maxDevices) {
      setStatus('已達裝置數量上限 (' + maxDevices + ' 台)');
      return;
    }
    btnConnect.disabled = true;
    setStatus('掃描裝置中...');
    socket.emit('connect_device', { conn_type: connType.value });
  });

  // 繪製裝置選擇彈窗（標示已連接、達上限時停用其餘選項）
  function renderDeviceModal() {
    deviceListModal.innerHTML = '';
    const full = connectedDevices.length >= maxDevices;
    lastScannedDevices.forEach(function (d) {
      const name = d.name.startsWith('usbmux-') ? d.model : d.name;
      const div = document.createElement('div');
      div.className = 'device-option';
      const linked = isConnected(d.udid);
      let text = name + ' - iOS ' + d.ios_version + ' (' + d.udid.slice(-8) + ')';
      if (linked) {
        div.classList.add('connected');
        text += '  ✓ 已連接';
      } else if (full) {
        div.classList.add('disabled');
      }
      div.textContent = text;
      if (!linked && !full) {
        div.addEventListener('click', function () {
          setStatus('連線中...');
          socket.emit('select_device', { udid: d.udid, conn_type: connType.value });
        });
      }
      deviceListModal.appendChild(div);
    });
  }

  socket.on('device_list', function (data) {
    lastScannedDevices = data.devices || [];
    if (typeof data.max_devices === 'number') maxDevices = data.max_devices;
    updateDeviceUI();
    renderDeviceModal();
    deviceModal.classList.remove('hidden');
  });

  btnModalCancel.addEventListener('click', function () {
    deviceModal.classList.add('hidden');
    updateDeviceUI();
    setStatus('已關閉裝置選擇');
  });

  // 群組成員變動：伺服器廣播最新已連接裝置清單
  socket.on('devices_updated', function (data) {
    connectedDevices = data.devices || [];
    renderDeviceChips();
    // 若裝置選擇彈窗開著，同步更新已連接標示；達上限則自動關閉
    if (!deviceModal.classList.contains('hidden')) {
      if (connectedDevices.length >= maxDevices) {
        deviceModal.classList.add('hidden');
        setStatus('已達裝置數量上限 (' + maxDevices + ' 台)');
      } else {
        renderDeviceModal();
      }
    }
  });

  socket.on('connect_error_msg', function (data) {
    updateDeviceUI();
    alert(data.error);
    setStatus('連線失敗');
  });

  // Handle the 'connect_error' event name (used by our app)
  socket.on('connect_error', function (data) {
    // Socket.IO built-in connect_error has no .error field
    if (data && data.error) {
      updateDeviceUI();
      alert(data.error);
      setStatus('連線失敗');
    }
  });

  socket.on('disconnected', function () {
    connectedDevices = [];
    renderDeviceChips();
  });

  socket.on('device_disconnected', function (data) {
    setStatus('裝置已斷開連接: ' + (data.error || ''));
  });

  btnStop.addEventListener('click', function () {
    socket.emit('stop_simulation');
    btnStop.disabled = true;
  });

  // ── Teleport ──
  function doTeleport() {
    const text = coordInput.value.replace('\uff0c', ',');
    const parts = text.split(',');
    if (parts.length !== 2) {
      alert('格式錯誤，請輸入: 緯度, 經度');
      return;
    }
    const lat = parseFloat(parts[0].trim());
    const lng = parseFloat(parts[1].trim());
    if (isNaN(lat) || isNaN(lng)) {
      alert('請輸入有效的數字座標');
      return;
    }
    mapCtrl.setPosition(lat, lng);
    socket.emit('teleport', { lat, lng });
    recordHistory(lat, lng);
  }

  btnTeleport.addEventListener('click', doTeleport);
  coordInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') doTeleport();
  });

  // ── Position updates ──
  socket.on('position', function (data) {
    mapCtrl.moveMarker(data.lat, data.lng);
    coordInput.value = data.lat.toFixed(6) + ', ' + data.lng.toFixed(6);
  });

  socket.on('status', function (data) {
    setStatus(data.msg);
  });

  // ── Favorites ──
  // 已存在於座標中的分類
  function favoriteCategories() {
    const seen = [];
    favorites.forEach(function (fav) {
      const cat = fav.category || '未分類';
      if (seen.indexOf(cat) === -1) seen.push(cat);
    });
    return seen;
  }

  // 所有可用分類 = 座標中的分類 + 手動新增的分類
  function allCategories() {
    const cats = favoriteCategories();
    extraCategories.forEach(function (c) {
      if (cats.indexOf(c) === -1) cats.push(c);
    });
    return cats;
  }

  function renderFavTabs() {
    favTabsEl.innerHTML = '';
    const cats = ['全部'].concat(allCategories());
    if (cats.indexOf(selectedCategory) === -1) selectedCategory = '全部';
    cats.forEach(function (cat) {
      const tab = document.createElement('div');
      tab.className = 'fav-tab' + (cat === selectedCategory ? ' active' : '');
      tab.textContent = cat;
      tab.addEventListener('click', function () {
        selectedCategory = cat;
        renderFavTabs();
        renderFavorites();
      });
      // 「全部」不可作為拖曳目標（不是真正的分類）
      if (cat !== '全部') {
        tab.addEventListener('dragover', function (e) {
          e.preventDefault();
          tab.classList.add('drop-target');
        });
        tab.addEventListener('dragleave', function () {
          tab.classList.remove('drop-target');
        });
        tab.addEventListener('drop', function (e) {
          e.preventDefault();
          tab.classList.remove('drop-target');
          const idx = parseInt(e.dataTransfer.getData('text/plain'), 10);
          if (!isNaN(idx)) {
            socket.emit('set_favorite_category', { index: idx, category: cat });
          }
        });
      }
      favTabsEl.appendChild(tab);
    });
  }

  function renderFavorites() {
    favListEl.innerHTML = '';
    favorites.forEach(function (fav, i) {
      const cat = fav.category || '未分類';
      if (selectedCategory !== '全部' && cat !== selectedCategory) return;
      const div = document.createElement('div');
      div.className = 'fav-item' + (i === selectedFavIdx ? ' selected' : '');
      div.textContent = fav.name;
      div.title = '雙擊傳送到此座標，或拖曳到上方分類移動';
      div.draggable = true;
      div.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/plain', String(i));
        e.dataTransfer.effectAllowed = 'move';
      });
      div.addEventListener('click', function () {
        selectedFavIdx = i;
        renderFavorites();
      });
      div.addEventListener('dblclick', function () {
        socket.emit('goto_favorite', { index: i });
        recordHistory(fav.lat, fav.lng);
      });
      favListEl.appendChild(div);
    });
  }

  // ── 儲存地點彈窗（名稱 + 分類下拉選單 / 新分類） ──
  function openFavModal() {
    favNameInput.value = '';
    favCatInput.value = '';
    const cats = allCategories();
    favCatSelect.innerHTML = '';
    if (cats.length === 0) {
      const opt = document.createElement('option');
      opt.value = '未分類';
      opt.textContent = '未分類';
      favCatSelect.appendChild(opt);
    } else {
      cats.forEach(function (c) {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        favCatSelect.appendChild(opt);
      });
    }
    // 預設選中目前的分類標籤
    if (selectedCategory !== '全部' && cats.indexOf(selectedCategory) !== -1) {
      favCatSelect.value = selectedCategory;
    }
    favModal.classList.remove('hidden');
    favNameInput.focus();
  }

  function closeFavModal() {
    favModal.classList.add('hidden');
  }

  // 滑鼠滾輪轉為橫向捲動標籤（觸控板橫向滑動本身已支援）
  favTabsEl.addEventListener('wheel', function (e) {
    if (e.deltaY !== 0 && e.deltaX === 0) {
      favTabsEl.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  }, { passive: false });

  // 滑鼠按住拖曳左右捲動標籤
  let tabDragging = false;
  let tabStartX = 0;
  let tabStartScroll = 0;
  let tabMoved = false;

  favTabsEl.addEventListener('mousedown', function (e) {
    tabDragging = true;
    tabMoved = false;
    tabStartX = e.pageX;
    tabStartScroll = favTabsEl.scrollLeft;
  });

  window.addEventListener('mousemove', function (e) {
    if (!tabDragging) return;
    const dx = e.pageX - tabStartX;
    if (Math.abs(dx) > 3) tabMoved = true;
    favTabsEl.scrollLeft = tabStartScroll - dx;
    e.preventDefault();
  });

  window.addEventListener('mouseup', function () {
    tabDragging = false;
  });

  // 拖曳過就不要觸發標籤點選（切換分類）
  favTabsEl.addEventListener('click', function (e) {
    if (tabMoved) {
      e.stopPropagation();
      e.preventDefault();
      tabMoved = false;
    }
  }, true);

  // 鍵盤左右方向鍵捲動標籤（需先點一下標籤列取得焦點）
  favTabsEl.tabIndex = 0;
  favTabsEl.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft') {
      favTabsEl.scrollLeft -= 60;
      e.preventDefault();
    } else if (e.key === 'ArrowRight') {
      favTabsEl.scrollLeft += 60;
      e.preventDefault();
    }
  });

  btnFavSave.addEventListener('click', openFavModal);
  btnFavModalCancel.addEventListener('click', closeFavModal);

  btnFavModalOk.addEventListener('click', function () {
    const name = favNameInput.value.trim();
    if (!name) {
      favNameInput.focus();
      return;
    }
    // 新輸入的分類優先，否則用下拉選單所選
    const cat = favCatInput.value.trim() || favCatSelect.value || '未分類';
    selectedCategory = cat;
    socket.emit('save_favorite', { name: name, category: cat });
    closeFavModal();
  });

  favNameInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') btnFavModalOk.click();
  });

  // 新增分類按鈕
  btnFavAddCat.addEventListener('click', function () {
    const name = prompt('請輸入新分類名稱:');
    if (!name || !name.trim()) return;
    const cat = name.trim();
    if (extraCategories.indexOf(cat) === -1 && favoriteCategories().indexOf(cat) === -1) {
      extraCategories.push(cat);
    }
    selectedCategory = cat;
    renderFavTabs();
    renderFavorites();
  });

  btnFavDel.addEventListener('click', function () {
    if (selectedFavIdx >= 0) {
      socket.emit('delete_favorite', { index: selectedFavIdx });
      selectedFavIdx = -1;
    }
  });

  socket.on('favorites_updated', function (data) {
    favorites = data.favorites;
    renderFavTabs();
    renderFavorites();
  });

  // ── History coordinates (最多 30 筆傳送紀錄，可回溯) ──
  const HISTORY_KEY = 'pikmingps.history';
  const HISTORY_MAX = 30;
  let history = [];

  try {
    const saved = localStorage.getItem(HISTORY_KEY);
    if (saved) history = JSON.parse(saved) || [];
  } catch (e) { history = []; }

  function saveHistory() {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch (e) { /* ignore */ }
  }

  function formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const p = n => ('0' + n).slice(-2);
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function renderHistory() {
    historyListEl.innerHTML = '';
    if (history.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'fav-item';
      empty.style.color = '#6c7086';
      empty.style.cursor = 'default';
      empty.textContent = '尚無歷史座標';
      historyListEl.appendChild(empty);
      return;
    }
    history.forEach(function (h) {
      const div = document.createElement('div');
      div.className = 'fav-item';
      const time = formatTime(h.t);
      div.textContent = (time ? time + '  ' : '') + h.lat.toFixed(6) + ', ' + h.lng.toFixed(6);
      div.title = '點擊回溯到此座標';
      div.addEventListener('click', function () {
        mapCtrl.setPosition(h.lat, h.lng);
        socket.emit('teleport', { lat: h.lat, lng: h.lng });
        coordInput.value = h.lat.toFixed(6) + ', ' + h.lng.toFixed(6);
        setStatus('已回溯到歷史座標: ' + h.lat.toFixed(6) + ', ' + h.lng.toFixed(6));
      });
      historyListEl.appendChild(div);
    });
  }

  function recordHistory(lat, lng) {
    if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) return;
    // 略過與最新一筆幾乎相同的座標（約 1 公尺內）
    if (history.length > 0) {
      const last = history[0];
      if (Math.abs(last.lat - lat) < 1e-5 && Math.abs(last.lng - lng) < 1e-5) return;
    }
    history.unshift({ lat: lat, lng: lng, t: Date.now() });
    if (history.length > HISTORY_MAX) history = history.slice(0, HISTORY_MAX);
    saveHistory();
    renderHistory();
  }

  btnHistoryClear.addEventListener('click', function () {
    if (history.length === 0) return;
    if (!confirm('確定要清除所有歷史座標嗎？')) return;
    history = [];
    saveHistory();
    renderHistory();
    setStatus('已清除歷史座標');
  });

  renderHistory();

  // ── Speed ──
  speedPreset.addEventListener('change', function () {
    speedInput.value = this.value;
    socket.emit('update_speed', { speed: parseFloat(this.value) });
  });

  speedInput.addEventListener('change', function () {
    socket.emit('update_speed', { speed: parseFloat(this.value) });
  });

  // ── Point-to-point jump ──
  const JUMP_MODE_KEY = 'pikmingps.jump.mode';
  const JUMP_PRE_KEY = 'pikmingps.jump.pre';
  const JUMP_POST_KEY = 'pikmingps.jump.post';

  try {
    if (localStorage.getItem(JUMP_MODE_KEY) === '1') jumpMode.checked = true;
    const pre = localStorage.getItem(JUMP_PRE_KEY);
    const post = localStorage.getItem(JUMP_POST_KEY);
    if (pre !== null) jumpPreDelay.value = pre;
    if (post !== null) jumpPostDelay.value = post;
  } catch (e) { /* ignore */ }

  jumpMode.addEventListener('change', function () {
    try { localStorage.setItem(JUMP_MODE_KEY, jumpMode.checked ? '1' : '0'); } catch (e) { /* ignore */ }
  });
  jumpPreDelay.addEventListener('change', function () {
    try { localStorage.setItem(JUMP_PRE_KEY, jumpPreDelay.value); } catch (e) { /* ignore */ }
  });
  jumpPostDelay.addEventListener('change', function () {
    try { localStorage.setItem(JUMP_POST_KEY, jumpPostDelay.value); } catch (e) { /* ignore */ }
  });

  function getJumpParams() {
    return {
      jump_mode: jumpMode.checked,
      jump_pre_delay: parseFloat(jumpPreDelay.value) || 0,
      jump_post_delay: parseFloat(jumpPostDelay.value) || 0,
    };
  }

  // ── Navigation ──
  btnNavMode.addEventListener('click', function () {
    if (navModeActive) {
      navModeActive = false;
      btnNavMode.textContent = '導航規劃';
      setActive(btnNavMode, false);
      mapCtrl.setNavMode(false);
      setStatus('已退出導航模式');
    } else {
      navModeActive = true;
      btnNavMode.textContent = '停止設點';
      setActive(btnNavMode, true);
      navWaypoints = [];
      mapCtrl.clearNav();
      mapCtrl.setNavMode(true);
      btnNavPlan.disabled = true;
      btnNavClear.disabled = false;
      navInfoLabel.textContent = '點擊地圖設定路徑點 (A\u2192B\u2192C...)';
      navRemainingLabel.textContent = '';
      setStatus('導航模式: 在地圖上點擊設定路徑點');
    }
  });

  btnNavPlan.addEventListener('click', function () {
    if (navWaypoints.length < 2) return;
    btnNavPlan.disabled = true;
    navInfoLabel.textContent = '規劃路線中... (請稍候)';
    const speed = parseFloat(speedInput.value) || 5;
    socket.emit('plan_nav_route', { waypoints: navWaypoints, speed });
  });

  socket.on('nav_route_ready', function (data) {
    navInfoLabel.textContent = '總距離: ' + data.dist_text + '\n預估時間: ' + data.time_text;
    mapCtrl.drawNavRoute(data.points);
    mapCtrl.updateNavInfo(data.dist_text + ' | ' + data.time_text);
    saveRoute(data.points, 'nav');

    btnNavStart.disabled = false;
    btnNavPlan.disabled = false;
    btnNavClear.disabled = false;

    navModeActive = false;
    btnNavMode.textContent = '導航規劃';
    setActive(btnNavMode, false);
    mapCtrl.setNavMode(false);

    setStatus('路線規劃完成: ' + data.dist_text + ', 預估 ' + data.time_text);
  });

  socket.on('nav_error', function (data) {
    btnNavPlan.disabled = false;
    navInfoLabel.textContent = '路線規劃失敗: ' + data.error;
    alert('路線規劃失敗:\n' + data.error);
  });

  socket.on('nav_eta_update', function (data) {
    mapCtrl.updateNavInfo(data.dist_text + ' | ' + data.time_text);
  });

  btnNavStart.addEventListener('click', function () {
    const speed = parseFloat(speedInput.value) || 5;
    const loop = navLoop.checked;
    socket.emit('start_walk', Object.assign({ speed, loop }, getJumpParams()));
    btnNavStart.disabled = true;
    btnNavStop.disabled = false;
    setActive(btnNavStart, true);
    btnNavPlan.disabled = true;
    walking = true;
    mapCtrl.setAutoFollow(false);
    setStatus('導航行走已開始');
  });

  btnNavStop.addEventListener('click', function () {
    socket.emit('stop_walk');
    btnNavStart.disabled = false;
    btnNavStop.disabled = true;
    setActive(btnNavStart, false);
    btnNavPlan.disabled = false;
    walking = false;
    navRemainingLabel.textContent = '';
    mapCtrl.setAutoFollow(true);
    mapCtrl.updateNavInfo('');
    setStatus('導航行走已停止');
  });

  btnNavClear.addEventListener('click', function () {
    socket.emit('stop_walk');
    navModeActive = false;
    btnNavMode.textContent = '導航規劃';
    setActive(btnNavMode, false);
    navWaypoints = [];
    btnNavPlan.disabled = true;
    btnNavStart.disabled = true;
    btnNavStop.disabled = true;
    btnNavClear.disabled = true;
    navInfoLabel.textContent = '點擊「導航規劃」設定路徑點';
    navRemainingLabel.textContent = '';
    walking = false;
    mapCtrl.clearNav();
    mapCtrl.setNavMode(false);
    mapCtrl.setAutoFollow(true);
    mapCtrl.updateNavInfo('');
    setStatus('已清除導航路線');
  });

  // Paste coordinates
  btnGpxImport.addEventListener('click', function () {
    coordsModal.classList.remove('hidden');
    coordsInput.focus();
  });

  btnCoordsCancel.addEventListener('click', function () {
    coordsModal.classList.add('hidden');
  });

  btnCoordsOk.addEventListener('click', function () {
    const text = coordsInput.value.trim();
    if (!text) {
      alert('請先貼上座標');
      return;
    }
    const speed = parseFloat(speedInput.value) || 5;
    socket.emit('import_coords', {
      content: text,
      speed: speed,
    });
    coordsModal.classList.add('hidden');
  });

  btnCenter.addEventListener('click', function () {
    mapCtrl.centerOnMarker();
  });

  // ── Random walk (隨機散步) ──
  const RANDOM_RADIUS_KEY = 'pikmingps.random.radius';
  const RANDOM_COUNT_KEY = 'pikmingps.random.count';
  const RANDOM_LOOP_KEY = 'pikmingps.random.loop';
  const RANDOM_LAPS_KEY = 'pikmingps.random.laps';

  try {
    const r = localStorage.getItem(RANDOM_RADIUS_KEY);
    const c = localStorage.getItem(RANDOM_COUNT_KEY);
    const l = localStorage.getItem(RANDOM_LAPS_KEY);
    if (r !== null) randomRadius.value = r;
    if (c !== null) randomCount.value = c;
    if (l !== null) randomLaps.value = l;
    if (localStorage.getItem(RANDOM_LOOP_KEY) === '1') randomLoop.checked = true;
  } catch (e) { /* ignore */ }

  // 「自動循環散步」與「繞幾圈」只能選其一：勾選循環時停用圈數輸入。
  function syncRandomMode() {
    randomLaps.disabled = randomLoop.checked;
  }
  syncRandomMode();

  randomRadius.addEventListener('change', function () {
    try { localStorage.setItem(RANDOM_RADIUS_KEY, randomRadius.value); } catch (e) { /* ignore */ }
  });
  randomCount.addEventListener('change', function () {
    try { localStorage.setItem(RANDOM_COUNT_KEY, randomCount.value); } catch (e) { /* ignore */ }
  });
  randomLaps.addEventListener('change', function () {
    try { localStorage.setItem(RANDOM_LAPS_KEY, randomLaps.value); } catch (e) { /* ignore */ }
  });
  randomLoop.addEventListener('change', function () {
    syncRandomMode();
    try { localStorage.setItem(RANDOM_LOOP_KEY, randomLoop.checked ? '1' : '0'); } catch (e) { /* ignore */ }
  });

  btnRandomStart.addEventListener('click', function () {
    const radius = parseFloat(randomRadius.value) || 300;
    const count = parseInt(randomCount.value, 10) || 5;
    if (radius <= 0 || count <= 0) {
      alert('方圓公尺與點數都要大於 0');
      return;
    }
    const speed = parseFloat(speedInput.value) || 5;
    const loop = randomLoop.checked;
    const laps = parseInt(randomLaps.value, 10) || 1;
    socket.emit('random_walk', Object.assign({ radius, count, speed, loop, laps }, getJumpParams()));
    btnRandomStart.disabled = true;
    btnRandomStop.disabled = false;
    setActive(btnRandomStart, true);
    walking = true;
    mapCtrl.setAutoFollow(false);
    randomLabel.textContent = '產生隨機路線中...';
    setStatus('隨機散步：產生路線中...');
  });

  btnRandomStop.addEventListener('click', function () {
    socket.emit('stop_walk');
    btnRandomStart.disabled = false;
    btnRandomStop.disabled = true;
    setActive(btnRandomStart, false);
    walking = false;
    navRemainingLabel.textContent = '';
    mapCtrl.setAutoFollow(true);
    mapCtrl.updateNavInfo('');
    setStatus('隨機散步已停止');
  });

  btnRandomClear.addEventListener('click', function () {
    socket.emit('stop_walk');
    btnRandomStart.disabled = false;
    btnRandomStop.disabled = true;
    setActive(btnRandomStart, false);
    walking = false;
    navRemainingLabel.textContent = '';
    mapCtrl.clearNav();
    mapCtrl.setAutoFollow(true);
    mapCtrl.updateNavInfo('');
    randomLabel.textContent = '以目前位置為中心，隨機產生數個點並自動導航散步。';
    setStatus('已清除散步路徑');
  });

  socket.on('random_walk_ready', function (data) {
    mapCtrl.clearNav();
    mapCtrl.drawNavRoute(data.points);
    mapCtrl.updateNavInfo(data.dist_text + ' | ' + data.time_text);
    randomLabel.textContent = '方圓 ' + Math.round(data.radius) + ' 公尺內 ' + data.count +
      ' 個點 · 總距離 ' + data.dist_text + ' · 預估 ' + data.time_text;
    setStatus('隨機散步已開始：' + data.count + ' 個點');
  });

  // ── Manual Route ──
  btnRouteMode.addEventListener('click', function () {
    if (!routeModeActive) {
      routeModeActive = true;
      btnRouteMode.textContent = '完成路線';
      setActive(btnRouteMode, true);
      routePoints = [];
      btnRouteRedraw.disabled = true;
      mapCtrl.setRouteMode(true);
      routeLabel.textContent = '點擊地圖新增路徑點...';
      btnRouteStart.disabled = true;
      setStatus('路線模式: 在地圖上點擊新增路徑點');
    } else {
      routeModeActive = false;
      btnRouteMode.textContent = '繪製路線';
      setActive(btnRouteMode, false);
      mapCtrl.setRouteMode(false);
      routePoints = mapCtrl.getRoutePoints();
      if (routePoints.length >= 2) {
        btnRouteStart.disabled = false;
        btnRouteRedraw.disabled = false;
        btnRouteExport.disabled = false;
        routeLabel.textContent = '路線: ' + routePoints.length + ' 個路徑點';
        saveRoute(routePoints, 'manual');
      } else {
        routeLabel.textContent = '至少需要 2 個路徑點';
      }
      setStatus('路線繪製完成');
    }
  });

  btnRouteRedraw.addEventListener('click', function () {
    socket.emit('stop_walk');
    routePoints = [];
    btnRouteRedraw.disabled = true;
    btnRouteStart.disabled = true;
    btnRouteExport.disabled = true;
    routeModeActive = true;
    btnRouteMode.textContent = '完成路線';
    setActive(btnRouteMode, true);
    mapCtrl.setRouteMode(true);
    routeLabel.textContent = '點擊地圖新增路徑點...';
    setStatus('重新繪製路線');
  });

  btnRouteStart.addEventListener('click', function () {
    if (routePoints.length < 2) return;
    const speed = parseFloat(speedInput.value) || 5;
    const loop = routeLoop.checked;
    socket.emit('start_walk', Object.assign({ points: routePoints, speed, loop }, getJumpParams()));
    btnRouteStart.disabled = true;
    btnRouteStop.disabled = false;
    setActive(btnRouteStop, true);
    walking = true;
    mapCtrl.setAutoFollow(false);
    setStatus('路線行走已開始');
  });

  btnRouteStop.addEventListener('click', function () {
    socket.emit('stop_walk');
    btnRouteStart.disabled = routePoints.length < 2;
    btnRouteStop.disabled = true;
    setActive(btnRouteStop, false);
    walking = false;
    navRemainingLabel.textContent = '';
    mapCtrl.setAutoFollow(true);
    mapCtrl.updateNavInfo('');
    setStatus('路線行走已停止');
  });

  btnRouteExport.addEventListener('click', function () {
    if (routePoints.length < 1) return;
    exportOutput.value = routePoints
      .map(function (p) { return p[0] + ',' + p[1]; })
      .join('\n');
    exportModal.classList.remove('hidden');
  });

  btnExportCopy.addEventListener('click', function () {
    exportOutput.select();
    if (navigator.clipboard) {
      navigator.clipboard.writeText(exportOutput.value)
        .then(function () { setStatus('座標已複製'); })
        .catch(function () { document.execCommand('copy'); setStatus('座標已複製'); });
    } else {
      document.execCommand('copy');
      setStatus('座標已複製');
    }
  });

  btnExportClose.addEventListener('click', function () {
    exportModal.classList.add('hidden');
  });

  // ── Saved routes (自動儲存最近 5 條手動 / 導航路線) ──
  const SAVED_ROUTES_KEY = 'pikmingps.savedroutes';
  const SAVED_ROUTES_MAX = 5;
  let savedRoutes = [];

  try {
    const raw = localStorage.getItem(SAVED_ROUTES_KEY);
    if (raw) savedRoutes = JSON.parse(raw) || [];
  } catch (e) { savedRoutes = []; }

  function persistSavedRoutes() {
    try { localStorage.setItem(SAVED_ROUTES_KEY, JSON.stringify(savedRoutes)); } catch (e) { /* ignore */ }
  }

  // type: 'manual'（手動路線）或 'nav'（導航路線）
  function saveRoute(points, type) {
    if (!points || points.length < 2) return;
    const snapshot = points.map(function (p) { return [p[0], p[1]]; });
    // 略過與最新一筆完全相同的路線
    if (savedRoutes.length > 0 &&
        savedRoutes[0].type === type &&
        JSON.stringify(savedRoutes[0].points) === JSON.stringify(snapshot)) {
      return;
    }
    savedRoutes.unshift({ points: snapshot, type: type === 'nav' ? 'nav' : 'manual', t: Date.now() });
    if (savedRoutes.length > SAVED_ROUTES_MAX) savedRoutes = savedRoutes.slice(0, SAVED_ROUTES_MAX);
    persistSavedRoutes();
    renderSavedRoutes();
  }

  // 把一整條路線縮放成小縮圖（北方朝上），起點綠、終點紅
  // 導航路線用綠線、手動路線用藍線，與地圖上一致
  function makeRouteThumb(points, isNav) {
    const W = 104, H = 56, pad = 6;
    const lineColor = isNav ? '#00d977' : '#89b4fa';
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    points.forEach(function (p) {
      if (p[0] < minLat) minLat = p[0];
      if (p[0] > maxLat) maxLat = p[0];
      if (p[1] < minLng) minLng = p[1];
      if (p[1] > maxLng) maxLng = p[1];
    });
    const rangeLat = (maxLat - minLat) || 1e-9;
    const rangeLng = (maxLng - minLng) || 1e-9;
    const scale = Math.min((W - 2 * pad) / rangeLng, (H - 2 * pad) / rangeLat);
    const offX = (W - rangeLng * scale) / 2;
    const offY = (H - rangeLat * scale) / 2;
    const coords = points.map(function (p) {
      const x = offX + (p[1] - minLng) * scale;
      const y = H - offY - (p[0] - minLat) * scale; // 翻轉緯度，北方朝上
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
    const first = coords[0].split(',');
    const last = coords[coords.length - 1].split(',');
    return '<svg class="route-thumb" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">' +
      '<polyline points="' + coords.join(' ') + '" fill="none" stroke="' + lineColor + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<circle cx="' + first[0] + '" cy="' + first[1] + '" r="3" fill="#a6e3a1"/>' +
      '<circle cx="' + last[0] + '" cy="' + last[1] + '" r="3" fill="#f38ba8"/>' +
      '</svg>';
  }

  function renderSavedRoutes() {
    savedRouteListEl.innerHTML = '';
    if (savedRoutes.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'info-label';
      empty.style.margin = '0';
      empty.textContent = '完成手動或導航路線後會自動存於此（最多 5 條）';
      savedRouteListEl.appendChild(empty);
      return;
    }
    savedRoutes.forEach(function (r, i) {
      const isNav = r.type === 'nav';
      const item = document.createElement('div');
      item.className = 'saved-route-item';
      item.title = '點擊載入此路線到地圖';
      item.innerHTML = makeRouteThumb(r.points, isNav);

      const badge = document.createElement('span');
      badge.className = 'saved-route-badge ' + (isNav ? 'nav' : 'manual');
      badge.textContent = isNav ? '導航' : '手動';
      item.appendChild(badge);

      const meta = document.createElement('div');
      meta.className = 'saved-route-meta';
      const time = formatTime(r.t);
      meta.innerHTML = '<span>' + r.points.length + ' 點</span>' +
        (time ? '<span class="saved-route-time">' + time + '</span>' : '');
      item.appendChild(meta);

      const del = document.createElement('button');
      del.className = 'saved-route-del';
      del.textContent = '×';
      del.title = '刪除此路線';
      del.addEventListener('click', function (e) {
        e.stopPropagation();
        savedRoutes.splice(i, 1);
        persistSavedRoutes();
        renderSavedRoutes();
      });
      item.appendChild(del);

      item.addEventListener('click', function () {
        loadSavedRoute(r.points, isNav);
      });
      savedRouteListEl.appendChild(item);
    });
  }

  // 把已存路線載回地圖（統一放進「手動路線」的路徑，可直接按「開始」行走）
  function loadSavedRoute(points, isNav) {
    socket.emit('stop_walk');
    routeModeActive = false;
    btnRouteMode.textContent = '繪製路線';
    setActive(btnRouteMode, false);
    mapCtrl.setRouteMode(false);
    routePoints = mapCtrl.loadRoute(points, isNav);
    btnRouteStart.disabled = routePoints.length < 2;
    btnRouteStop.disabled = true;
    setActive(btnRouteStop, false);
    btnRouteRedraw.disabled = false;
    btnRouteExport.disabled = routePoints.length < 1;
    walking = false;
    const kind = isNav ? '導航' : '手動';
    routeLabel.textContent = '已載入' + kind + '路線: ' + routePoints.length + ' 個路徑點';
    setStatus('已載入' + kind + '路線（可在地圖上縮放檢視，按「開始」即可行走）');
  }

  renderSavedRoutes();

  // ── Walk events ──
  socket.on('walk_started', function () {
    walking = true;
  });

  socket.on('walk_stopped', function () {
    walking = false;
  });

  socket.on('walk_progress', function (data) {
    routeLabel.textContent = '行走中: 第 ' + data.current + '/' + data.total + ' 段';
  });

  socket.on('walk_remaining', function (data) {
    const text = '剩餘: ' + data.dist_text + ' | 約 ' + data.time_text;
    navRemainingLabel.textContent = text;
    mapCtrl.updateNavInfo(text);
  });

  socket.on('walk_finished', function () {
    walking = false;
    btnNavStart.disabled = false;
    btnNavStop.disabled = true;
    setActive(btnNavStart, false);
    btnRouteStart.disabled = routePoints.length < 2;
    btnRouteStop.disabled = true;
    setActive(btnRouteStop, false);
    btnRandomStart.disabled = false;
    btnRandomStop.disabled = true;
    setActive(btnRandomStart, false);
    navRemainingLabel.textContent = '行走完成';
    mapCtrl.updateNavInfo('行走完成');
    mapCtrl.setAutoFollow(true);
    setStatus('路線行走完成');
  });

  // ── Gold Ditto (拉金盆) ──
  const GD_A_KEY = 'pikmingps.goldditto.a';
  const GD_HIDDEN_KEY = 'pikmingps.goldditto.a_hidden';
  const GD_COLLAPSED_KEY = 'pikmingps.goldditto.collapsed';

  // Collapsible group
  const goldDittoGroup = $('goldDittoGroup');
  const goldDittoToggle = $('goldDittoToggle');
  if (goldDittoGroup && goldDittoToggle) {
    try {
      // Collapsed by default to save space; expand only if the user chose to.
      if (localStorage.getItem(GD_COLLAPSED_KEY) === '0') {
        goldDittoGroup.classList.remove('collapsed');
      }
    } catch (e) { /* ignore */ }
    goldDittoToggle.addEventListener('click', function () {
      const collapsed = goldDittoGroup.classList.toggle('collapsed');
      try { localStorage.setItem(GD_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch (e) { /* ignore */ }
    });
  }

  try {
    const saved = localStorage.getItem(GD_A_KEY);
    if (saved) goldDittoAInput.value = saved;
  } catch (e) { /* ignore */ }

  let goldDittoHidden = false;
  try {
    goldDittoHidden = localStorage.getItem(GD_HIDDEN_KEY) === '1';
  } catch (e) { /* ignore */ }
  applyGoldDittoHidden();

  function applyGoldDittoHidden() {
    goldDittoAInput.type = goldDittoHidden ? 'password' : 'text';
    btnGoldDittoToggleHide.textContent = goldDittoHidden ? '🙈' : '👁';
    btnGoldDittoToggleHide.title = goldDittoHidden ? '顯示座標' : '隱藏座標';
  }

  goldDittoAInput.addEventListener('input', function () {
    try { localStorage.setItem(GD_A_KEY, goldDittoAInput.value); } catch (e) { /* ignore */ }
  });

  btnGoldDittoToggleHide.addEventListener('click', function () {
    goldDittoHidden = !goldDittoHidden;
    try { localStorage.setItem(GD_HIDDEN_KEY, goldDittoHidden ? '1' : '0'); } catch (e) { /* ignore */ }
    applyGoldDittoHidden();
  });

  btnGoldDittoUseCurrent.addEventListener('click', function () {
    const text = coordInput.value.trim();
    if (text) {
      goldDittoAInput.value = text;
      try { localStorage.setItem(GD_A_KEY, text); } catch (e) { /* ignore */ }
      setStatus('已將目前位置設為 A 座標');
    }
  });

  function parseLatLng(text) {
    if (!text) return null;
    const parts = text.replace('，', ',').split(',');
    if (parts.length !== 2) return null;
    const lat = parseFloat(parts[0].trim());
    const lng = parseFloat(parts[1].trim());
    if (isNaN(lat) || isNaN(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
  }

  let goldDittoTimer = null;

  btnGoldDittoStart.addEventListener('click', function () {
    const text = goldDittoAInput.value.trim();
    if (!text) {
      alert('請先設定 A 座標');
      goldDittoAInput.focus();
      return;
    }
    const coord = parseLatLng(text);
    if (!coord) {
      alert('A 座標格式有誤\n請輸入: 緯度, 經度 (例: 25.034897, 121.545827)');
      goldDittoAInput.focus();
      return;
    }
    btnGoldDittoStart.disabled = true;
    setActive(btnGoldDittoStart, true);
    setStatus('拉金盆執行中...');
    socket.emit('goldditto_cycle', { lat: coord.lat, lng: coord.lng });
    if (goldDittoTimer) clearTimeout(goldDittoTimer);
    goldDittoTimer = setTimeout(function () {
      btnGoldDittoStart.disabled = false;
      setActive(btnGoldDittoStart, false);
    }, 8000);
  });

  function releaseGoldDittoButton() {
    if (goldDittoTimer) { clearTimeout(goldDittoTimer); goldDittoTimer = null; }
    btnGoldDittoStart.disabled = false;
    setActive(btnGoldDittoStart, false);
  }

  socket.on('goldditto_phase', function (data) {
    if (data.phase === 'restored') releaseGoldDittoButton();
  });

  socket.on('status', function (data) {
    if (data && typeof data.msg === 'string' && data.msg.indexOf('拉金盆失敗') === 0) {
      releaseGoldDittoButton();
    }
  });

  // ── Keyboard joystick ──
  const keysHeld = new Set();

  function getKeyDirection() {
    let dx = 0, dy = 0;
    if (keysHeld.has('ArrowUp')) dy = 1;
    if (keysHeld.has('ArrowDown')) dy = -1;
    if (keysHeld.has('ArrowLeft')) dx = -1;
    if (keysHeld.has('ArrowRight')) dx = 1;
    if (dx && dy) { dx *= 0.707; dy *= 0.707; }
    return { dx, dy };
  }

  let keyInterval = null;

  document.addEventListener('keydown', function (e) {
    // Don't capture when typing in inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      if (e.repeat) return;
      keysHeld.add(e.key);
      const { dx, dy } = getKeyDirection();
      joystickCanvas._setKnobDirection(dx, dy);
      if (!keyInterval) {
        keyInterval = setInterval(function () {
          const dir = getKeyDirection();
          if (Math.abs(dir.dx) > 0 || Math.abs(dir.dy) > 0) {
            const speed = parseFloat(speedInput.value) || 5;
            socket.emit('joystick_move', { dx: dir.dx, dy: dir.dy, speed });
          }
        }, 100);
      }
    }
  });

  document.addEventListener('keyup', function (e) {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      keysHeld.delete(e.key);
      const { dx, dy } = getKeyDirection();
      joystickCanvas._setKnobDirection(dx, dy);
      if (keysHeld.size === 0 && keyInterval) {
        clearInterval(keyInterval);
        keyInterval = null;
      }
    }
  });

  // ── Day/night check every 60s ──
  setInterval(function () {
    socket.emit('check_daynight');
  }, 60000);

  socket.on('daynight', function (data) {
    mapCtrl.setDayNight(data.is_day);
  });

})();
