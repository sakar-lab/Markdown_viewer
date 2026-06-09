const sourceTextarea = document.getElementById('editor');
const liveRoot = document.getElementById('cm-live-root');
const preview = document.getElementById('preview');

if (sourceTextarea && liveRoot && preview) {
  let blocks = [];
  let activeIndex = -1;
  let renderQueued = false;

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeInlineParens(text) {
    return (text || '')
      .replace(/(^|[^\\])\\\(/g, '$1\\\\(')
      .replace(/(^|[^\\])\\\)/g, '$1\\\\)');
  }

  function transformMathCodeFences(text) {
    const lines = (text || '').split('\n');
    const out = [];
    let inMathFence = false;
    let fenceIndent = '';

    for (const line of lines) {
      if (!inMathFence) {
        const match = line.match(/^(\s*)```math\s*$/);
        if (match) {
          inMathFence = true;
          fenceIndent = match[1] || '';
          out.push(`${fenceIndent}$$`);
          continue;
        }
      } else if (line.trimStart().startsWith('```')) {
        out.push(`${fenceIndent}$$`);
        inMathFence = false;
        fenceIndent = '';
        continue;
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

  function preprocess(text) {
    return transformPlantUmlFences(transformMathCodeFences(escapeInlineParens(text || '')));
  }

  function renderMarkdown(text) {
    const prepared = preprocess(text);
    if (typeof marked !== 'undefined') {
      return marked.parse(prepared);
    }
    return escapeHtml(prepared).replace(/\n/g, '<br />');
  }

  function splitBlocks(markdown) {
    const lines = (markdown || '').split('\n');
    const result = [];
    let current = [];
    let inFence = false;
    let inMath = false;

    function pushCurrent() {
      if (!current.length) return;
      result.push(current.join('\n'));
      current = [];
    }

    for (const line of lines) {
      const trimmed = line.trim();
      const startsFence = trimmed.startsWith('```');
      const isMathFence = trimmed === '$$';

      if (!inFence && !inMath && trimmed === '') {
        pushCurrent();
        continue;
      }

      current.push(line);

      if (!inMath && startsFence) {
        inFence = !inFence;
      } else if (!inFence && isMathFence) {
        inMath = !inMath;
      }
    }

    pushCurrent();
    return result.length ? result : [''];
  }

  function joinBlocks() {
    return blocks.join('\n\n');
  }

  function syncSource() {
    sourceTextarea.value = joinBlocks();
    sourceTextarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function autosize(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }

  function focusTextarea(textarea) {
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.selectionStart = textarea.value.length;
      textarea.selectionEnd = textarea.value.length;
      autosize(textarea);
    });
  }

  function activateBlock(index) {
    if (index === activeIndex) return;
    activeIndex = index;
    renderLive();
  }

  function activateFromPointer(event, index) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    activateBlock(index);
  }

  function deactivateBlock() {
    if (activeIndex === -1) return;
    syncSource();
    activeIndex = -1;
    renderLive();
  }

  function findBlockShell(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    for (const item of path) {
      if (item && item.classList && item.classList.contains('live-block-shell')) {
        return item;
      }
    }
    return event.target.closest ? event.target.closest('.live-block-shell') : null;
  }

  function typeset(element) {
    if (window.MathJax && typeof MathJax.typesetPromise === 'function') {
      if (typeof MathJax.typesetClear === 'function') {
        MathJax.typesetClear([element]);
      }
      MathJax.typesetPromise([element]).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('MathJax typeset failed:', err);
      });
    }
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

  function createEditBlock(text, index) {
    const textarea = document.createElement('textarea');
    textarea.className = 'live-block-editor';
    textarea.spellcheck = false;
    textarea.value = text;

    textarea.addEventListener('input', () => {
      blocks[index] = textarea.value;
      autosize(textarea);
      syncSource();
    });

    textarea.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        activeIndex = Math.min(index + 1, blocks.length - 1);
        renderLive();
      }

      if (event.key === 'ArrowUp' && textarea.selectionStart === 0 && index > 0) {
        activeIndex = index - 1;
        renderLive();
      }

      if (
        event.key === 'ArrowDown' &&
        textarea.selectionStart === textarea.value.length &&
        index < blocks.length - 1
      ) {
        activeIndex = index + 1;
        renderLive();
      }
    });

    textarea.addEventListener('blur', () => {
      blocks[index] = textarea.value;
      syncSource();
    });

    return textarea;
  }

  function createRenderedBlock(text, index) {
    const block = document.createElement('div');
    block.className = 'live-block markdown-body';
    block.innerHTML = renderMarkdown(text || '&nbsp;');
    highlightCode(block);
    block.tabIndex = 0;
    block.addEventListener('pointerdown', (event) => {
      activateFromPointer(event, index);
    });
    block.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      activateBlock(index);
    });
    return block;
  }

  function createEditButton(index) {
    const button = document.createElement('button');
    button.className = 'live-edit-button';
    button.type = 'button';
    button.textContent = 'Edit';
    button.setAttribute('aria-label', 'Edit this block');
    button.addEventListener('pointerdown', (event) => {
      activateFromPointer(event, index);
    });
    return button;
  }

  function renderLive() {
    renderQueued = false;
    liveRoot.textContent = '';

    blocks.forEach((blockText, index) => {
      const wrapper = document.createElement('div');
      wrapper.className = index === activeIndex ? 'live-block-shell active' : 'live-block-shell';
      wrapper.dataset.blockIndex = String(index);

      if (index === activeIndex) {
        const textarea = createEditBlock(blockText, index);
        wrapper.append(textarea);
        liveRoot.append(wrapper);
        focusTextarea(textarea);
      } else {
        wrapper.tabIndex = 0;
        wrapper.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            activateBlock(index);
          }
        });
        wrapper.append(createRenderedBlock(blockText, index));
        wrapper.append(createEditButton(index));
        liveRoot.append(wrapper);
      }
    });

    typeset(liveRoot);
  }

  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(renderLive);
  }

  function initLiveEditor() {
    blocks = splitBlocks(
      window.MathNotesApp ? window.MathNotesApp.getContent() : sourceTextarea.value
    );
    activeIndex = blocks.length === 1 && blocks[0] === '' ? 0 : -1;
    liveRoot.style.display = 'block';
    sourceTextarea.style.display = 'none';
    preview.style.display = 'none';
    renderLive();
  }

  function loadMarkdown(markdown) {
    blocks = splitBlocks(markdown || '');
    activeIndex = blocks.length === 1 && blocks[0] === '' ? 0 : -1;
    sourceTextarea.value = joinBlocks();
    liveRoot.style.display = 'block';
    sourceTextarea.style.display = 'none';
    preview.style.display = 'none';
    renderLive();
  }

  window.MathNotesLiveEditor = {
    sync: syncSource,
    getContent: joinBlocks,
    load: loadMarkdown
  };

  document.addEventListener('pointerdown', (event) => {
    if (!liveRoot.contains(event.target)) {
      deactivateBlock();
    }
  });

  liveRoot.addEventListener(
    'pointerdown',
    (event) => {
      if (event.button !== 0) return;
      if (event.target.closest('.live-block-editor')) return;
      if (event.target.closest('.live-edit-button')) return;

      const shell = findBlockShell(event);
      if (!shell || !liveRoot.contains(shell)) return;

      const index = Number(shell.dataset.blockIndex);
      if (!Number.isInteger(index) || index === activeIndex) return;

      event.preventDefault();
      activateBlock(index);
    },
    true
  );

  if (window.MathNotesApp && window.MathNotesApp.ready) {
    initLiveEditor();
  } else {
    window.addEventListener('mathnotes:ready', initLiveEditor, { once: true });
  }
}
