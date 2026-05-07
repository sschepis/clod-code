---
name: templates/search-ui
description: Build a search interface with streaming results
when: user asks for search, query, lookup, or finder UI
---

# Search UI Surface Template

## Overview

A query input with streaming results display. Use when the user needs to search, filter, or query data with live-updating results. Supports both instant (local) and streaming (route-backed) search patterns.

## Required SDK APIs

- `window.__obotovs.on(channel, handler)` — receive streamed results from agent or routes
- `window.__obotovs.emit(channel, data)` — send queries to the extension
- `window.__obotovs.executeTool(tool, kwargs)` — call tools directly from the surface
- `window.__obotovs.theme` — adapt colors to VS Code theme
- `window.__obotovs.state` — persist last query and preferences
- `window.__OBOTOVS_ROUTES_URL__` — fetch from local API routes

## HTML Structure

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
      margin: 0; padding: 0;
    }
    .search-input {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
    }
    .search-input:focus {
      outline: none;
      border-color: var(--vscode-focusBorder);
    }
    .result-card {
      background: var(--vscode-editorWidget-background);
      border: 1px solid var(--vscode-editorWidget-border);
    }
    .result-card:hover {
      border-color: var(--vscode-focusBorder);
    }
    .spinner { animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div id="app" class="max-w-4xl mx-auto p-6">
    <div class="mb-6">
      <div class="relative">
        <input id="query" type="text" placeholder="Search..."
          class="search-input w-full px-4 py-3 rounded-lg text-base" />
        <div id="spinner" class="hidden absolute right-3 top-3">
          <svg class="spinner w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" stroke-opacity="0.25"/>
            <path d="M12 2a10 10 0 0 1 10 10" stroke-opacity="0.75"/>
          </svg>
        </div>
      </div>
      <div id="status" class="mt-2 text-sm opacity-60"></div>
    </div>
    <div id="results" class="space-y-3"></div>
    <div id="empty" class="text-center py-12 opacity-40">
      Type a query to search
    </div>
  </div>

  <script>
    const query = document.getElementById('query');
    const results = document.getElementById('results');
    const spinner = document.getElementById('spinner');
    const status = document.getElementById('status');
    const empty = document.getElementById('empty');
    const sdk = window.__obotovs;
    let debounceTimer;

    // Restore last query
    sdk.state.get('lastQuery').then(q => { if (q) query.value = q; });

    // --- Option A: Route-backed search ---
    async function searchViaRoute(q) {
      const base = window.__OBOTOVS_ROUTES_URL__;
      if (!base) return;
      spinner.classList.remove('hidden');
      status.textContent = 'Searching...';
      results.innerHTML = '';
      empty.classList.add('hidden');

      try {
        const res = await fetch(`${base}/api/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        renderResults(data.results || []);
        status.textContent = `${data.results?.length || 0} results`;
      } catch (err) {
        status.textContent = 'Search failed: ' + err.message;
      } finally {
        spinner.classList.add('hidden');
      }
    }

    // --- Option B: Channel-based streaming search ---
    sdk.on('search-results', (data) => {
      if (data.type === 'start') {
        results.innerHTML = '';
        empty.classList.add('hidden');
        spinner.classList.remove('hidden');
        status.textContent = 'Searching...';
      } else if (data.type === 'result') {
        appendResult(data);
      } else if (data.type === 'done') {
        spinner.classList.add('hidden');
        status.textContent = `${data.count} results (${data.durationMs}ms)`;
      }
    });

    function appendResult(item) {
      const card = document.createElement('div');
      card.className = 'result-card rounded-lg p-4 cursor-pointer transition-colors';
      card.innerHTML = `
        <div class="font-medium">${escapeHtml(item.title || '')}</div>
        <div class="text-sm opacity-70 mt-1">${escapeHtml(item.snippet || '')}</div>
        ${item.meta ? `<div class="text-xs opacity-50 mt-2">${escapeHtml(item.meta)}</div>` : ''}
      `;
      results.appendChild(card);
    }

    function renderResults(items) {
      results.innerHTML = '';
      if (items.length === 0) {
        empty.classList.remove('hidden');
        empty.textContent = 'No results found';
        return;
      }
      empty.classList.add('hidden');
      items.forEach(appendResult);
    }

    function escapeHtml(s) {
      const d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }

    // Debounced search on input
    query.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const q = query.value.trim();
        sdk.state.set('lastQuery', q);
        if (!q) { results.innerHTML = ''; empty.classList.remove('hidden'); return; }
        // Choose one: searchViaRoute(q) or emit to agent
        sdk.emit('search-query', { query: q });
      }, 300);
    });

    // Enter key submits immediately
    query.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        clearTimeout(debounceTimer);
        const q = query.value.trim();
        if (q) sdk.emit('search-query', { query: q });
      }
    });
  </script>
</body>
</html>
```

## Customization Points

- **Search source**: Switch between route-backed (`searchViaRoute`) and channel-based (agent pushes to `search-results`) approaches
- **Result card layout**: Modify `appendResult()` for custom fields (images, tags, scores)
- **Debounce delay**: Adjust the 300ms timer for responsiveness vs. server load
- **Filters**: Add filter dropdowns above results, include in query params

## Common Pitfalls

- Always HTML-escape user-provided content in results (use `escapeHtml()` helper)
- Don't forget to handle the empty/loading/error states
- If using route-backed search, ensure the route is created first
- For streaming results via channels, the agent must call `surface/push` with the `search-results` channel
