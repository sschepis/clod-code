---
name: templates/document-viewer
description: Build a document viewer with markdown rendering, syntax highlighting, and search
when: user asks for document viewer, markdown preview, code viewer, content display, or reader UI
---

# Document Viewer Surface Template

## Overview

A document rendering surface with markdown support, syntax-highlighted code blocks, table of contents, and in-document search. Use for displaying documentation, code, logs, reports, or any structured text content.

## Required SDK APIs

- `window.__obotovs.on(channel, handler)` — receive document content updates
- `window.__obotovs.emit(channel, data)` — send user interactions (link clicks, selections)
- `window.__obotovs.state` — persist scroll position and search state
- `window.__obotovs.theme` — syntax highlighting colors
- `window.__OBOTOVS_ROUTES_URL__` — fetch document content from routes

## HTML Structure

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/marked@11.1.1/marked.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/core.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/languages/javascript.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/languages/typescript.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/languages/python.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/languages/bash.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/languages/json.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/languages/css.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/languages/xml.min.js"></script>
  <style>
    body {
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-font-family);
      margin: 0; display: flex;
    }

    /* Table of contents sidebar */
    .toc {
      width: 240px; min-width: 240px;
      background: var(--vscode-sideBar-background, var(--vscode-editorWidget-background));
      border-right: 1px solid var(--vscode-editorWidget-border);
      padding: 16px; overflow-y: auto; height: 100vh;
      position: sticky; top: 0;
    }
    .toc-title {
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
      opacity: 0.6; margin-bottom: 12px;
    }
    .toc a {
      display: block; font-size: 13px; padding: 3px 0;
      color: var(--vscode-textLink-foreground);
      text-decoration: none; opacity: 0.8;
    }
    .toc a:hover { opacity: 1; }
    .toc a.active {
      opacity: 1; font-weight: 500;
    }
    .toc a.depth-2 { padding-left: 16px; font-size: 12px; }
    .toc a.depth-3 { padding-left: 32px; font-size: 12px; opacity: 0.7; }

    /* Main content */
    .content {
      flex: 1; padding: 24px 48px; max-width: 800px; overflow-y: auto; height: 100vh;
    }

    /* Search bar */
    .search-bar {
      position: fixed; top: 0; right: 0; left: 240px; z-index: 20;
      background: var(--vscode-editorWidget-background);
      border-bottom: 1px solid var(--vscode-editorWidget-border);
      padding: 8px 16px; display: none; align-items: center; gap: 8px;
    }
    .search-bar.visible { display: flex; }
    .search-bar input {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      padding: 4px 8px; border-radius: 4px; font-size: 13px; flex: 1;
    }
    .search-bar input:focus { outline: none; border-color: var(--vscode-focusBorder); }
    .search-bar .count { font-size: 12px; opacity: 0.6; white-space: nowrap; }
    .search-bar button {
      background: none; border: none; color: inherit; cursor: pointer;
      font-size: 16px; opacity: 0.6; padding: 4px;
    }
    .search-bar button:hover { opacity: 1; }

    /* Markdown styles */
    .content h1 { font-size: 24px; font-weight: 600; margin: 24px 0 12px; border-bottom: 1px solid var(--vscode-editorWidget-border); padding-bottom: 8px; }
    .content h2 { font-size: 20px; font-weight: 600; margin: 20px 0 10px; }
    .content h3 { font-size: 16px; font-weight: 600; margin: 16px 0 8px; }
    .content p { line-height: 1.7; margin: 8px 0; }
    .content a { color: var(--vscode-textLink-foreground); }
    .content ul, .content ol { padding-left: 24px; margin: 8px 0; }
    .content li { line-height: 1.6; margin: 2px 0; }
    .content blockquote {
      border-left: 3px solid var(--vscode-focusBorder);
      margin: 12px 0; padding: 4px 16px; opacity: 0.85;
    }
    .content table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    .content th, .content td {
      border: 1px solid var(--vscode-editorWidget-border);
      padding: 8px 12px; text-align: left; font-size: 13px;
    }
    .content th { background: var(--vscode-editorWidget-background); font-weight: 600; }
    .content img { max-width: 100%; border-radius: 4px; margin: 8px 0; }

    /* Code blocks */
    .content pre {
      background: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.1));
      border: 1px solid var(--vscode-editorWidget-border);
      border-radius: 6px; padding: 16px; overflow-x: auto;
      font-family: var(--vscode-editor-font-family, 'Menlo, Monaco, Consolas, monospace');
      font-size: 13px; line-height: 1.5; position: relative;
    }
    .content code {
      font-family: var(--vscode-editor-font-family, 'Menlo, Monaco, Consolas, monospace');
      font-size: 13px;
    }
    .content p code, .content li code {
      background: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.1));
      padding: 2px 5px; border-radius: 3px;
    }
    .copy-btn {
      position: absolute; top: 8px; right: 8px;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none; cursor: pointer; padding: 2px 8px;
      border-radius: 3px; font-size: 11px; opacity: 0;
      transition: opacity 0.2s;
    }
    pre:hover .copy-btn { opacity: 1; }

    /* Search highlight */
    mark {
      background: var(--vscode-editor-findMatchHighlightBackground, #ea5c0055);
      color: inherit; padding: 0 1px; border-radius: 2px;
    }
    mark.current {
      background: var(--vscode-editor-findMatchBackground, #ea5c00aa);
    }
  </style>
</head>
<body>
  <nav class="toc" id="toc">
    <div class="toc-title">Contents</div>
  </nav>

  <div class="search-bar" id="searchBar">
    <input type="text" id="searchInput" placeholder="Search in document..." />
    <span class="count" id="searchCount"></span>
    <button id="searchPrev" title="Previous">&#9650;</button>
    <button id="searchNext" title="Next">&#9660;</button>
    <button id="searchClose" title="Close">&times;</button>
  </div>

  <main class="content" id="content"></main>

  <script>
    const sdk = window.__obotovs;
    const contentEl = document.getElementById('content');
    const tocEl = document.getElementById('toc');
    let rawContent = '';

    // Register highlight.js languages
    hljs.registerLanguage('javascript', window.hljsDefineJavascript || (() => hljs.getLanguage('javascript')));

    // Configure marked
    marked.setOptions({
      highlight: function(code, lang) {
        if (lang && hljs.getLanguage(lang)) {
          return hljs.highlight(code, { language: lang }).value;
        }
        return hljs.highlightAuto(code).value;
      },
      gfm: true,
      breaks: false,
    });

    function renderDocument(content) {
      rawContent = content;
      const html = marked.parse(content);
      contentEl.innerHTML = html;

      // Add copy buttons to code blocks
      contentEl.querySelectorAll('pre code').forEach(block => {
        const btn = document.createElement('button');
        btn.className = 'copy-btn';
        btn.textContent = 'Copy';
        btn.onclick = () => {
          navigator.clipboard.writeText(block.textContent);
          btn.textContent = 'Copied!';
          setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
        };
        block.parentElement.style.position = 'relative';
        block.parentElement.appendChild(btn);
      });

      buildToc();
      restoreScroll();
    }

    function buildToc() {
      const headings = contentEl.querySelectorAll('h1, h2, h3');
      let tocHtml = '<div class="toc-title">Contents</div>';
      headings.forEach((h, i) => {
        const id = 'heading-' + i;
        h.id = id;
        const depth = parseInt(h.tagName[1]);
        tocHtml += `<a href="#${id}" class="depth-${depth}" data-id="${id}">${h.textContent}</a>`;
      });
      tocEl.innerHTML = tocHtml;

      // Click handler
      tocEl.addEventListener('click', (e) => {
        const a = e.target.closest('a');
        if (!a) return;
        e.preventDefault();
        const target = document.getElementById(a.dataset.id);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    // Active TOC tracking
    const contentMain = document.getElementById('content');
    contentMain.addEventListener('scroll', () => {
      const headings = contentEl.querySelectorAll('h1, h2, h3');
      let activeId = '';
      for (const h of headings) {
        if (h.getBoundingClientRect().top <= 60) activeId = h.id;
      }
      tocEl.querySelectorAll('a').forEach(a => {
        a.classList.toggle('active', a.dataset.id === activeId);
      });
      // Save scroll position
      sdk.state.set('docScroll', contentMain.scrollTop);
    });

    function restoreScroll() {
      sdk.state.get('docScroll').then(pos => {
        if (pos) contentMain.scrollTop = pos;
      });
    }

    // --- In-document search ---
    let searchMatches = [];
    let searchIndex = -1;

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        document.getElementById('searchBar').classList.add('visible');
        document.getElementById('searchInput').focus();
      }
      if (e.key === 'Escape') {
        closeSearch();
      }
    });

    document.getElementById('searchClose').addEventListener('click', closeSearch);

    function closeSearch() {
      document.getElementById('searchBar').classList.remove('visible');
      clearHighlights();
    }

    document.getElementById('searchInput').addEventListener('input', (e) => {
      const query = e.target.value.trim();
      clearHighlights();
      if (!query) { document.getElementById('searchCount').textContent = ''; return; }
      highlightMatches(query);
    });

    document.getElementById('searchNext').addEventListener('click', () => navigateMatch(1));
    document.getElementById('searchPrev').addEventListener('click', () => navigateMatch(-1));
    document.getElementById('searchInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') navigateMatch(e.shiftKey ? -1 : 1);
    });

    function highlightMatches(query) {
      const walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT);
      const lowerQuery = query.toLowerCase();
      const nodesToSplit = [];

      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.parentElement.closest('pre, code, .copy-btn')) continue;
        const text = node.textContent.toLowerCase();
        let idx = text.indexOf(lowerQuery);
        while (idx !== -1) {
          nodesToSplit.push({ node, start: idx, length: query.length });
          idx = text.indexOf(lowerQuery, idx + 1);
        }
      }

      searchMatches = [];
      for (let i = nodesToSplit.length - 1; i >= 0; i--) {
        const { node, start, length } = nodesToSplit[i];
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + length);
        const mark = document.createElement('mark');
        range.surroundContents(mark);
        searchMatches.unshift(mark);
      }

      searchIndex = searchMatches.length > 0 ? 0 : -1;
      updateSearchUI();
      if (searchIndex >= 0) scrollToMatch();
    }

    function clearHighlights() {
      contentEl.querySelectorAll('mark').forEach(m => {
        const parent = m.parentNode;
        parent.replaceChild(document.createTextNode(m.textContent), m);
        parent.normalize();
      });
      searchMatches = [];
      searchIndex = -1;
    }

    function navigateMatch(dir) {
      if (searchMatches.length === 0) return;
      searchIndex = (searchIndex + dir + searchMatches.length) % searchMatches.length;
      updateSearchUI();
      scrollToMatch();
    }

    function updateSearchUI() {
      const countEl = document.getElementById('searchCount');
      if (searchMatches.length === 0) {
        countEl.textContent = 'No results';
      } else {
        countEl.textContent = `${searchIndex + 1} of ${searchMatches.length}`;
      }
      searchMatches.forEach((m, i) => m.classList.toggle('current', i === searchIndex));
    }

    function scrollToMatch() {
      if (searchIndex >= 0 && searchMatches[searchIndex]) {
        searchMatches[searchIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    // --- Data loading ---
    const base = window.__OBOTOVS_ROUTES_URL__;
    if (base) {
      fetch(base + '/api/document')
        .then(r => r.text())
        .then(renderDocument)
        .catch(() => {});
    }

    sdk.on('document-content', (data) => {
      renderDocument(typeof data === 'string' ? data : data.content || '');
      if (data.title) document.title = data.title;
    });

    sdk.on('document-append', (data) => {
      const text = typeof data === 'string' ? data : data.content || '';
      rawContent += text;
      renderDocument(rawContent);
    });
  </script>
</body>
</html>
```

## Customization Points

- **Languages**: Add more highlight.js language modules for syntax highlighting
- **TOC depth**: Filter TOC to show only h1/h2 by adjusting the `querySelectorAll` selector
- **Content source**: Switch between route-backed fetch and channel-based push
- **Sidebar**: Toggle TOC visibility or make it collapsible for narrow panels
- **Print/Export**: Add a button that opens `window.print()` with print-friendly styles

## Common Pitfalls

- Load highlight.js language modules for each language you need — the core alone highlights nothing
- Use `marked.parse()` (not `marked()`) in newer versions of the library
- Always sanitize content if it comes from untrusted sources — `marked` does not sanitize by default
- Restore scroll position after rendering, not before — the DOM needs to exist first
- For large documents, consider lazy-rendering sections to keep initial load fast
