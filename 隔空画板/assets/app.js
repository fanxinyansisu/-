(() => {
  "use strict";

  const video = document.querySelector("#camera");
  const paintCanvas = document.querySelector("#paint");
  const guideCanvas = document.querySelector("#guide");
  const paint = paintCanvas.getContext("2d", { alpha: true });
  const guide = guideCanvas.getContext("2d", { alpha: true });
  const startScreen = document.querySelector("#startScreen");
  const startButton = document.querySelector("#startButton");
  const status = document.querySelector("#status");
  const statusText = document.querySelector("#statusText");
  const sizeInput = document.querySelector("#size");
  const sizeValue = document.querySelector("#sizeValue");
  const welcome = document.querySelector("#welcome");
  const toast = document.querySelector("#toast");
  const announcer = document.querySelector("#announcer");
  const musicToggle = document.querySelector("#musicToggle");
  const swatches = [...document.querySelectorAll(".swatch")];
  const toolButtons = [...document.querySelectorAll("[data-tool]")];
  const stampButtons = [...document.querySelectorAll("[data-stamp]")];
  const stampChoices = document.querySelector("#stampChoices");
  const saveButton = document.querySelector("#saveButton");

  const state = {
    running: false,
    processing: false,
    color: "#FFFFFF",
    brushSize: 8,
    toolMode: "normal",
    stamp: "★",
    stampPinchStartedAt: 0,
    stampLatched: false,
    strokes: [],
    current: { draw: null, erase: null },
    firstDrawAt: 0,
    welcomeTimer: 0,
    clearGestureArmedAt: 0,
    clearCooldownUntil: 0,
    clearGestureStage: "idle",
    clearOpenStartedAt: 0,
    clearFistStartedAt: 0,
    undoGestureStartedAt: 0,
    undoCooldownUntil: 0,
    hoverSwatch: null,
    hoverStartedAt: 0,
    hoverLastActiveAt: 0,
    lastHandsAt: 0,
    dpr: 1,
    cssWidth: 0,
    cssHeight: 0,
    audio: null,
    musicGain: null,
    musicDelay: null,
    musicDelayGain: null,
    musicTimer: 0,
    musicNextAt: 0,
    musicStep: 0,
    musicEnabled: true,
    smoothedTips: { Right: null, Left: null },
    trackingFilters: { Right: null, Left: null },
    gestureActiveAt: { draw: 0, erase: 0 },
    handSeenAt: { Right: 0, Left: 0 },
    drawArm: { anchor: null, startedAt: 0, armed: false },
    rightStop: { type: null, startedAt: 0 },
    toastTimer: 0,
    pointer: { active: false, mode: "draw" }
  };

  const FINGER = {
    thumbTip: 4,
    indexMcp: 5,
    indexPip: 6,
    indexTip: 8,
    middleMcp: 9,
    middlePip: 10,
    middleTip: 12,
    ringMcp: 13,
    ringPip: 14,
    ringTip: 16,
    pinkyMcp: 17,
    pinkyPip: 18,
    pinkyTip: 20
  };

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function setStatus(message, kind = "") {
    statusText.textContent = message;
    status.className = `status ${kind}`.trim();
  }

  function showToast(message) {
    clearTimeout(state.toastTimer);
    toast.textContent = message;
    announcer.textContent = message;
    toast.classList.add("show");
    state.toastTimer = window.setTimeout(() => toast.classList.remove("show"), 1300);
  }

  function resizeCanvases() {
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    state.cssWidth = window.innerWidth;
    state.cssHeight = window.innerHeight;

    [paintCanvas, guideCanvas].forEach((canvas) => {
      canvas.width = Math.round(state.cssWidth * state.dpr);
      canvas.height = Math.round(state.cssHeight * state.dpr);
      canvas.style.width = `${state.cssWidth}px`;
      canvas.style.height = `${state.cssHeight}px`;
    });

    paint.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    guide.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    redrawAll();
  }

  function normalizedPoint(x, y) {
    return { x: x / state.cssWidth, y: y / state.cssHeight };
  }

  function screenPoint(landmark) {
    const sourceWidth = video.videoWidth || state.cssWidth;
    const sourceHeight = video.videoHeight || state.cssHeight;
    const coverScale = Math.max(state.cssWidth / sourceWidth, state.cssHeight / sourceHeight);
    const displayedWidth = sourceWidth * coverScale;
    const displayedHeight = sourceHeight * coverScale;
    const cropX = (displayedWidth - state.cssWidth) / 2;
    const cropY = (displayedHeight - state.cssHeight) / 2;
    const unmirroredX = landmark.x * displayedWidth - cropX;
    return {
      x: state.cssWidth - unmirroredX,
      y: landmark.y * displayedHeight - cropY
    };
  }

  function smoothTrackingPoint(hand, point) {
    const now = performance.now();
    const filter = state.trackingFilters[hand];
    if (!filter) {
      state.trackingFilters[hand] = {
        raw: point,
        position: point,
        velocity: { x: 0, y: 0 },
        time: now
      };
      state.smoothedTips[hand] = point;
      return point;
    }

    const dt = Math.min(0.08, Math.max(0.008, (now - filter.time) / 1000));
    const movement = Math.hypot(point.x - filter.raw.x, point.y - filter.raw.y);
    if (movement > 190) {
      state.trackingFilters[hand] = {
        raw: point,
        position: point,
        velocity: { x: 0, y: 0 },
        time: now
      };
      state.smoothedTips[hand] = point;
      return point;
    }

    const rawVelocity = {
      x: (point.x - filter.raw.x) / dt,
      y: (point.y - filter.raw.y) / dt
    };
    const velocityAlpha = 0.2;
    const velocity = {
      x: filter.velocity.x + (rawVelocity.x - filter.velocity.x) * velocityAlpha,
      y: filter.velocity.y + (rawVelocity.y - filter.velocity.y) * velocityAlpha
    };
    const speed = Math.hypot(velocity.x, velocity.y);
    const cutoff = 0.78 + speed * 0.0055;
    const tau = 1 / (2 * Math.PI * cutoff);
    const alpha = 1 / (1 + tau / dt);
    let smoothed = {
      x: filter.position.x + (point.x - filter.position.x) * alpha,
      y: filter.position.y + (point.y - filter.position.y) * alpha
    };
    if (Math.hypot(smoothed.x - filter.position.x, smoothed.y - filter.position.y) < 0.55) {
      smoothed = filter.position;
    }

    state.trackingFilters[hand] = {
      raw: point,
      position: smoothed,
      velocity,
      time: now
    };
    state.smoothedTips[hand] = smoothed;
    return smoothed;
  }

  function strokePoint(point) {
    return { x: point.x * state.cssWidth, y: point.y * state.cssHeight };
  }

  function configureStroke(ctx, stroke) {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = stroke.width;
    ctx.strokeStyle = stroke.color;
    ctx.globalCompositeOperation = stroke.mode === "erase" ? "destination-out" : "source-over";
    if (stroke.mode !== "erase" && stroke.style === "glow") {
      ctx.shadowColor = stroke.color;
      ctx.shadowBlur = Math.max(10, stroke.width * 1.8);
    }
  }

  function renderStroke(ctx, stroke) {
    if (!stroke.points.length) return;
    ctx.save();
    configureStroke(ctx, stroke);
    const first = strokePoint(stroke.points[0]);
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);

    if (stroke.points.length === 1) {
      ctx.lineTo(first.x + 0.01, first.y + 0.01);
      ctx.stroke();
      ctx.restore();
      return;
    }

    for (let i = 1; i < stroke.points.length - 1; i += 1) {
      const current = strokePoint(stroke.points[i]);
      const next = strokePoint(stroke.points[i + 1]);
      const midpoint = { x: (current.x + next.x) / 2, y: (current.y + next.y) / 2 };
      ctx.quadraticCurveTo(current.x, current.y, midpoint.x, midpoint.y);
    }

    const last = strokePoint(stroke.points.at(-1));
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
    ctx.restore();
  }

  function renderLatestSegment(stroke) {
    const points = stroke.points;
    paint.save();
    configureStroke(paint, stroke);
    if (points.length === 1) {
      const point = strokePoint(points[0]);
      paint.beginPath();
      paint.moveTo(point.x, point.y);
      paint.lineTo(point.x + 0.01, point.y + 0.01);
      paint.stroke();
      paint.restore();
      return;
    }

    const latest = strokePoint(points.at(-1));
    const previous = strokePoint(points.at(-2));
    paint.beginPath();
    if (points.length === 2) {
      paint.moveTo(previous.x, previous.y);
      paint.lineTo(latest.x, latest.y);
    } else {
      const beforePrevious = strokePoint(points.at(-3));
      const start = {
        x: (beforePrevious.x + previous.x) / 2,
        y: (beforePrevious.y + previous.y) / 2
      };
      const end = {
        x: (previous.x + latest.x) / 2,
        y: (previous.y + latest.y) / 2
      };
      paint.moveTo(start.x, start.y);
      paint.quadraticCurveTo(previous.x, previous.y, end.x, end.y);
    }
    paint.stroke();
    paint.restore();
  }

  function renderStamp(ctx, stamp) {
    const point = strokePoint(stamp.point);
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = stamp.color;
    ctx.font = `700 ${stamp.size}px -apple-system, BlinkMacSystemFont, "Segoe UI Symbol", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (stamp.style === "glow") {
      ctx.shadowColor = stamp.color;
      ctx.shadowBlur = Math.max(12, stamp.size * 0.42);
    }
    ctx.fillText(stamp.symbol, point.x, point.y);
    ctx.restore();
  }

  function redrawAll() {
    paint.clearRect(0, 0, state.cssWidth, state.cssHeight);
    state.strokes.forEach((item) => {
      if (item.kind === "stamp") renderStamp(paint, item);
      else renderStroke(paint, item);
    });
    paint.globalCompositeOperation = "source-over";
  }

  function beginStroke(mode, point) {
    const width = mode === "erase"
      ? Math.max(24, state.brushSize * 3)
      : state.brushSize;
    const stroke = {
      kind: "stroke",
      mode,
      color: state.color,
      width,
      style: mode === "draw" && state.toolMode === "glow" ? "glow" : "normal",
      points: [normalizedPoint(point.x, point.y)]
    };
    state.strokes.push(stroke);
    state.current[mode] = stroke;
    renderLatestSegment(stroke);

    if (mode === "draw" && !state.firstDrawAt) {
      state.firstDrawAt = performance.now();
      state.welcomeTimer = window.setTimeout(() => welcome.classList.add("show"), 5000);
    }
  }

  function continueStroke(mode, point) {
    const stroke = state.current[mode];
    if (!stroke) return beginStroke(mode, point);
    const previous = strokePoint(stroke.points.at(-1));
    const delta = Math.hypot(point.x - previous.x, point.y - previous.y);
    if (delta < 1.2) return;
    if (delta > Math.max(state.cssWidth, state.cssHeight) * 0.3) {
      endStroke(mode);
      return beginStroke(mode, point);
    }
    const steps = Math.min(12, Math.max(1, Math.ceil(delta / 6)));
    for (let step = 1; step <= steps; step += 1) {
      const ratio = step / steps;
      const interpolated = {
        x: previous.x + (point.x - previous.x) * ratio,
        y: previous.y + (point.y - previous.y) * ratio
      };
      stroke.points.push(normalizedPoint(interpolated.x, interpolated.y));
      renderLatestSegment(stroke);
    }
  }

  function endStroke(mode) {
    state.current[mode] = null;
  }

  function clearCanvas() {
    state.strokes = [];
    state.current.draw = null;
    state.current.erase = null;
    paint.clearRect(0, 0, state.cssWidth, state.cssHeight);
    resetDrawArm();
    showToast("画布已清空");
  }

  function undoLastStroke() {
    endStroke("draw");
    endStroke("erase");
    resetDrawArm();
    resetRightStop();
    if (!state.strokes.length) {
      showToast("没有可撤回的笔画");
      return;
    }
    state.strokes.pop();
    redrawAll();
    showToast("已撤回上一笔");
  }

  function addStamp(point) {
    const stamp = {
      kind: "stamp",
      point: normalizedPoint(point.x, point.y),
      symbol: state.stamp,
      color: state.color,
      size: Math.max(32, state.brushSize * 3.2),
      style: "glow"
    };
    state.strokes.push(stamp);
    renderStamp(paint, stamp);
    showToast(`已放置印章 ${state.stamp}`);
  }

  function selectTool(tool) {
    endStroke("draw");
    resetDrawArm();
    resetRightStop();
    state.stampLatched = false;
    state.stampPinchStartedAt = 0;
    state.toolMode = tool;
    toolButtons.forEach((button) => {
      const selected = button.dataset.tool === tool;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    stampChoices?.classList.toggle("show", tool === "stamp");
    const names = { normal: "普通笔", glow: "发光笔", stamp: "空中印章" };
    showToast(`已切换为${names[tool]}`);
  }

  function selectStamp(symbol) {
    state.stamp = symbol;
    stampButtons.forEach((button) => {
      const selected = button.dataset.stamp === symbol;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    showToast(`印章已切换为 ${symbol}`);
  }

  function saveArtwork() {
    if (!state.cssWidth || !state.cssHeight) return;
    const output = document.createElement("canvas");
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    output.width = Math.round(state.cssWidth * scale);
    output.height = Math.round(state.cssHeight * scale);
    const ctx = output.getContext("2d");
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = "#101319";
    ctx.fillRect(0, 0, state.cssWidth, state.cssHeight);

    if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
      const coverScale = Math.max(state.cssWidth / video.videoWidth, state.cssHeight / video.videoHeight);
      const width = video.videoWidth * coverScale;
      const height = video.videoHeight * coverScale;
      const x = (state.cssWidth - width) / 2;
      const y = (state.cssHeight - height) / 2;
      ctx.save();
      ctx.translate(state.cssWidth, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, x, y, width, height);
      ctx.restore();
    }

    ctx.drawImage(
      paintCanvas,
      0,
      0,
      paintCanvas.width,
      paintCanvas.height,
      0,
      0,
      state.cssWidth,
      state.cssHeight
    );
    output.toBlob((blob) => {
      if (!blob) {
        showToast("保存失败，请重试");
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      link.href = url;
      link.download = `隔空画板-${timestamp}.png`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast("作品已保存");
    }, "image/png");
  }

  function resetDrawArm() {
    state.drawArm.anchor = null;
    state.drawArm.startedAt = 0;
    state.drawArm.armed = false;
  }

  function resetRightStop() {
    state.rightStop.type = null;
    state.rightStop.startedAt = 0;
  }

  function resetClearGesture() {
    state.clearGestureStage = "idle";
    state.clearOpenStartedAt = 0;
    state.clearFistStartedAt = 0;
    state.clearGestureArmedAt = 0;
  }

  function selectColor(color, announce = true) {
    state.color = color;
    swatches.forEach((swatch) => {
      const selected = swatch.dataset.color.toUpperCase() === color.toUpperCase();
      swatch.classList.toggle("selected", selected);
      swatch.setAttribute("aria-pressed", String(selected));
    });
    if (announce) {
      const label = swatches
        .find((item) => item.dataset.color.toUpperCase() === color.toUpperCase())
        ?.getAttribute("aria-label") || "新颜色";
      showToast(`已选择${label}`);
    }
  }

  function isFingerExtended(points, mcp, pip, tip) {
    const wrist = points[0];
    const a = { x: points[mcp].x - points[pip].x, y: points[mcp].y - points[pip].y };
    const b = { x: points[tip].x - points[pip].x, y: points[tip].y - points[pip].y };
    const magnitude = Math.max(Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y), 0.0001);
    const cosine = (a.x * b.x + a.y * b.y) / magnitude;
    const reachesOut = distance(points[tip], wrist) > distance(points[pip], wrist) * 1.035;
    return cosine < -0.48 && reachesOut;
  }

  function isFingerLooselyExtended(points, mcp, pip, tip) {
    const wrist = points[0];
    const a = { x: points[mcp].x - points[pip].x, y: points[mcp].y - points[pip].y };
    const b = { x: points[tip].x - points[pip].x, y: points[tip].y - points[pip].y };
    const magnitude = Math.max(Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y), 0.0001);
    const cosine = (a.x * b.x + a.y * b.y) / magnitude;
    const reachesOut = distance(points[tip], wrist) > distance(points[pip], wrist);
    return cosine < -0.18 && reachesOut;
  }

  function gestureInfo(points) {
    const index = isFingerExtended(points, FINGER.indexMcp, FINGER.indexPip, FINGER.indexTip);
    const indexLoose = isFingerLooselyExtended(points, FINGER.indexMcp, FINGER.indexPip, FINGER.indexTip);
    const middle = isFingerExtended(points, FINGER.middleMcp, FINGER.middlePip, FINGER.middleTip);
    const ring = isFingerExtended(points, FINGER.ringMcp, FINGER.ringPip, FINGER.ringTip);
    const pinky = isFingerExtended(points, FINGER.pinkyMcp, FINGER.pinkyPip, FINGER.pinkyTip);
    const palmWidth = Math.max(distance(points[FINGER.indexMcp], points[FINGER.pinkyMcp]), 0.02);
    const pinch = distance(points[FINGER.thumbTip], points[FINGER.indexTip]) / palmWidth < 0.62;
    const openPalm = index && middle && ring && pinky;
    const clearPalm = [index, middle, ring, pinky].filter(Boolean).length >= 3;
    const closedCount = [
      [FINGER.indexTip, FINGER.indexPip],
      [FINGER.middleTip, FINGER.middlePip],
      [FINGER.ringTip, FINGER.ringPip],
      [FINGER.pinkyTip, FINGER.pinkyPip]
    ].filter(([tip, pip]) => distance(points[tip], points[0]) < distance(points[pip], points[0]) * 1.12).length;
    const fist = !openPalm && !indexLoose && closedCount >= 3;
    return {
      indexActive: (index || indexLoose) && !openPalm,
      penUp: pinch,
      undoGesture: index && middle && !ring && !pinky && !pinch,
      openPalm,
      clearPalm,
      fist,
      pinch,
      colorPinch: pinch && !fist
    };
  }

  function actualHandLabel(classification) {
    const detected = classification?.label || "";
    return detected === "Left" ? "Right" : detected === "Right" ? "Left" : detected;
  }

  function resetColorHover() {
    state.hoverSwatch?.classList.remove("hovering");
    state.hoverSwatch?.style.setProperty("--progress", "0deg");
    state.hoverSwatch = null;
    state.hoverStartedAt = 0;
    state.hoverLastActiveAt = 0;
  }

  function nearestSwatch(point) {
    const palette = document.querySelector(".palette");
    const paletteRect = palette?.getBoundingClientRect();
    if (
      !paletteRect ||
      point.x < Math.max(0, paletteRect.left - 24) ||
      point.x > paletteRect.right + 105 ||
      point.y < paletteRect.top - 20 ||
      point.y > paletteRect.bottom + 20
    ) {
      return null;
    }

    let nearest = null;
    let nearestDistance = Infinity;
    swatches.forEach((swatch) => {
      const rect = swatch.getBoundingClientRect();
      const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const gap = Math.abs(point.y - center.y);
      if (gap < nearestDistance) {
        nearest = swatch;
        nearestDistance = gap;
      }
    });
    return nearestDistance <= 26 ? nearest : null;
  }

  function updateColorHover(point, pinch) {
    const now = performance.now();
    if (!pinch || !point) {
      if (state.hoverSwatch && now - state.hoverLastActiveAt < 380) return state.hoverSwatch;
      resetColorHover();
      return null;
    }
    const target = nearestSwatch(point);
    if (!target) {
      if (state.hoverSwatch && now - state.hoverLastActiveAt < 380) return state.hoverSwatch;
      resetColorHover();
      return null;
    }
    state.hoverLastActiveAt = now;
    if (state.hoverSwatch !== target) {
      resetColorHover();
      state.hoverSwatch = target;
      state.hoverStartedAt = now;
      state.hoverLastActiveAt = now;
      target.classList.add("hovering");
    }

    const progress = Math.min(1, (now - state.hoverStartedAt) / 2000);
    target.style.setProperty("--progress", `${progress * 360}deg`);
    if (progress >= 1) {
      selectColor(target.dataset.color);
      resetColorHover();
      return null;
    }
    return target;
  }

  function drawColorSelectionGuide(point, target) {
    if (!point || !target) return;
    const rect = target.getBoundingClientRect();
    const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    guide.save();
    guide.beginPath();
    guide.moveTo(point.x, point.y);
    guide.lineTo(center.x, center.y);
    guide.strokeStyle = "rgba(255,255,255,.72)";
    guide.lineWidth = 1.5;
    guide.setLineDash([5, 6]);
    guide.stroke();
    guide.fillStyle = "rgba(16,19,25,.82)";
    guide.fillRect(point.x + 14, point.y - 28, 76, 24);
    guide.fillStyle = "#FFFFFF";
    guide.font = "12px -apple-system, BlinkMacSystemFont, sans-serif";
    guide.fillText("保持捏合", point.x + 22, point.y - 12);
    guide.restore();
  }

  function handleLeftHand(points, gesture) {
    const indexPoint = smoothTrackingPoint("Left", screenPoint(points[FINGER.indexTip]));
    const now = performance.now();
    state.handSeenAt.Left = now;

    if (gesture.undoGesture) {
      endStroke("erase");
      drawCursor(indexPoint, 28, "#FFFFFF", true);
      if (!state.undoGestureStartedAt) state.undoGestureStartedAt = now;
      if (
        now - state.undoGestureStartedAt >= 400 &&
        now > state.undoCooldownUntil
      ) {
        undoLastStroke();
        state.undoCooldownUntil = now + 1000;
        state.undoGestureStartedAt = 0;
      }
      return;
    }
    state.undoGestureStartedAt = 0;

    if (now > state.clearCooldownUntil) {
      if (state.clearGestureStage === "idle") {
        if (gesture.clearPalm) {
          if (!state.clearOpenStartedAt) state.clearOpenStartedAt = now;
          if (now - state.clearOpenStartedAt >= 280) {
            state.clearGestureStage = "armed";
            state.clearGestureArmedAt = now;
            state.clearFistStartedAt = 0;
            showToast("清屏已准备，请握拳");
          }
        } else {
          state.clearOpenStartedAt = 0;
        }
      } else if (state.clearGestureStage === "armed") {
        if (gesture.fist) {
          if (!state.clearFistStartedAt) state.clearFistStartedAt = now;
          if (now - state.clearFistStartedAt >= 280) {
            clearCanvas();
            resetClearGesture();
            state.clearCooldownUntil = now + 1200;
          }
        } else {
          state.clearFistStartedAt = 0;
          if (!gesture.clearPalm && now - state.clearGestureArmedAt > 2200) {
            resetClearGesture();
          }
        }
      }
    }

    if (gesture.indexActive && !gesture.colorPinch) {
      state.gestureActiveAt.erase = now;
      continueStroke("erase", indexPoint);
      drawCursor(indexPoint, Math.max(24, state.brushSize * 3), "#FFFFFF", true);
    } else if (
      state.current.erase &&
      !gesture.colorPinch &&
      !gesture.openPalm &&
      !gesture.fist &&
      now - state.gestureActiveAt.erase < 420
    ) {
      continueStroke("erase", indexPoint);
      drawCursor(indexPoint, Math.max(24, state.brushSize * 3), "#FFFFFF", true);
    } else {
      endStroke("erase");
      if (gesture.colorPinch) drawCursor(indexPoint, 18, state.color, false);
    }
  }

  function handleRightHand(points, gesture) {
    const rawIndexPoint = screenPoint(points[FINGER.indexTip]);
    const indexPoint = smoothTrackingPoint("Right", rawIndexPoint);
    const cursorPoint = {
      x: indexPoint.x * 0.82 + rawIndexPoint.x * 0.18,
      y: indexPoint.y * 0.82 + rawIndexPoint.y * 0.18
    };
    const now = performance.now();
    state.handSeenAt.Right = now;

    if (state.toolMode === "stamp") {
      endStroke("draw");
      resetDrawArm();
      resetRightStop();
      drawCursor(cursorPoint, Math.max(26, state.brushSize * 2.2), state.color, true);
      if (gesture.penUp) {
        if (!state.stampPinchStartedAt) state.stampPinchStartedAt = now;
        if (now - state.stampPinchStartedAt >= 140 && !state.stampLatched) {
          addStamp(indexPoint);
          state.stampLatched = true;
        }
      } else {
        state.stampPinchStartedAt = 0;
        state.stampLatched = false;
      }
      return;
    }

    const stopType = gesture.penUp ? "pinch" : gesture.fist ? "fist" : gesture.openPalm ? "palm" : null;

    if (stopType) {
      if (state.rightStop.type !== stopType) {
        state.rightStop.type = stopType;
        state.rightStop.startedAt = now;
      }
      const confirmTime = stopType === "pinch" ? 180 : 130;
      if (now - state.rightStop.startedAt >= confirmTime) {
        endStroke("draw");
        resetDrawArm();
        if (stopType === "pinch") {
          drawCursor(cursorPoint, state.brushSize + 10, "#FFFFFF", true);
        }
        return;
      }
      if (!state.drawArm.armed) {
        if (stopType === "pinch") drawCursor(cursorPoint, state.brushSize + 10, "#FFFFFF", true);
        return;
      }
    } else {
      resetRightStop();
    }

    if (state.drawArm.armed) {
      state.gestureActiveAt.draw = now;
      continueStroke("draw", indexPoint);
      drawCursor(cursorPoint, state.brushSize + 8, state.color, false);
    } else if (gesture.indexActive) {
      state.gestureActiveAt.draw = now;
      state.drawArm.anchor = rawIndexPoint;
      state.drawArm.startedAt = now;
      state.drawArm.armed = true;
      beginStroke("draw", indexPoint);
      drawCursor(cursorPoint, state.brushSize + 8, state.color, false);
    } else {
      endStroke("draw");
      resetDrawArm();
    }
  }

  function drawCursor(point, size, color, dashed) {
    guide.save();
    guide.beginPath();
    guide.arc(point.x, point.y, Math.max(7, size / 2), 0, Math.PI * 2);
    guide.strokeStyle = color;
    guide.lineWidth = 2;
    guide.shadowColor = "rgba(0,0,0,.65)";
    guide.shadowBlur = 5;
    if (dashed) guide.setLineDash([4, 4]);
    guide.stroke();
    guide.restore();
  }

  function onResults(results) {
    guide.clearRect(0, 0, state.cssWidth, state.cssHeight);
    const landmarks = results.multiHandLandmarks || [];
    const handedness = results.multiHandedness || [];
    let rightSeen = false;
    let leftSeen = false;
    let pinchPoint = null;
    let rightMode = "";

    landmarks.forEach((points, index) => {
      const label = actualHandLabel(handedness[index]);
      const gesture = gestureInfo(points);
      if (gesture.colorPinch && label === "Left") {
        const thumb = screenPoint(points[FINGER.thumbTip]);
        const indexTip = screenPoint(points[FINGER.indexTip]);
        pinchPoint = {
          x: (thumb.x + indexTip.x) / 2,
          y: (thumb.y + indexTip.y) / 2
        };
      }
      if (label === "Right") {
        rightSeen = true;
        rightMode = gesture.penUp
          ? "捏合停笔"
          : gesture.fist || gesture.openPalm
            ? "已停笔"
            : gesture.indexActive
              ? "食指已定位"
              : "等待食指";
        handleRightHand(points, gesture);
      } else if (label === "Left") {
        leftSeen = true;
        handleLeftHand(points, gesture);
      }
    });
    const colorTarget = updateColorHover(pinchPoint, Boolean(pinchPoint));
    if (pinchPoint) {
      drawCursor(pinchPoint, 20, state.color, false);
      drawColorSelectionGuide(pinchPoint, colorTarget);
    }

    const now = performance.now();
    if (!rightSeen && !state.drawArm.armed && now - state.handSeenAt.Right > 150) {
      resetDrawArm();
    }
    if (!rightSeen && now - state.handSeenAt.Right > 700) {
      endStroke("draw");
      resetDrawArm();
      resetRightStop();
    }
    if (!leftSeen) {
      if (now - state.handSeenAt.Left > 420) {
        endStroke("erase");
        state.smoothedTips.Left = null;
        state.trackingFilters.Left = null;
      }
      if (now - state.handSeenAt.Left > 500) resetClearGesture();
      if (now - state.handSeenAt.Left > 500) state.undoGestureStartedAt = 0;
    }
    if (!rightSeen && now - state.handSeenAt.Right > 700) {
      state.smoothedTips.Right = null;
      state.trackingFilters.Right = null;
    }

    state.lastHandsAt = performance.now();
    if (rightSeen) {
      setStatus(`右手：${rightMode}`, "ready");
    } else if (landmarks.length) {
      setStatus("已识别手部，未定位右手", "ready");
    } else {
      setStatus("请将手移入画面", "ready");
    }
  }

  function initAudio() {
    if (state.audio) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    state.audio = new AudioContext();
    state.musicGain = state.audio.createGain();
    state.musicGain.gain.value = 0.09;
    state.musicGain.connect(state.audio.destination);
    state.musicDelay = state.audio.createDelay(1);
    state.musicDelay.delayTime.value = 0.27;
    state.musicDelayGain = state.audio.createGain();
    state.musicDelayGain.gain.value = 0.08;
    state.musicGain.connect(state.musicDelay);
    state.musicDelay.connect(state.musicDelayGain).connect(state.audio.destination);
  }

  function playMusicNote(frequency, startAt, duration, volume, type = "sine") {
    if (!state.audio || !state.musicGain || !state.musicEnabled) return;
    const oscillator = state.audio.createOscillator();
    const gain = state.audio.createGain();
    const filter = state.audio.createBiquadFilter();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, startAt);
    filter.type = "lowpass";
    filter.frequency.value = type === "sine" ? 2700 : 2200;
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.065);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    oscillator.connect(filter).connect(gain).connect(state.musicGain);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.04);
  }

  function scheduleMusic() {
    if (!state.audio || !state.musicEnabled) return;
    const melody = [
      783.99, 880.00, 987.77, 880.00,
      783.99, 659.25, 698.46, 783.99,
      880.00, 987.77, 1046.50, 987.77,
      880.00, 783.99, 698.46, 783.99
    ];
    const harmony = [
      [261.63, 329.63],
      [293.66, 349.23],
      [329.63, 392.00],
      [392.00, 493.88]
    ];
    while (state.musicNextAt < state.audio.currentTime + 0.6) {
      const step = state.musicStep;
      playMusicNote(melody[step % melody.length], state.musicNextAt, 0.68, 0.075, "triangle");
      if (step % 4 === 0) {
        const chord = harmony[Math.floor(step / 4) % harmony.length];
        playMusicNote(chord[0], state.musicNextAt, 1.25, 0.035, "sine");
        playMusicNote(chord[1], state.musicNextAt + 0.06, 1.18, 0.024, "sine");
      }
      state.musicStep += 1;
      state.musicNextAt += 0.44;
    }
  }

  function startBackgroundMusic() {
    if (!state.audio || state.musicTimer) return;
    state.musicEnabled = true;
    if (state.audio.state === "suspended") state.audio.resume();
    state.musicNextAt = state.audio.currentTime + 0.08;
    scheduleMusic();
    state.musicTimer = window.setInterval(scheduleMusic, 220);
    musicToggle?.setAttribute("aria-pressed", "true");
    if (musicToggle) musicToggle.textContent = "音乐：开";
  }

  function stopBackgroundMusic() {
    state.musicEnabled = false;
    clearInterval(state.musicTimer);
    state.musicTimer = 0;
    if (state.musicGain && state.audio) {
      state.musicGain.gain.cancelScheduledValues(state.audio.currentTime);
      state.musicGain.gain.setTargetAtTime(0.0001, state.audio.currentTime, 0.06);
    }
    musicToggle?.setAttribute("aria-pressed", "false");
    if (musicToggle) musicToggle.textContent = "音乐：关";
  }

  function toggleBackgroundMusic() {
    if (state.musicEnabled && state.musicTimer) {
      stopBackgroundMusic();
      return;
    }
    if (state.musicGain && state.audio) {
      state.musicGain.gain.cancelScheduledValues(state.audio.currentTime);
      state.musicGain.gain.setTargetAtTime(0.09, state.audio.currentTime, 0.08);
    }
    startBackgroundMusic();
  }

  async function requestHighestCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        width: { ideal: 3840, max: 7680 },
        height: { ideal: 2160, max: 4320 },
        frameRate: { ideal: 60, max: 60 },
        facingMode: "user"
      }
    });
    video.srcObject = stream;
    await video.play();

    const track = stream.getVideoTracks()[0];
    const capabilities = track.getCapabilities?.() || {};
    const advanced = {};
    if (capabilities.focusMode?.includes("continuous")) advanced.focusMode = "continuous";
    if (capabilities.exposureMode?.includes("continuous")) advanced.exposureMode = "continuous";
    if (Object.keys(advanced).length) {
      try { await track.applyConstraints({ advanced: [advanced] }); } catch (_) { /* 非关键增强 */ }
    }
    return track.getSettings?.() || {};
  }

  function createHands() {
    if (!window.Hands) throw new Error("手势识别组件未加载");
    const hands = new window.Hands({
      locateFile: (file) => `_shared/js/${file}`
    });
    hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.65,
      minTrackingConfidence: 0.62,
      selfieMode: false
    });
    hands.onResults(onResults);
    return hands;
  }

  async function processVideo(hands) {
    if (!state.running) return;
    if (!state.processing && video.readyState >= 2) {
      state.processing = true;
      try {
        await hands.send({ image: video });
      } catch (error) {
        console.error(error);
        setStatus("手势识别暂时中断", "error");
      } finally {
        state.processing = false;
      }
    }
    requestAnimationFrame(() => processVideo(hands));
  }

  async function start() {
    startButton.disabled = true;
    startButton.textContent = "正在启动…";
    setStatus("正在请求摄像头");
    try {
      initAudio();
      const settings = await requestHighestCamera();
      const hands = createHands();
      startBackgroundMusic();
      if (musicToggle) musicToggle.disabled = false;
      state.running = true;
      startScreen.classList.add("hidden");
      const resolution = settings.width && settings.height ? `${settings.width}×${settings.height}` : "最高可用画质";
      setStatus(`摄像头 ${resolution}`, "ready");
      processVideo(hands);
    } catch (error) {
      console.error(error);
      setStatus("无法启动摄像头", "error");
      startButton.disabled = false;
      startButton.textContent = "重新尝试";
      const insecure = location.protocol === "file:";
      showToast(insecure ? "请通过本地服务器打开页面" : "请检查摄像头权限与浏览器支持");
    }
  }

  function pointerPosition(event) {
    const rect = paintCanvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  paintCanvas.addEventListener("pointerdown", (event) => {
    state.pointer.active = true;
    state.pointer.mode = event.shiftKey || event.button === 2 ? "erase" : "draw";
    paintCanvas.setPointerCapture(event.pointerId);
    beginStroke(state.pointer.mode, pointerPosition(event));
  });
  paintCanvas.addEventListener("pointermove", (event) => {
    if (state.pointer.active) continueStroke(state.pointer.mode, pointerPosition(event));
  });
  const endPointer = () => {
    if (!state.pointer.active) return;
    endStroke(state.pointer.mode);
    state.pointer.active = false;
  };
  paintCanvas.addEventListener("pointerup", endPointer);
  paintCanvas.addEventListener("pointercancel", endPointer);
  paintCanvas.addEventListener("contextmenu", (event) => event.preventDefault());

  swatches.forEach((swatch) => {
    swatch.addEventListener("click", () => selectColor(swatch.dataset.color));
  });
  toolButtons.forEach((button) => {
    button.addEventListener("click", () => selectTool(button.dataset.tool));
  });
  stampButtons.forEach((button) => {
    button.addEventListener("click", () => selectStamp(button.dataset.stamp));
  });
  saveButton?.addEventListener("click", saveArtwork);
  sizeInput.addEventListener("input", () => {
    state.brushSize = Number(sizeInput.value);
    sizeValue.value = `${state.brushSize} px`;
    sizeValue.textContent = `${state.brushSize} px`;
  });
  window.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() === "c") clearCanvas();
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      undoLastStroke();
    }
  });
  window.addEventListener("resize", resizeCanvases);
  startButton.addEventListener("click", start);
  musicToggle?.addEventListener("click", toggleBackgroundMusic);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      endStroke("draw");
      endStroke("erase");
    }
  });

  resizeCanvases();
  selectColor("#FFFFFF", false);
  selectStamp("★");
})();
