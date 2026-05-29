/**
 * Virtual joystick on HTML5 Canvas.
 * Exports: initJoystick(canvasId, onMove, onRelease)
 */
function initJoystick(canvasId, onMove, onRelease) {
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  const center = { x: size / 2, y: size / 2 };
  const baseRadius = size * 0.42;
  const knobRadius = size * 0.18;
  let knob = { x: center.x, y: center.y };
  let dragging = false;
  let moveInterval = null;

  function draw() {
    ctx.clearRect(0, 0, size, size);

    // Base circle
    const baseGrad = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, baseRadius);
    baseGrad.addColorStop(0, '#3c3c46');
    baseGrad.addColorStop(1, '#1e1e28');
    ctx.beginPath();
    ctx.arc(center.x, center.y, baseRadius, 0, Math.PI * 2);
    ctx.fillStyle = baseGrad;
    ctx.fill();
    ctx.strokeStyle = '#50505a';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Direction guides
    ctx.strokeStyle = 'rgba(80,80,90,0.4)';
    ctx.lineWidth = 1;
    const r = baseRadius * 0.7;
    for (let angle of [0, 90, 180, 270]) {
      const rad = angle * Math.PI / 180;
      ctx.beginPath();
      ctx.moveTo(center.x, center.y);
      ctx.lineTo(center.x + r * Math.cos(rad), center.y + r * Math.sin(rad));
      ctx.stroke();
    }

    // Knob
    const knobGrad = ctx.createRadialGradient(knob.x, knob.y, 0, knob.x, knob.y, knobRadius);
    if (dragging) {
      knobGrad.addColorStop(0, '#e74c3c');
      knobGrad.addColorStop(1, '#c0392b');
    } else {
      knobGrad.addColorStop(0, '#3498db');
      knobGrad.addColorStop(1, '#2980b9');
    }
    ctx.beginPath();
    ctx.arc(knob.x, knob.y, knobRadius, 0, Math.PI * 2);
    ctx.fillStyle = knobGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function updateKnob(x, y) {
    let dx = x - center.x;
    let dy = y - center.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const maxDist = baseRadius - knobRadius * 0.5;
    if (dist > maxDist) {
      const scale = maxDist / dist;
      dx *= scale;
      dy *= scale;
    }
    knob.x = center.x + dx;
    knob.y = center.y + dy;
    draw();
  }

  function getDirection() {
    const dx = (knob.x - center.x) / baseRadius;
    const dy = -(knob.y - center.y) / baseRadius; // invert Y
    return { dx, dy };
  }

  function emitMove() {
    const { dx, dy } = getDirection();
    if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05) {
      onMove(dx, dy);
    }
  }

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches ? e.touches[0] : e;
    return {
      x: touch.clientX - rect.left,
      y: touch.clientY - rect.top,
    };
  }

  function onStart(e) {
    e.preventDefault();
    dragging = true;
    const pos = getPos(e);
    updateKnob(pos.x, pos.y);
    moveInterval = setInterval(emitMove, 100);
  }

  function onMoveEvent(e) {
    if (!dragging) return;
    e.preventDefault();
    const pos = getPos(e);
    updateKnob(pos.x, pos.y);
  }

  function onEnd(e) {
    if (!dragging) return;
    dragging = false;
    knob.x = center.x;
    knob.y = center.y;
    clearInterval(moveInterval);
    moveInterval = null;
    onRelease();
    draw();
  }

  // Mouse events
  canvas.addEventListener('mousedown', onStart);
  window.addEventListener('mousemove', onMoveEvent);
  window.addEventListener('mouseup', onEnd);

  // Touch events
  canvas.addEventListener('touchstart', onStart, { passive: false });
  window.addEventListener('touchmove', onMoveEvent, { passive: false });
  window.addEventListener('touchend', onEnd);

  // Keyboard joystick support (exposed for app.js)
  canvas._setKnobDirection = function(dx, dy) {
    const r = baseRadius - knobRadius * 0.5;
    knob.x = center.x + dx * r;
    knob.y = center.y - dy * r; // invert Y back
    dragging = (dx !== 0 || dy !== 0);
    draw();
  };

  draw();
  return canvas;
}
