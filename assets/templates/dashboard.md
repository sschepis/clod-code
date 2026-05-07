---
name: templates/dashboard
description: Build a card-grid dashboard with charts and real-time data
when: user asks for dashboard, analytics, metrics, or monitoring UI
---

# Dashboard Surface Template

## Overview

A responsive card-grid layout with Chart.js charts, stat counters, and real-time data feeds. Adapts to VS Code dark/light themes automatically.

## Required SDK APIs

- `window.__obotovs.on(channel, handler)` — receive live data updates
- `window.__obotovs.theme` — theme-aware chart colors
- `window.__obotovs.state` — persist dashboard preferences
- `window.__OBOTOVS_ROUTES_URL__` — fetch initial data from routes

## HTML Structure

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <style>
    body {
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-font-family);
      margin: 0;
    }
    .stat-card {
      background: var(--vscode-editorWidget-background);
      border: 1px solid var(--vscode-editorWidget-border);
    }
    .chart-card {
      background: var(--vscode-editorWidget-background);
      border: 1px solid var(--vscode-editorWidget-border);
    }
  </style>
</head>
<body>
  <div class="p-6">
    <h1 class="text-xl font-semibold mb-6" id="title">Dashboard</h1>

    <!-- Stat cards row -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6" id="stats"></div>

    <!-- Charts row -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
      <div class="chart-card rounded-lg p-4">
        <h3 class="text-sm font-medium mb-3 opacity-70">Trend</h3>
        <canvas id="lineChart"></canvas>
      </div>
      <div class="chart-card rounded-lg p-4">
        <h3 class="text-sm font-medium mb-3 opacity-70">Distribution</h3>
        <canvas id="barChart"></canvas>
      </div>
    </div>

    <!-- Activity feed -->
    <div class="chart-card rounded-lg p-4">
      <h3 class="text-sm font-medium mb-3 opacity-70">Recent Activity</h3>
      <div id="feed" class="space-y-2 max-h-64 overflow-y-auto"></div>
    </div>
  </div>

  <script>
    const sdk = window.__obotovs;
    const isDark = sdk.theme.isDark;

    // Theme-aware chart colors
    const colors = {
      text: getComputedStyle(document.documentElement).getPropertyValue('--vscode-editor-foreground').trim(),
      grid: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
      primary: isDark ? '#60a5fa' : '#3b82f6',
      secondary: isDark ? '#34d399' : '#10b981',
      accent: isDark ? '#f472b6' : '#ec4899',
      warn: isDark ? '#fbbf24' : '#f59e0b',
    };

    Chart.defaults.color = colors.text;
    Chart.defaults.borderColor = colors.grid;

    // --- Stat cards ---
    function renderStats(stats) {
      const container = document.getElementById('stats');
      container.innerHTML = stats.map(s => `
        <div class="stat-card rounded-lg p-4">
          <div class="text-xs uppercase tracking-wide opacity-50">${s.label}</div>
          <div class="text-2xl font-bold mt-1">${s.value}</div>
          ${s.change != null ? `<div class="text-xs mt-1 ${s.change >= 0 ? 'text-green-400' : 'text-red-400'}">${s.change >= 0 ? '+' : ''}${s.change}%</div>` : ''}
        </div>
      `).join('');
    }

    // --- Line chart ---
    const lineCtx = document.getElementById('lineChart').getContext('2d');
    const lineChart = new Chart(lineCtx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'Value',
          data: [],
          borderColor: colors.primary,
          backgroundColor: colors.primary + '20',
          fill: true,
          tension: 0.3,
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true },
        },
      },
    });

    // --- Bar chart ---
    const barCtx = document.getElementById('barChart').getContext('2d');
    const barChart = new Chart(barCtx, {
      type: 'bar',
      data: {
        labels: [],
        datasets: [{
          data: [],
          backgroundColor: [colors.primary, colors.secondary, colors.accent, colors.warn, colors.primary + '80'],
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } },
      },
    });

    // --- Activity feed ---
    function addFeedItem(item) {
      const feed = document.getElementById('feed');
      const el = document.createElement('div');
      el.className = 'text-sm py-1 border-b border-gray-700/20 flex justify-between';
      el.innerHTML = `<span>${item.text}</span><span class="opacity-40 text-xs">${item.time || 'now'}</span>`;
      feed.prepend(el);
      while (feed.children.length > 50) feed.lastChild.remove();
    }

    // --- Data loading ---
    function updateDashboard(data) {
      if (data.stats) renderStats(data.stats);
      if (data.trend) {
        lineChart.data.labels = data.trend.labels;
        lineChart.data.datasets[0].data = data.trend.values;
        lineChart.update('none');
      }
      if (data.distribution) {
        barChart.data.labels = data.distribution.labels;
        barChart.data.datasets[0].data = data.distribution.values;
        barChart.update('none');
      }
      if (data.feed) data.feed.forEach(addFeedItem);
    }

    // Initial load from route
    const base = window.__OBOTOVS_ROUTES_URL__;
    if (base) {
      fetch(base + '/api/dashboard')
        .then(r => r.json())
        .then(updateDashboard)
        .catch(() => {});
    }

    // Real-time updates via channel
    sdk.on('dashboard-update', updateDashboard);
    sdk.on('dashboard-feed', addFeedItem);

    // Theme change handling
    sdk.theme.onChange(function(dark) {
      location.reload();
    });
  </script>
</body>
</html>
```

## Customization Points

- **Stat cards**: Change the `stats` array shape to match your data model
- **Chart types**: Swap line/bar for doughnut, radar, scatter — Chart.js supports all
- **Grid layout**: Adjust `grid-cols-*` classes for different card arrangements
- **Refresh interval**: Add `setInterval` for polling, or rely on channel pushes for real-time
- **Color palette**: Extend the `colors` object with domain-specific colors

## Common Pitfalls

- Call `chart.update('none')` (not `chart.update()`) for performance when updating data frequently
- Always use VS Code CSS variables for backgrounds and text — never hardcode colors
- On theme change, the simplest approach is `location.reload()` to rebuild charts with new colors
- Keep feed items capped (remove oldest) to prevent memory growth
