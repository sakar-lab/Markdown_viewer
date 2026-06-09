(() => {
  const editor = document.getElementById('editor');
  const preview = document.getElementById('preview');
  const themeToggle = document.getElementById('theme-toggle');
  const importButton = document.getElementById('import-md');
  const importInput = document.getElementById('import-md-input');

  if (!editor || !preview) {
    return;
  }

  const CONTENT_KEY = 'mathnotes-content-v1';
  const THEME_KEY = 'mathnotes-theme-v1';

  function getStoredTheme() {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch {
      return null;
    }
  }

  function storeTheme(theme) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // ignore
    }
  }

  function applyTheme(theme) {
    const isLight = theme === 'light';
    document.body.classList.toggle('light', isLight);

    if (themeToggle) {
      themeToggle.textContent = isLight ? '☾' : '☀';
      themeToggle.setAttribute(
        'aria-label',
        isLight ? 'Switch to dark mode' : 'Switch to light mode'
      );
    }
  }

  function initTheme() {
    let theme = getStoredTheme();

    if (!theme) {
      const prefersDark =
        window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: dark)').matches;
      theme = prefersDark ? 'dark' : 'light';
    }

    applyTheme(theme);

    if (themeToggle) {
      themeToggle.addEventListener('click', () => {
        const current = document.body.classList.contains('light')
          ? 'light'
          : 'dark';
        const next = current === 'light' ? 'dark' : 'light';
        applyTheme(next);
        storeTheme(next);
      });
    }
  }

  function getInitialContent() {
    let stored = null;
    try {
      stored = localStorage.getItem(CONTENT_KEY);
    } catch {
      stored = null;
    }

    if (stored && stored.trim().length > 0) {
      return stored;
    }

    return (
      '# Math Notes Previewer\n\n' +
      'Welcome! This is a live **Markdown** + LaTeX editor.\n\n' +
      'Inline math: $a^2 + b^2 = c^2$.\n\n' +
      'Display math using double dollars:\n\n' +
      '$$\\int_0^1 x^2 \\, dx = \\frac{1}{3}$$\n\n' +
      'Or using LaTeX delimiters: \\(e^{i\\pi} + 1 = 0\\).\n\n' +
      'You can also write lists, code, and more:\n\n' +
      '- GitHub-flavored Markdown\n' +
      '- Math blocks\n' +
      '- Tables, code, quotes, etc.\n\n' +
      '```math\n' +
      '% This code block is just for illustration.\n' +
      '% Write math normally in the editor.\n' +
      '\\nabla \\cdot \\mathbf{E} = \\frac{\\rho}{\\varepsilon_0}\n' +
      '```\n\n' +
      '```js\n' +
      'const square = (x) => x * x;\n' +
      'console.log(square(5));\n' +
      '```\n\n' +
      '```plantuml\n' +
      '@startuml\n' +
      'Alice -> Bob: Hello math notes\n' +
      'Bob --> Alice: Rendered diagram\n' +
      '@enduml\n' +
      '```\n'
    );
  }

  function storeContent(value) {
    try {
      localStorage.setItem(CONTENT_KEY, value);
    } catch {
      // ignore
    }
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // --- Helpers for hiding the current section in the preview ---

  function findMathBlocks(text) {
    const blocks = [];
    if (!text) return blocks;

    const lines = text.split('\n');
    let offset = 0;
    let openStart = null;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const lineStart = offset;
      const lineEnd = lineStart + line.length;
      const trimmed = line.trim();

      if (trimmed === '$$') {
        if (openStart == null) {
          openStart = lineStart;
        } else {
          const blockStart = openStart;
          const blockEnd = Math.min(lineEnd + 1, text.length);
          blocks.push({ start: blockStart, end: blockEnd });
          openStart = null;
        }
      }

      offset = lineEnd + 1; // +1 for the newline
    }

    return blocks;
  }

  function findLineBounds(text, pos) {
    if (!text) return null;

    const clamped = Math.max(0, Math.min(pos, text.length));
    const lineStart = text.lastIndexOf('\n', clamped - 1) + 1;
    const nextNewline = text.indexOf('\n', clamped);
    const lineEnd = nextNewline === -1 ? text.length : nextNewline + 1;

    return { start: lineStart, end: lineEnd };
  }

  function getHiddenRange(text) {
    if (!text || document.activeElement !== editor) return null;

    const selStart = typeof editor.selectionStart === 'number' ? editor.selectionStart : 0;
    const selEnd = typeof editor.selectionEnd === 'number' ? editor.selectionEnd : selStart;
    // If there is an explicit selection, hide exactly that selected range
    if (selStart !== selEnd) {
      const start = Math.min(selStart, selEnd);
      const end = Math.max(selStart, selEnd);
      return { start, end };
    }

    const pos = selStart;

    // First, see if the cursor is inside a $$...$$ math block (with $$ on its own line)
    const mathBlocks = findMathBlocks(text);
    for (const block of mathBlocks) {
      if (pos >= block.start && pos <= block.end) {
        return block;
      }
    }

    // Otherwise, hide just the current line
    return findLineBounds(text, pos);
  }

  // Ensure single backslashes before parentheses survive Markdown parsing
  // so MathJax can see \( ... \) inline delimiters.
  function escapeInlineParens(text) {
    if (!text) return '';

    // Turn \( into \\( so that HTML contains \(, and similarly for \).
    // Only do this when the backslash itself is not already escaped.
    return text
      .replace(/(^|[^\\])\\\(/g, '$1\\\\(')
      .replace(/(^|[^\\])\\\)/g, '$1\\\\)');
  }

  function transformMathCodeFences(text) {
    if (!text) return '';

    const lines = text.split('\n');
    const out = [];
    let inMathFence = false;
    let fenceIndent = '';

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];

      if (!inMathFence) {
        const match = line.match(/^(\s*)```math\s*$/);
        if (match) {
          inMathFence = true;
          fenceIndent = match[1] || '';
          out.push(`${fenceIndent}$$`);
          continue;
        }
      } else {
        const trimmed = line.trimStart();
        if (trimmed.startsWith('```')) {
          out.push(`${fenceIndent}$$`);
          inMathFence = false;
          fenceIndent = '';
          continue;
        }
      }

      out.push(line);
    }

    if (inMathFence) {
      out.push(`${fenceIndent}$$`);
    }

    return out.join('\n');
  }

  function plantUmlSource(text) {
    const trimmed = text.trim();
    if (/^@start\w+/i.test(trimmed)) {
      return trimmed;
    }
    return `@startuml\n${trimmed}\n@enduml`;
  }

  function encodePlantUml(text) {
    if (!window.pako) return null;

    const bytes = new TextEncoder().encode(plantUmlSource(text));
    const compressed = window.pako.deflateRaw(bytes, { level: 9 });
    const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';
    let encoded = '';

    function append3bytes(b1, b2, b3) {
      const c1 = b1 >> 2;
      const c2 = ((b1 & 0x3) << 4) | (b2 >> 4);
      const c3 = ((b2 & 0xf) << 2) | (b3 >> 6);
      const c4 = b3 & 0x3f;
      encoded += alphabet[c1 & 0x3f] + alphabet[c2 & 0x3f] + alphabet[c3 & 0x3f] + alphabet[c4 & 0x3f];
    }

    for (let i = 0; i < compressed.length; i += 3) {
      append3bytes(compressed[i], compressed[i + 1] || 0, compressed[i + 2] || 0);
    }

    return encoded;
  }

  function transformPlantUmlFences(text) {
    return (text || '').replace(/```plantuml\s*\n([\s\S]*?)```/gi, (_match, diagram) => {
      const encoded = encodePlantUml(diagram);
      if (!encoded) {
        return `\`\`\`plantuml\n${diagram.trim()}\n\`\`\``;
      }

      const src = `https://www.plantuml.com/plantuml/svg/${encoded}`;
      return [
        '<figure class="plantuml-diagram">',
        `<img src="${src}" alt="PlantUML diagram" loading="lazy" />`,
        '</figure>'
      ].join('');
    });
  }

  if (typeof marked !== 'undefined') {
    marked.setOptions({
      breaks: true,
      gfm: true,
      headerIds: true,
      mangle: false
    });
  }

  const loadedHighlightLanguages = new Set();
  const loadingHighlightLanguages = new Map();
  const languageAliases = {
    cplusplus: 'cpp',
    cxx: 'cpp',
    hpp: 'cpp',
    py: 'python',
    rb: 'ruby',
    rs: 'rust',
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    sh: 'bash',
    shell: 'bash',
    zsh: 'bash',
    yml: 'yaml',
    md: 'markdown',
    csharp: 'csharp',
    'c#': 'csharp',
    fsharp: 'fsharp',
    'f#': 'fsharp',
    objc: 'objectivec',
    'objective-c': 'objectivec',
    ps1: 'powershell',
    pwsh: 'powershell',
    dockerfile: 'dockerfile',
    html: 'xml',
    svg: 'xml'
  };

  function normalizeLanguage(language) {
    const normalized = (language || '').toLowerCase().replace(/[^a-z0-9+#-]/g, '');
    return languageAliases[normalized] || normalized;
  }

  function loadHighlightLanguage(language) {
    const normalized = normalizeLanguage(language);
    if (!window.hljs || !normalized || window.hljs.getLanguage(normalized)) {
      return Promise.resolve();
    }

    if (loadedHighlightLanguages.has(normalized)) {
      return Promise.resolve();
    }

    if (loadingHighlightLanguages.has(normalized)) {
      return loadingHighlightLanguages.get(normalized);
    }

    const promise = new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = `https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.9.0/languages/${normalized}.min.js`;
      script.defer = true;
      script.onload = () => {
        loadedHighlightLanguages.add(normalized);
        resolve();
      };
      script.onerror = () => resolve();
      document.head.append(script);
    }).finally(() => {
      loadingHighlightLanguages.delete(normalized);
    });

    loadingHighlightLanguages.set(normalized, promise);
    return promise;
  }

  function highlightCode(root) {
    root.querySelectorAll('pre code').forEach((block) => {
      if (block.dataset.highlighted === 'yes') return;

      const languageClass = Array.from(block.classList).find((className) =>
        className.startsWith('language-')
      );
      const language = normalizeLanguage(languageClass ? languageClass.replace('language-', '') : '');
      const raw = block.textContent;
      if (language) {
        block.closest('pre')?.setAttribute('data-language', language);
      }

      try {
        if (window.hljs) {
          const result =
            language && window.hljs.getLanguage(language)
              ? window.hljs.highlight(raw, { language })
              : window.hljs.highlightAuto(raw);
          block.innerHTML = result.value;
        } else {
          block.innerHTML = basicHighlight(raw);
        }
        block.classList.add('hljs');
        block.dataset.highlighted = 'yes';

        if (window.hljs && language && !window.hljs.getLanguage(language)) {
          loadHighlightLanguage(language).then(() => {
            if (!window.hljs.getLanguage(language)) return;
            block.innerHTML = window.hljs.highlight(raw, { language }).value;
            block.classList.add('hljs');
            block.dataset.highlighted = 'yes';
          });
        }
      } catch {
        block.innerHTML = basicHighlight(raw);
        block.classList.add('hljs');
        block.dataset.highlighted = 'yes';
      }
    });
  }

  function basicHighlight(raw) {
    const tokenPattern =
      /(\/\/.*$)|(["'`])(?:\\.|(?!\2).)*\2|\b\d+(?:\.\d+)?\b|\b(?:const|let|var|function|return|if|else|for|while|class|new|await|async|import|export|from|console|log)\b/gm;
    let html = '';
    let lastIndex = 0;
    let match;

    while ((match = tokenPattern.exec(raw)) !== null) {
      html += escapeHtml(raw.slice(lastIndex, match.index));
      const token = match[0];
      let className = 'code-keyword';

      if (token.startsWith('//')) {
        className = 'code-comment';
      } else if (/^["'`]/.test(token)) {
        className = 'code-string';
      } else if (/^\d/.test(token)) {
        className = 'code-number';
      }

      html += `<span class="${className}">${escapeHtml(token)}</span>`;
      lastIndex = tokenPattern.lastIndex;
    }

    html += escapeHtml(raw.slice(lastIndex));
    return html;
  }

  function updatePreview() {
    const markdown = editor.value || '';

    // Determine the current section (line, math block, or explicit selection)
    const hidden = getHiddenRange(markdown);

    const preprocess = (text) =>
      transformPlantUmlFences(transformMathCodeFences(escapeInlineParens(text || '')));

    let html = '';

    if (hidden && hidden.start < hidden.end && document.activeElement === editor) {
      const { start, end } = hidden;
      const before = markdown.slice(0, start);
      const segment = markdown.slice(start, end);
      const after = markdown.slice(end);

      const beforeRendered = typeof marked !== 'undefined'
        ? marked.parse(preprocess(before))
        : escapeHtml(preprocess(before)).replace(/\n/g, '<br />');

      const afterRendered = typeof marked !== 'undefined'
        ? marked.parse(preprocess(after))
        : escapeHtml(preprocess(after)).replace(/\n/g, '<br />');

      // Show the current section in original Markdown form inside the preview
      const rawEscaped = escapeHtml(segment).replace(/\n/g, '<br />');
      const rawBlock = `<div class="raw-section">${rawEscaped}</div>`;

      html = `${beforeRendered}${rawBlock}${afterRendered}`;
    } else {
      const all = preprocess(markdown);

      if (typeof marked !== 'undefined') {
        html = marked.parse(all);
      } else {
        html = escapeHtml(all).replace(/\n/g, '<br />');
      }
    }

    preview.innerHTML = html;
    highlightCode(preview);

    if (window.MathJax && typeof MathJax.typesetPromise === 'function') {
      return MathJax.typesetPromise([preview]).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('MathJax typeset failed:', err);
      });
    }

    return Promise.resolve();
  }

  let renderTimeout;

  function scheduleRender() {
    clearTimeout(renderTimeout);
    renderTimeout = setTimeout(() => {
      updatePreview();
      storeContent(editor.value);
    }, 120);
  }

  function initEditor() {
    editor.value = getInitialContent();
    updatePreview();

    editor.addEventListener('input', scheduleRender);
    editor.addEventListener('click', scheduleRender);
    editor.addEventListener('keyup', scheduleRender);
    editor.addEventListener('blur', scheduleRender);
  }

  function loadContent(value) {
    editor.value = (value || '').replace(/\r\n?/g, '\n');
    storeContent(editor.value);

    if (window.MathNotesLiveEditor && typeof window.MathNotesLiveEditor.load === 'function') {
      window.MathNotesLiveEditor.load(editor.value);
    }

    return updatePreview();
  }

  function initImport() {
    if (!importButton || !importInput) return;

    importButton.addEventListener('click', () => {
      importInput.click();
    });

    importInput.addEventListener('change', async () => {
      const file = importInput.files && importInput.files[0];
      importInput.value = '';
      if (!file) return;

      try {
        const text = await file.text();
        await loadContent(text);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Markdown import failed:', err);
        window.alert('Could not import that Markdown file.');
      }
    });
  }

  function initFileHandling() {
    if (!('launchQueue' in window)) {
      return;
    }

    window.launchQueue.setConsumer(async (launchParams) => {
      if (!launchParams.files || launchParams.files.length === 0) {
        return;
      }

      try {
        const fileHandle = launchParams.files[0];
        const file = await fileHandle.getFile();
        const text = await file.text();
        await loadContent(text);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Could not open launched Markdown file:', err);
        window.alert('Could not open that Markdown file.');
      }
    });
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      return;
    }

    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => registration.unregister());
      });
      return;
    }

    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('sw.js')
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.warn('Service worker registration failed:', err);
        });
    });
  }

  // Initialize app
  initTheme();
  initEditor();
  window.MathNotesApp = {
    ready: true,
    getContent: () => editor.value || '',
    setContent: loadContent,
    renderNow: () => {
      clearTimeout(renderTimeout);
      storeContent(editor.value);
      return updatePreview();
    }
  };
  window.dispatchEvent(new CustomEvent('mathnotes:ready'));
  initImport();
  initFileHandling();
  registerServiceWorker();
})();
