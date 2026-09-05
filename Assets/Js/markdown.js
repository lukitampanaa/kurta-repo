/* Minimal Markdown renderer: code fences, tables, headings, lists, quotes, inline fmt, math. */
(function () {
  'use strict';
  window.__codeBlocks = [];
  window.__mathBlocks = [];

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Sederhana: ubah LaTeX umum jadi karakter Unicode (dipakai saat KaTeX tidak tersedia/offline)
  function latexToUnicode(tex) {
    let s = String(tex);
    s = s.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '$1/$2');
    s = s.replace(/\\sqrt\{([^{}]+)\}/g, '√($1)');
    s = s.replace(/\\sqrt/g, '√');
    const greek = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', theta: 'θ', lambda: 'λ', mu: 'μ', pi: 'π', sigma: 'σ', phi: 'φ', omega: 'ω', Delta: 'Δ', Sigma: 'Σ', Omega: 'Ω' };
    s = s.replace(/\\(alpha|beta|gamma|delta|epsilon|theta|lambda|mu|pi|sigma|phi|omega|Delta|Sigma|Omega)\b/g, (m, n) => greek[n] || m);
    const sym = { sum: '∑', prod: '∏', int: '∫', infty: '∞', neq: '≠', leq: '≤', geq: '≥', pm: '±', times: '×', div: '÷', cdot: '·', approx: '≈', in: '∈', to: '→', Rightarrow: '⇒', leftarrow: '←', rightarrow: '→', ldots: '…', forall: '∀', exists: '∃' };
    s = s.replace(/\\(sum|prod|int|infty|neq|leq|geq|pm|times|div|cdot|approx|in|to|Rightarrow|leftarrow|rightarrow|ldots|forall|exists)\b/g, (m, n) => sym[n] || m);
    const sup = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', n: 'ⁿ', x: 'ˣ', '-': '⁻' };
    s = s.replace(/\^\{?([0-9nx-]+)\}?/g, (m, n) => String(n).split('').map((c) => sup[c] || c).join(''));
    const sub = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', n: 'ₙ', i: 'ᵢ' };
    s = s.replace(/_\{?([0-9ni]+)\}?/g, (m, n) => String(n).split('').map((c) => sub[c] || c).join(''));
    s = s.replace(/[{}]/g, '');
    s = s.replace(/\\,/g, ' ').replace(/\\;/g, ' ').replace(/\\!/g, '').replace(/\\ /g, ' ');
    return s.trim();
  }

  function renderMath(tex, display) {
    tex = String(tex).trim();
    if (!tex) return '';
    try {
      if (window.katex) {
        return window.katex.renderToString(tex, { displayMode: !!display, throwOnError: false });
      }
    } catch { /* jatuh ke fallback */ }
    const uni = latexToUnicode(tex);
    return display
      ? `<div class="math-block math-fallback">${esc(uni)}</div>`
      : `<code class="math-inline math-fallback">${esc(uni)}</code>`;
  }

  // Hanya anggap $...$ sebagai rumus bila isinya tampak seperti LaTeX
  // (mencegah "$5 dan $10" ikut ke-render).
  function looksLikeMath(tex) {
    return /\\|\^|_|\{|\}|frac|sqrt|sum|int|pi|alpha|beta|times|cdot|leq|geq|infty/.test(tex);
  }

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function inline(s) {
    s = esc(s);
    // images then links
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1" loading="lazy">');
    s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    s = s.replace(/(^|[^:\w])_([^_]+)_/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    return s;
  }

  function isSepRow(line) {
    const cells = line.trim().replace(/^\||\|$/g, '').split('|');
    return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c.trim()));
  }

  function renderTable(headLine, rows) {
    const head = headLine.trim().replace(/^\||\|$/g, '').split('|').map((c) => `<th>${inline(c.trim())}</th>`).join('');
    const body = rows.map((r) => {
      const tds = r.trim().replace(/^\||\|$/g, '').split('|').map((c) => `<td>${inline(c.trim())}</td>`).join('');
      return `<tr>${tds}</tr>`;
    }).join('');
    return `<div class="tbl-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  function renderMarkdown(src) {
    window.__codeBlocks = [];
    window.__mathBlocks = [];
    // extract fenced code
    src = String(src || '').replace(/```(\w*)\n([\s\S]*?)(```|$)/g, (m, lang, code) => {
      const i = window.__codeBlocks.push({ lang: lang || 'code', code: code.replace(/\n$/, '') }) - 1;
      return `\u0000CODE${i}\u0000`;
    });
    // extract display math $$...$$ (multiline ok)
    src = src.replace(/\$\$([\s\S]+?)\$\$/g, (m, tex) => {
      const i = window.__mathBlocks.push({ tex, display: true }) - 1;
      return `\u0000MATH${i}\u0000`;
    });
    // extract \(...\) display-alt dan \[...\] inline-alt
    src = src.replace(/\\\((.+?)\\\)/g, (m, tex) => {
      const i = window.__mathBlocks.push({ tex, display: false }) - 1;
      return `\u0000MATH${i}\u0000`;
    });
    src = src.replace(/\\\[(.+?)\\\]/g, (m, tex) => {
      const i = window.__mathBlocks.push({ tex, display: true }) - 1;
      return `\u0000MATH${i}\u0000`;
    });
    // extract inline code
    src = src.replace(/`([^`\n]+)`/g, (m, code) => {
      const i = window.__codeBlocks.push({ inline: true, code }) - 1;
      return `\u0000CODE${i}\u0000`;
    });
    // extract inline math $...$ yang tampak seperti LaTeX
    src = src.replace(/\$([^$\n]+?)\$/g, (m, tex) => {
      if (!looksLikeMath(tex)) return m;
      const i = window.__mathBlocks.push({ tex, display: false }) - 1;
      return `\u0000MATH${i}\u0000`;
    });

    const lines = src.split('\n');
    let html = '';
    let listStack = []; // {type, indent}
    let inQuote = false;
    let para = [];

    function flushPara() {
      if (para.length) {
        html += `<p>${inline(para.join(' '))}</p>`;
        para = [];
      }
    }
    function closeLists(toIndent) {
      while (listStack.length && listStack[listStack.length - 1].indent >= toIndent) {
        const l = listStack.pop();
        html += l.type === 'ul' ? '</ul>' : '</ol>';
      }
    }
    function closeQuote() { if (inQuote) { html += '</blockquote>'; inQuote = false; } }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const mathPh = line.match(/^\u0000MATH(\d+)\u0000$/);
      if (mathPh) {
        const b = window.__mathBlocks[+mathPh[1]];
        flushPara(); closeLists(0); closeQuote();
        html += renderMath(b ? b.tex : '', true);
        continue;
      }
      const codePh = line.match(/^\u0000CODE(\d+)\u0000$/);
      if (codePh) {
        const b = window.__codeBlocks[+codePh[1]];
        flushPara(); closeLists(0); closeQuote();
        if (b.inline) html += `<p><code class="ic">${esc(b.code)}</code></p>`;
        else html += `<div class="codeblock"><div class="code-head"><span>${esc(b.lang)}</span><button class="mini-btn" data-copy-code="${codePh[1]}">Salin</button></div><pre><code>${esc(b.code)}</code></pre></div>`;
        continue;
      }
      if (/^\s*$/.test(line)) { flushPara(); closeLists(0); closeQuote(); continue; }

      // table
      if (line.includes('|') && i + 1 < lines.length && isSepRow(lines[i + 1])) {
        flushPara(); closeLists(0); closeQuote();
        const rows = [];
        i += 2;
        while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') { rows.push(lines[i]); i++; }
        i--;
        html += renderTable(line, rows);
        continue;
      }
      // heading
      const h = line.match(/^(#{1,4})\s+(.*)/);
      if (h) {
        flushPara(); closeLists(0); closeQuote();
        html += `<h${h[1].length} class="md-h">${inline(h[2])}</h${h[1].length}>`;
        continue;
      }
      if (/^---+$/.test(line.trim())) { flushPara(); closeLists(0); closeQuote(); html += '<hr>'; continue; }
      // quote
      const q = line.match(/^>\s?(.*)/);
      if (q) {
        flushPara();
        if (!inQuote) { html += '<blockquote>'; inQuote = true; }
        html += inline(q[1]) + '<br>';
        continue;
      } else closeQuote();
      // list
      const lm = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)/);
      if (lm) {
        flushPara();
        const indent = lm[1].length;
        const type = /^\d/.test(lm[2]) ? 'ol' : 'ul';
        while (listStack.length && listStack[listStack.length - 1].indent > indent) {
          const l = listStack.pop();
          html += l.type === 'ul' ? '</ul>' : '</ol>';
        }
        const top = listStack[listStack.length - 1];
        if (!top || top.indent < indent) { html += type === 'ul' ? '<ul>' : '<ol>'; listStack.push({ type, indent }); }
        else if (top.type !== type) { const l = listStack.pop(); html += l.type === 'ul' ? '</ul>' : '</ol>'; html += type === 'ul' ? '<ul>' : '<ol>'; listStack.push({ type, indent }); }
        html += `<li>${inline(lm[3])}</li>`;
        continue;
      }
      closeLists(0);
      para.push(line.trim());
    }
    flushPara(); closeLists(0); closeQuote();

    // restore stray inline code placeholders inside paragraphs
    html = html.replace(/\u0000CODE(\d+)\u0000/g, (m, n) => {
      const b = window.__codeBlocks[+n];
      if (!b) return '';
      if (b.inline) return `<code class="ic">${esc(b.code)}</code>`;
      return `<div class="codeblock"><div class="code-head"><span>${esc(b.lang)}</span><button class="mini-btn" data-copy-code="${n}">Salin</button></div><pre><code>${esc(b.code)}</code></pre></div>`;
    });
    // restore math placeholders
    html = html.replace(/\u0000MATH(\d+)\u0000/g, (m, n) => {
      const b = (window.__mathBlocks || [])[+n];
      if (!b) return '';
      return renderMath(b.tex, b.display);
    });
    return html;
  }

  window.renderMarkdown = renderMarkdown;
})();
