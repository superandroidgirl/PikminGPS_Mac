/**
 * Leaflet map initialization and helpers.
 * Exports: initMap()
 */
function initMap() {
  const map = L.map('map', {
    center: [25.0330, 121.5654],
    zoom: 16,
    zoomControl: false,
    maxBounds: [[-90, -180], [90, 180]],
    maxBoundsViscosity: 1.0,
  });

  const dayLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
    noWrap: true,
  });

  const nightLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    attribution: '&copy; CartoDB',
    noWrap: true,
  });

  let currentLayer = dayLayer;
  currentLayer.addTo(map);
  let isNightMode = false;

  L.control.zoom({ position: 'topright' }).addTo(map);

  // Main position marker
  const defaultMarkerHtml = '<div class="marker-default"><div class="glow"></div><div class="dot"></div></div>';

  function makeIcon() {
    return L.divIcon({
      className: '',
      html: defaultMarkerHtml,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });
  }

  const marker = L.marker([25.0330, 121.5654], {
    draggable: true,
    icon: makeIcon(),
  }).addTo(map);

  let autoFollow = true;

  // Route drawing state
  let routeMode = false;
  let routePoints = [];
  let routeLine = null;
  let routeMarkers = [];

  // Navigation state
  let navMode = false;
  let navWaypoints = [];
  let navMarkers = [];
  let navRouteLine = null;

  // Info box
  const infoEl = document.getElementById('info');
  function updateInfo(lat, lng) {
    infoEl.textContent = 'Lat: ' + lat.toFixed(6) + ' | Lng: ' + lng.toFixed(6);
  }

  // Callbacks (set by app.js)
  const callbacks = {
    onMapClick: null,
    onRoutePoint: null,
    onNavPoint: null,
  };

  marker.on('dragend', function () {
    const pos = marker.getLatLng();
    updateInfo(pos.lat, pos.lng);
    if (callbacks.onMapClick) callbacks.onMapClick(pos.lat, pos.lng);
  });

  map.on('click', function (e) {
    if (navMode) {
      addNavPoint(e.latlng.lat, e.latlng.lng);
    } else if (routeMode) {
      addRoutePoint(e.latlng.lat, e.latlng.lng);
    } else {
      marker.setLatLng(e.latlng);
      updateInfo(e.latlng.lat, e.latlng.lng);
      if (callbacks.onMapClick) callbacks.onMapClick(e.latlng.lat, e.latlng.lng);
    }
  });

  map.on('move', function () {
    const c = map.getCenter();
    updateInfo(c.lat, c.lng);
  });

  // ── Public API ──

  function setPosition(lat, lng) {
    const latlng = L.latLng(lat, lng);
    marker.setLatLng(latlng);
    map.setView(latlng, map.getZoom());
    updateInfo(lat, lng);
  }

  function moveMarker(lat, lng) {
    const latlng = L.latLng(lat, lng);
    marker.setLatLng(latlng);
    if (autoFollow) map.panTo(latlng);
    updateInfo(lat, lng);
  }

  function setAutoFollow(enabled) {
    autoFollow = enabled;
    if (enabled) map.panTo(marker.getLatLng());
  }

  function centerOnMarker() {
    map.panTo(marker.getLatLng());
  }

  // Route mode
  function setRouteMode(enabled) {
    routeMode = enabled;
    const hint = document.getElementById('routeHint');
    hint.textContent = 'Route Mode: 點擊地圖新增路徑點';
    hint.style.display = enabled ? 'block' : 'none';
    if (enabled) clearRoute();
  }

  function addRoutePoint(lat, lng) {
    routePoints.push([lat, lng]);
    const m = L.circleMarker([lat, lng], {
      radius: 6, color: '#3498db', fillColor: '#3498db', fillOpacity: 0.8,
    }).addTo(map);
    routeMarkers.push(m);
    drawRoute();
    if (callbacks.onRoutePoint) callbacks.onRoutePoint(lat, lng, routePoints.length - 1);
  }

  function drawRoute() {
    if (routeLine) map.removeLayer(routeLine);
    if (routePoints.length > 1) {
      routeLine = L.polyline(routePoints, {
        color: '#3498db', weight: 3, dashArray: '8,8',
      }).addTo(map);
    }
  }

  function clearRoute() {
    routePoints = [];
    routeMarkers.forEach(m => map.removeLayer(m));
    routeMarkers = [];
    if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
  }

  function getRoutePoints() { return routePoints.slice(); }

  // Navigation mode
  function setNavMode(enabled) {
    navMode = enabled;
    const hint = document.getElementById('routeHint');
    if (enabled) {
      hint.textContent = '導航模式: 點擊地圖設定路徑點 (A\u2192B\u2192C...)';
      hint.style.display = 'block';
    } else {
      hint.style.display = 'none';
    }
  }

  function addNavPoint(lat, lng) {
    const label = String.fromCharCode(65 + navWaypoints.length);
    navWaypoints.push([lat, lng]);
    const m = L.marker([lat, lng], {
      icon: L.divIcon({
        className: '',
        html: '<div style="background:#f38ba8;color:#1e1e2e;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:14px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.5);">' + label + '</div>',
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      }),
    }).addTo(map);
    navMarkers.push(m);
    if (callbacks.onNavPoint) callbacks.onNavPoint(lat, lng, navWaypoints.length - 1);
  }

  function getNavWaypoints() { return navWaypoints.slice(); }

  function drawNavRoute(points) {
    if (navRouteLine) map.removeLayer(navRouteLine);
    if (points.length > 1) {
      navRouteLine = L.polyline(points, {
        color: '#00ff88', weight: 5, opacity: 0.9,
      }).addTo(map);
      map.fitBounds(navRouteLine.getBounds(), { padding: [40, 40] });
    }
  }

  function clearNav() {
    navWaypoints = [];
    navMarkers.forEach(m => map.removeLayer(m));
    navMarkers = [];
    if (navRouteLine) { map.removeLayer(navRouteLine); navRouteLine = null; }
    document.getElementById('navInfo').style.display = 'none';
    document.getElementById('routeHint').style.display = 'none';
  }

  function updateNavInfo(text) {
    const el = document.getElementById('navInfo');
    if (text) {
      el.textContent = text;
      el.style.display = 'block';
    } else {
      el.style.display = 'none';
    }
  }

  function setDayNight(isDay) {
    if (isDay && isNightMode) {
      map.removeLayer(nightLayer);
      dayLayer.addTo(map);
      isNightMode = false;
    } else if (!isDay && !isNightMode) {
      map.removeLayer(dayLayer);
      nightLayer.addTo(map);
      isNightMode = true;
    }
  }

  updateInfo(25.0330, 121.5654);

  return {
    map,
    marker,
    callbacks,
    setPosition,
    moveMarker,
    setAutoFollow,
    centerOnMarker,
    setRouteMode,
    clearRoute,
    getRoutePoints,
    setNavMode,
    getNavWaypoints,
    drawNavRoute,
    clearNav,
    updateNavInfo,
    setDayNight,
  };
}
