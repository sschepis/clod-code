---
name: templates/canvas-app
description: Build an interactive canvas with 2D/3D rendering and parameter controls
when: user asks for canvas, drawing, visualization, 3D, animation, or interactive graphics
---

# Canvas App Surface Template

## Overview

An interactive canvas surface with animation loop, resize handling, and parameter controls. Works with both Canvas2D and THREE.js for 3D. Use when the user needs visual/graphical output, simulations, or interactive drawings.

## Required SDK APIs

- `window.__obotovs.on(channel, handler)` — receive parameter updates or data pushes
- `window.__obotovs.emit(channel, data)` — send interaction events back to the extension
- `window.__obotovs.state` — persist camera/view parameters
- `window.__obotovs.theme` — adapt overlay colors to VS Code theme

## HTML Structure (Canvas2D)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body {
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-font-family);
      margin: 0; overflow: hidden;
    }
    canvas { display: block; }
    .controls {
      position: fixed; top: 0; right: 0;
      background: var(--vscode-editorWidget-background);
      border: 1px solid var(--vscode-editorWidget-border);
      border-top: none; border-right: none;
      border-radius: 0 0 0 8px;
      padding: 12px; z-index: 10;
      min-width: 200px;
    }
    .control-row {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 8px; font-size: 12px;
    }
    .control-row input[type="range"] {
      width: 100px;
      accent-color: var(--vscode-focusBorder);
    }
    .control-row input[type="color"] {
      width: 32px; height: 24px; border: none; cursor: pointer;
    }
    .btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none; cursor: pointer; padding: 4px 12px;
      border-radius: 4px; font-size: 12px; width: 100%;
    }
    .btn:hover { background: var(--vscode-button-hoverBackground); }
    .stats {
      position: fixed; bottom: 8px; left: 8px;
      font-size: 11px; opacity: 0.5; z-index: 10;
    }
  </style>
</head>
<body>
  <canvas id="canvas"></canvas>

  <div class="controls" id="controls">
    <div class="control-row">
      <label>Speed</label>
      <input type="range" id="speed" min="0.1" max="5" step="0.1" value="1" />
    </div>
    <div class="control-row">
      <label>Scale</label>
      <input type="range" id="scale" min="0.5" max="3" step="0.1" value="1" />
    </div>
    <div class="control-row">
      <label>Color</label>
      <input type="color" id="color" value="#60a5fa" />
    </div>
    <div class="control-row">
      <button class="btn" id="resetBtn">Reset</button>
    </div>
  </div>

  <div class="stats" id="stats"></div>

  <script>
    const sdk = window.__obotovs;
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    let width, height;
    let animId;
    let time = 0;
    let frameCount = 0;
    let lastFpsTime = performance.now();
    let fps = 0;

    // Parameters
    const params = {
      speed: 1,
      scale: 1,
      color: '#60a5fa',
    };

    function resize() {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    }
    window.addEventListener('resize', resize);
    resize();

    // --- Main render loop ---
    function draw(timestamp) {
      time += 0.016 * params.speed;

      ctx.clearRect(0, 0, width, height);

      // Example: animated circles — replace with your visualization
      const cx = width / 2;
      const cy = height / 2;
      const count = 12;
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + time;
        const radius = 100 * params.scale;
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius;
        const r = 10 + Math.sin(time + i) * 5;

        ctx.beginPath();
        ctx.arc(x, y, r * params.scale, 0, Math.PI * 2);
        ctx.fillStyle = params.color + 'cc';
        ctx.fill();
      }

      // FPS counter
      frameCount++;
      if (timestamp - lastFpsTime >= 1000) {
        fps = frameCount;
        frameCount = 0;
        lastFpsTime = timestamp;
        document.getElementById('stats').textContent = fps + ' fps';
      }

      animId = requestAnimationFrame(draw);
    }
    animId = requestAnimationFrame(draw);

    // --- Controls ---
    document.getElementById('speed').addEventListener('input', (e) => {
      params.speed = parseFloat(e.target.value);
    });
    document.getElementById('scale').addEventListener('input', (e) => {
      params.scale = parseFloat(e.target.value);
    });
    document.getElementById('color').addEventListener('input', (e) => {
      params.color = e.target.value;
    });
    document.getElementById('resetBtn').addEventListener('click', () => {
      time = 0;
      params.speed = 1; params.scale = 1; params.color = '#60a5fa';
      document.getElementById('speed').value = '1';
      document.getElementById('scale').value = '1';
      document.getElementById('color').value = '#60a5fa';
    });

    // --- Mouse interaction ---
    let mouseX = 0, mouseY = 0, mouseDown = false;
    canvas.addEventListener('mousemove', (e) => {
      mouseX = e.clientX; mouseY = e.clientY;
    });
    canvas.addEventListener('mousedown', () => { mouseDown = true; });
    canvas.addEventListener('mouseup', () => { mouseDown = false; });

    // --- Channel data ---
    sdk.on('canvas-params', (data) => {
      Object.assign(params, data);
      if (data.speed) document.getElementById('speed').value = String(data.speed);
      if (data.scale) document.getElementById('scale').value = String(data.scale);
      if (data.color) document.getElementById('color').value = data.color;
    });

    sdk.on('canvas-data', (data) => {
      // Receive data to visualize — adapt based on use case
    });

    // Persist and restore params
    sdk.state.get('canvasParams').then(saved => {
      if (saved) {
        Object.assign(params, saved);
        document.getElementById('speed').value = String(params.speed);
        document.getElementById('scale').value = String(params.scale);
        document.getElementById('color').value = params.color;
      }
    });

    window.addEventListener('beforeunload', () => {
      sdk.state.set('canvasParams', params);
    });
  </script>
</body>
</html>
```

## THREE.js Variant

For 3D graphics, replace the Canvas2D setup with:

```html
<script src="https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.160.0/examples/js/controls/OrbitControls.js"></script>
<script>
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const controls = new THREE.OrbitControls(camera, canvas);

  // Set background to match VS Code theme
  const bgColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--vscode-editor-background').trim();
  scene.background = new THREE.Color(bgColor);

  camera.position.z = 5;
  renderer.setSize(width, height);

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();
</script>
```

## Customization Points

- **Rendering engine**: Switch between Canvas2D, WebGL, THREE.js, or SVG based on use case
- **Controls panel**: Add/remove parameter sliders, color pickers, checkboxes
- **Mouse interaction**: Use `mouseX`/`mouseY`/`mouseDown` for drawing, selection, or camera control
- **Data input**: Push data via `canvas-data` channel for data-driven visualizations
- **Export**: Add a "Save PNG" button using `canvas.toDataURL('image/png')`

## Common Pitfalls

- Always call `resize()` on window resize AND initial load — canvas dimensions default to 300x150
- Use `requestAnimationFrame` instead of `setInterval` for smooth animation
- For THREE.js, update `camera.aspect` and call `camera.updateProjectionMatrix()` on resize
- Keep the animation loop lightweight — move heavy computation to a Web Worker if needed
- Cancel `requestAnimationFrame` when the surface is hidden to save CPU
