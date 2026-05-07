---
name: templates/data-table
description: Build a sortable, filterable data table with pagination
when: user asks for table, spreadsheet, data grid, or list view
---

# Data Table Surface Template

## Overview

A sortable, filterable data table with pagination, column resizing, and CSV export. Works with both static data and route-backed APIs.

## Required SDK APIs

- `window.__OBOTOVS_ROUTES_URL__` — fetch paginated data from routes
- `window.__obotovs.on(channel, handler)` — receive live row updates
- `window.__obotovs.state` — persist sort/filter preferences
- `window.__obotovs.theme` — theme-aware styling

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
      margin: 0;
    }
    table { border-collapse: collapse; width: 100%; }
    th {
      background: var(--vscode-editorWidget-background);
      position: sticky; top: 0; z-index: 1;
      cursor: pointer; user-select: none;
    }
    th:hover { background: var(--vscode-list-hoverBackground); }
    td, th {
      border: 1px solid var(--vscode-editorWidget-border);
      padding: 8px 12px; text-align: left; font-size: 13px;
    }
    tr:hover td { background: var(--vscode-list-hoverBackground); }
    .toolbar {
      background: var(--vscode-editorWidget-background);
      border-bottom: 1px solid var(--vscode-editorWidget-border);
    }
    .filter-input {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
    }
    .btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none; cursor: pointer; padding: 4px 12px; border-radius: 4px;
    }
    .btn:hover { background: var(--vscode-button-hoverBackground); }
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
  </style>
</head>
<body>
  <div class="toolbar p-3 flex items-center gap-3 flex-wrap">
    <input id="filter" type="text" placeholder="Filter..."
      class="filter-input px-3 py-1 rounded text-sm flex-1 min-w-48" />
    <span id="count" class="text-xs opacity-50"></span>
    <button id="exportBtn" class="btn btn-secondary text-xs">Export CSV</button>
  </div>
  <div style="overflow: auto; max-height: calc(100vh - 100px);">
    <table>
      <thead id="thead"></thead>
      <tbody id="tbody"></tbody>
    </table>
  </div>
  <div class="toolbar p-3 flex items-center justify-between">
    <div class="flex gap-2">
      <button id="prevBtn" class="btn btn-secondary text-xs" disabled>Prev</button>
      <button id="nextBtn" class="btn btn-secondary text-xs" disabled>Next</button>
    </div>
    <span id="pageInfo" class="text-xs opacity-50"></span>
  </div>

  <script>
    const sdk = window.__obotovs;
    let allData = [];
    let columns = [];
    let sortCol = null;
    let sortAsc = true;
    let filterText = '';
    let page = 0;
    const PAGE_SIZE = 50;

    function setData(rows, cols) {
      allData = rows;
      columns = cols || (rows.length > 0 ? Object.keys(rows[0]) : []);
      page = 0;
      render();
    }

    function getFiltered() {
      if (!filterText) return allData;
      const lower = filterText.toLowerCase();
      return allData.filter(row =>
        columns.some(col => String(row[col] ?? '').toLowerCase().includes(lower))
      );
    }

    function getSorted(rows) {
      if (!sortCol) return rows;
      return [...rows].sort((a, b) => {
        const va = a[sortCol] ?? '';
        const vb = b[sortCol] ?? '';
        const cmp = typeof va === 'number' && typeof vb === 'number'
          ? va - vb
          : String(va).localeCompare(String(vb));
        return sortAsc ? cmp : -cmp;
      });
    }

    function render() {
      const filtered = getFiltered();
      const sorted = getSorted(filtered);
      const paged = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
      const totalPages = Math.ceil(sorted.length / PAGE_SIZE);

      // Header
      document.getElementById('thead').innerHTML = '<tr>' +
        columns.map(col =>
          `<th data-col="${col}">${escapeHtml(col)} ${sortCol === col ? (sortAsc ? '&#9650;' : '&#9660;') : ''}</th>`
        ).join('') + '</tr>';

      // Body
      document.getElementById('tbody').innerHTML = paged.map(row =>
        '<tr>' + columns.map(col =>
          `<td>${escapeHtml(String(row[col] ?? ''))}</td>`
        ).join('') + '</tr>'
      ).join('');

      // Status
      document.getElementById('count').textContent = `${filtered.length} rows`;
      document.getElementById('pageInfo').textContent = totalPages > 1
        ? `Page ${page + 1} of ${totalPages}` : '';
      document.getElementById('prevBtn').disabled = page === 0;
      document.getElementById('nextBtn').disabled = page >= totalPages - 1;
    }

    function escapeHtml(s) {
      const d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }

    // Sort on header click
    document.getElementById('thead').addEventListener('click', (e) => {
      const th = e.target.closest('th');
      if (!th) return;
      const col = th.dataset.col;
      if (sortCol === col) sortAsc = !sortAsc;
      else { sortCol = col; sortAsc = true; }
      render();
    });

    // Filter
    const filterInput = document.getElementById('filter');
    let filterTimer;
    filterInput.addEventListener('input', () => {
      clearTimeout(filterTimer);
      filterTimer = setTimeout(() => {
        filterText = filterInput.value.trim();
        page = 0;
        render();
      }, 200);
    });

    // Pagination
    document.getElementById('prevBtn').addEventListener('click', () => { page--; render(); });
    document.getElementById('nextBtn').addEventListener('click', () => { page++; render(); });

    // CSV export
    document.getElementById('exportBtn').addEventListener('click', () => {
      const rows = [columns.join(',')];
      getFiltered().forEach(row => {
        rows.push(columns.map(c => `"${String(row[c] ?? '').replace(/"/g, '""')}"`).join(','));
      });
      const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'export.csv';
      a.click();
    });

    // Load data from route or channel
    const base = window.__OBOTOVS_ROUTES_URL__;
    if (base) {
      fetch(base + '/api/data')
        .then(r => r.json())
        .then(d => setData(d.rows || d, d.columns))
        .catch(() => {});
    }

    sdk.on('table-data', (d) => setData(d.rows || d, d.columns));
    sdk.on('table-row', (row) => { allData.push(row); render(); });
  </script>
</body>
</html>
```

## Customization Points

- **Column definitions**: Pass `columns` array to control order and visibility
- **Cell rendering**: Replace `escapeHtml(String(...))` with custom formatters (dates, numbers, links)
- **Row actions**: Add an actions column with edit/delete buttons
- **Server-side pagination**: Replace client-side paging with route-backed `?page=N&limit=50` queries
- **Selection**: Add checkboxes for bulk operations

## Common Pitfalls

- Always escape cell content with `escapeHtml()` — table data may contain HTML
- Use `position: sticky` on `<th>` so headers stay visible while scrolling
- For large datasets (10k+ rows), consider virtual scrolling instead of DOM rendering all rows
- CSV export: quote values and escape internal quotes to handle commas in data
