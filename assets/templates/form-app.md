---
name: templates/form-app
description: Build a multi-step form with validation and submission
when: user asks for form, wizard, input, settings, configuration, or data entry UI
---

# Form App Surface Template

## Overview

A multi-step form with field validation, route-backed submission, success/error states, and persistent draft saving. Use for configuration UIs, data entry, settings panels, or wizard flows.

## Required SDK APIs

- `window.__obotovs.emit(channel, data)` — send form data to the extension
- `window.__obotovs.on(channel, handler)` — receive validation results or prefill data
- `window.__obotovs.state` — auto-save draft between sessions
- `window.__obotovs.executeTool(tool, kwargs)` — call tools with form data
- `window.__OBOTOVS_ROUTES_URL__` — submit to route endpoints

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
    .form-container {
      max-width: 640px; margin: 0 auto; padding: 24px;
    }
    .field {
      margin-bottom: 16px;
    }
    .field label {
      display: block; font-size: 13px; font-weight: 500;
      margin-bottom: 4px;
    }
    .field .hint {
      font-size: 11px; opacity: 0.6; margin-top: 2px;
    }
    .field .error {
      font-size: 11px; color: var(--vscode-errorForeground); margin-top: 2px;
    }
    input[type="text"], input[type="email"], input[type="number"],
    input[type="url"], input[type="password"], textarea, select {
      width: 100%; box-sizing: border-box;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      padding: 8px 10px; border-radius: 4px; font-size: 13px;
      font-family: inherit;
    }
    input:focus, textarea:focus, select:focus {
      outline: none;
      border-color: var(--vscode-focusBorder);
    }
    input.invalid, textarea.invalid, select.invalid {
      border-color: var(--vscode-errorForeground);
    }
    textarea { min-height: 80px; resize: vertical; }
    .checkbox-row {
      display: flex; align-items: center; gap: 8px; font-size: 13px;
    }
    .btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none; cursor: pointer; padding: 8px 20px;
      border-radius: 4px; font-size: 13px; font-weight: 500;
    }
    .btn:hover { background: var(--vscode-button-hoverBackground); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .steps {
      display: flex; gap: 4px; margin-bottom: 24px;
    }
    .step {
      flex: 1; height: 4px; border-radius: 2px;
      background: var(--vscode-editorWidget-border);
    }
    .step.active { background: var(--vscode-focusBorder); }
    .step.done { background: var(--vscode-testing-iconPassed, #10b981); }
    .result-card {
      background: var(--vscode-editorWidget-background);
      border: 1px solid var(--vscode-editorWidget-border);
      border-radius: 8px; padding: 24px; text-align: center;
    }
  </style>
</head>
<body>
  <div class="form-container">
    <h2 id="title" class="text-lg font-semibold mb-1">Form</h2>
    <p id="subtitle" class="text-sm opacity-60 mb-4"></p>

    <!-- Step indicators -->
    <div class="steps" id="steps"></div>

    <!-- Form pages (one visible at a time) -->
    <form id="form" novalidate>
      <div id="page-container"></div>

      <div class="flex justify-between mt-6">
        <button type="button" id="backBtn" class="btn btn-secondary" style="display:none">Back</button>
        <div class="flex-1"></div>
        <button type="button" id="nextBtn" class="btn">Next</button>
        <button type="submit" id="submitBtn" class="btn" style="display:none">Submit</button>
      </div>
    </form>

    <!-- Success / Error states -->
    <div id="result" style="display:none"></div>
  </div>

  <script>
    const sdk = window.__obotovs;
    let currentPage = 0;
    let formData = {};

    // --- Define your form schema ---
    const schema = {
      title: 'Configuration',
      subtitle: 'Fill in the details below',
      pages: [
        {
          label: 'Basic Info',
          fields: [
            { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Enter name' },
            { name: 'email', label: 'Email', type: 'email', required: true, hint: 'We will not share this' },
            { name: 'role', label: 'Role', type: 'select', options: ['Developer', 'Designer', 'Manager', 'Other'] },
          ],
        },
        {
          label: 'Details',
          fields: [
            { name: 'description', label: 'Description', type: 'textarea', placeholder: 'Tell us more...' },
            { name: 'count', label: 'Count', type: 'number', min: 0, max: 100, value: 1 },
            { name: 'agree', label: 'I agree to the terms', type: 'checkbox', required: true },
          ],
        },
      ],
    };

    // --- Build UI from schema ---
    document.getElementById('title').textContent = schema.title;
    document.getElementById('subtitle').textContent = schema.subtitle || '';

    function buildSteps() {
      const container = document.getElementById('steps');
      container.innerHTML = schema.pages.map((_, i) =>
        `<div class="step ${i < currentPage ? 'done' : ''} ${i === currentPage ? 'active' : ''}"></div>`
      ).join('');
    }

    function buildField(f) {
      if (f.type === 'checkbox') {
        return `<div class="field">
          <div class="checkbox-row">
            <input type="checkbox" id="f-${f.name}" name="${f.name}" ${f.required ? 'required' : ''} ${formData[f.name] ? 'checked' : ''} />
            <label for="f-${f.name}">${esc(f.label)}${f.required ? ' *' : ''}</label>
          </div>
          <div class="error" id="err-${f.name}"></div>
        </div>`;
      }
      if (f.type === 'select') {
        return `<div class="field">
          <label for="f-${f.name}">${esc(f.label)}${f.required ? ' *' : ''}</label>
          <select id="f-${f.name}" name="${f.name}" ${f.required ? 'required' : ''}>
            <option value="">Select...</option>
            ${(f.options || []).map(o => `<option value="${esc(o)}" ${formData[f.name] === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}
          </select>
          <div class="error" id="err-${f.name}"></div>
        </div>`;
      }
      if (f.type === 'textarea') {
        return `<div class="field">
          <label for="f-${f.name}">${esc(f.label)}${f.required ? ' *' : ''}</label>
          <textarea id="f-${f.name}" name="${f.name}" placeholder="${esc(f.placeholder || '')}" ${f.required ? 'required' : ''}>${esc(formData[f.name] || '')}</textarea>
          ${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}
          <div class="error" id="err-${f.name}"></div>
        </div>`;
      }
      return `<div class="field">
        <label for="f-${f.name}">${esc(f.label)}${f.required ? ' *' : ''}</label>
        <input type="${f.type || 'text'}" id="f-${f.name}" name="${f.name}"
          placeholder="${esc(f.placeholder || '')}"
          ${f.min != null ? `min="${f.min}"` : ''}
          ${f.max != null ? `max="${f.max}"` : ''}
          value="${esc(formData[f.name] != null ? String(formData[f.name]) : (f.value != null ? String(f.value) : ''))}"
          ${f.required ? 'required' : ''} />
        ${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}
        <div class="error" id="err-${f.name}"></div>
      </div>`;
    }

    function renderPage() {
      const page = schema.pages[currentPage];
      document.getElementById('page-container').innerHTML = page.fields.map(buildField).join('');
      buildSteps();

      document.getElementById('backBtn').style.display = currentPage > 0 ? '' : 'none';
      const isLast = currentPage === schema.pages.length - 1;
      document.getElementById('nextBtn').style.display = isLast ? 'none' : '';
      document.getElementById('submitBtn').style.display = isLast ? '' : 'none';
    }

    function collectPageData() {
      const page = schema.pages[currentPage];
      for (const f of page.fields) {
        const el = document.getElementById('f-' + f.name);
        if (!el) continue;
        if (f.type === 'checkbox') formData[f.name] = el.checked;
        else if (f.type === 'number') formData[f.name] = el.value === '' ? null : Number(el.value);
        else formData[f.name] = el.value;
      }
    }

    function validatePage() {
      collectPageData();
      const page = schema.pages[currentPage];
      let valid = true;
      for (const f of page.fields) {
        const el = document.getElementById('f-' + f.name);
        const errEl = document.getElementById('err-' + f.name);
        if (!el || !errEl) continue;
        let msg = '';
        if (f.required) {
          if (f.type === 'checkbox' && !el.checked) msg = 'Required';
          else if (f.type !== 'checkbox' && !el.value.trim()) msg = 'Required';
        }
        if (f.type === 'email' && el.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(el.value)) {
          msg = 'Invalid email';
        }
        errEl.textContent = msg;
        el.classList.toggle('invalid', !!msg);
        if (msg) valid = false;
      }
      return valid;
    }

    // --- Navigation ---
    document.getElementById('nextBtn').addEventListener('click', () => {
      if (!validatePage()) return;
      currentPage++;
      renderPage();
      saveDraft();
    });

    document.getElementById('backBtn').addEventListener('click', () => {
      collectPageData();
      currentPage--;
      renderPage();
    });

    // --- Submission ---
    document.getElementById('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!validatePage()) return;

      const submitBtn = document.getElementById('submitBtn');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting...';

      try {
        // Option A: Submit via route
        const base = window.__OBOTOVS_ROUTES_URL__;
        if (base) {
          const res = await fetch(base + '/api/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData),
          });
          if (!res.ok) throw new Error('Server returned ' + res.status);
          const result = await res.json();
          showResult(true, result.message || 'Submitted successfully');
        } else {
          // Option B: Emit to agent via channel
          sdk.emit('form-submit', formData);
          showResult(true, 'Data sent to agent');
        }
        sdk.state.set('formDraft', null);
      } catch (err) {
        showResult(false, err.message);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit';
      }
    });

    function showResult(success, message) {
      document.getElementById('form').style.display = 'none';
      document.getElementById('steps').style.display = 'none';
      const el = document.getElementById('result');
      el.style.display = '';
      el.innerHTML = `
        <div class="result-card">
          <div class="text-3xl mb-3">${success ? '&#10003;' : '&#10007;'}</div>
          <div class="text-lg font-medium mb-2">${success ? 'Success' : 'Error'}</div>
          <div class="text-sm opacity-70 mb-4">${esc(message)}</div>
          <button class="btn btn-secondary" onclick="location.reload()">
            ${success ? 'Submit Another' : 'Try Again'}
          </button>
        </div>`;
    }

    // --- Draft persistence ---
    function saveDraft() {
      collectPageData();
      sdk.state.set('formDraft', { data: formData, page: currentPage });
    }

    sdk.state.get('formDraft').then(draft => {
      if (draft) {
        formData = draft.data || {};
        currentPage = draft.page || 0;
      }
      renderPage();
    });

    // Auto-save on input
    document.getElementById('form').addEventListener('input', () => {
      clearTimeout(window._draftTimer);
      window._draftTimer = setTimeout(saveDraft, 500);
    });

    // --- Receive prefill data ---
    sdk.on('form-prefill', (data) => {
      formData = { ...formData, ...data };
      renderPage();
    });

    sdk.on('form-schema', (newSchema) => {
      Object.assign(schema, newSchema);
      currentPage = 0;
      formData = {};
      renderPage();
    });

    function esc(s) {
      const d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }
  </script>
</body>
</html>
```

## Customization Points

- **Schema**: Edit the `schema` object to define fields, pages, and validation rules
- **Submission target**: Switch between route-backed POST and channel-based `form-submit` emission
- **Validation**: Add custom validators per field (regex, async uniqueness checks)
- **Layout**: Change from single-column to grid layout for wider forms
- **Dynamic fields**: Push a new schema via `form-schema` channel to reconfigure at runtime

## Common Pitfalls

- Always escape user-visible values with `esc()` — field labels might come from data
- Use `novalidate` on the `<form>` to prevent browser validation UI — handle it in JS
- Save drafts on `input` event, not `change` — `change` only fires on blur
- For file uploads, use `FormData` and `fetch` with no `Content-Type` header (let browser set boundary)
- Test with keyboard navigation — ensure tab order and Enter key behavior work correctly
