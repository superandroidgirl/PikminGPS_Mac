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
  const connType = $('connType');
  const statusBar = $('statusBar');

  const btnFavSave = $('btnFavSave');
  const btnFavDel = $('btnFavDel');
  const favListEl = $('favList');

  const speedPreset = $('speedPreset');
  const speedInput = $('speedInput');

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

  const btnRouteMode = $('btnRouteMode');
  const btnRouteRedraw = $('btnRouteRedraw');
  const btnRouteStart = $('btnRouteStart');
  const btnRouteStop = $('btnRouteStop');
  const routeLoop = $('routeLoop');
  const routeLabel = $('routeLabel');

  const goldDittoAInput = $('goldDittoA');
  const btnGoldDittoStart = $('btnGoldDittoStart');
  const btnGoldDittoUseCurrent = $('btnGoldDittoUseCurrent');
  const btnGoldDittoToggleHide = $('btnGoldDittoToggleHide');

  const deviceModal = $('deviceModal');
  const deviceListModal = $('deviceListModal');
  const btnModalCancel = $('btnModalCancel');
  const gpxFileInput = $('gpxFileInput');

  // ── State ──
  let favorites = [];
  let selectedFavIdx = -1;
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
      favorites = data.favorites || [];
      renderFavorites();
      if (data.is_day !== undefined) {
        mapCtrl.setDayNight(data.is_day);
      }
    });

  // ── Map callbacks ──
  mapCtrl.callbacks.onMapClick = function (lat, lng) {
    coordInput.value = lat.toFixed(6) + ', ' + lng.toFixed(6);
    socket.emit('teleport', { lat, lng });
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

  // ── Device connection ──
  btnConnect.addEventListener('click', function () {
    btnConnect.disabled = true;
    setStatus('掃描裝置中...');
    socket.emit('connect_device', { conn_type: connType.value });
  });

  socket.on('device_list', function (data) {
    btnConnect.disabled = false;
    const devices = data.devices;
    deviceListModal.innerHTML = '';
    devices.forEach(function (d, i) {
      const name = d.name.startsWith('usbmux-') ? d.model : d.name;
      const div = document.createElement('div');
      div.className = 'device-option';
      div.textContent = name + ' \u2014 iOS ' + d.ios_version + ' (' + d.udid.slice(-8) + ')';
      div.addEventListener('click', function () {
        deviceModal.classList.add('hidden');
        setStatus('連線中...');
        socket.emit('select_device', { udid: d.udid, conn_type: connType.value });
      });
      deviceListModal.appendChild(div);
    });
    deviceModal.classList.remove('hidden');
  });

  btnModalCancel.addEventListener('click', function () {
    deviceModal.classList.add('hidden');
    btnConnect.disabled = false;
    setStatus('已取消連線');
  });

  socket.on('connected', function (data) {
    btnConnect.disabled = false;
    btnConnect.textContent = '重新連接';
    setActive(btnConnect, true);
    btnStop.disabled = false;
    deviceLabel.textContent = data.display;
    setStatus('已連接: ' + data.display);
  });

  socket.on('connect_error_msg', function (data) {
    btnConnect.disabled = false;
    alert(data.error);
    setStatus('連線失敗');
  });

  // Handle the 'connect_error' event name (used by our app)
  socket.on('connect_error', function (data) {
    // Socket.IO built-in connect_error has no .error field
    if (data && data.error) {
      btnConnect.disabled = false;
      alert(data.error);
      setStatus('連線失敗');
    }
  });

  socket.on('disconnected', function () {
    deviceLabel.textContent = '尚未連接裝置';
    btnStop.disabled = true;
    btnConnect.textContent = '連接 iPhone';
    setActive(btnConnect, false);
  });

  socket.on('device_disconnected', function (data) {
    deviceLabel.textContent = '裝置已斷開: ' + (data.error || '');
    btnStop.disabled = true;
    btnConnect.textContent = '連接 iPhone';
    setActive(btnConnect, false);
    setStatus('裝置已斷開連接');
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
  function renderFavorites() {
    favListEl.innerHTML = '';
    favorites.forEach(function (fav, i) {
      const div = document.createElement('div');
      div.className = 'fav-item' + (i === selectedFavIdx ? ' selected' : '');
      div.textContent = fav.name + '  (' + fav.lat.toFixed(6) + ', ' + fav.lng.toFixed(6) + ')';
      div.addEventListener('click', function () {
        selectedFavIdx = i;
        renderFavorites();
      });
      div.addEventListener('dblclick', function () {
        socket.emit('goto_favorite', { index: i });
      });
      favListEl.appendChild(div);
    });
  }

  btnFavSave.addEventListener('click', function () {
    const name = prompt('請輸入名稱:');
    if (name && name.trim()) {
      socket.emit('save_favorite', { name: name.trim() });
    }
  });

  btnFavDel.addEventListener('click', function () {
    if (selectedFavIdx >= 0) {
      socket.emit('delete_favorite', { index: selectedFavIdx });
      selectedFavIdx = -1;
    }
  });

  socket.on('favorites_updated', function (data) {
    favorites = data.favorites;
    renderFavorites();
  });

  // ── Speed ──
  speedPreset.addEventListener('change', function () {
    speedInput.value = this.value;
    socket.emit('update_speed', { speed: parseFloat(this.value) });
  });

  speedInput.addEventListener('change', function () {
    socket.emit('update_speed', { speed: parseFloat(this.value) });
  });

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
    socket.emit('start_walk', { speed, loop });
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

  // GPX import
  btnGpxImport.addEventListener('click', function () {
    gpxFileInput.click();
  });

  gpxFileInput.addEventListener('change', function () {
    const file = this.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
      const speed = parseFloat(speedInput.value) || 5;
      socket.emit('import_gpx', {
        content: e.target.result,
        filename: file.name,
        speed: speed,
      });
    };
    reader.readAsText(file);
    this.value = '';
  });

  btnCenter.addEventListener('click', function () {
    mapCtrl.centerOnMarker();
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
        routeLabel.textContent = '路線: ' + routePoints.length + ' 個路徑點';
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
    socket.emit('start_walk', { points: routePoints, speed, loop });
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
    navRemainingLabel.textContent = '行走完成';
    mapCtrl.updateNavInfo('行走完成');
    mapCtrl.setAutoFollow(true);
    setStatus('路線行走完成');
  });

  // ── Gold Ditto (拉金盆) ──
  const GD_A_KEY = 'pikmingps.goldditto.a';
  const GD_HIDDEN_KEY = 'pikmingps.goldditto.a_hidden';

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
