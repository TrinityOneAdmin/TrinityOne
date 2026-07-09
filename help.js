// help.js — extracted from help.html so it runs under strict CSP (no inline scripts).
  // ── illustrations (vanilla SVG, matches the app set) ──
  function illo(name, size, tone, soft) {
    tone = tone || 'var(--clay)'; soft = soft || 'var(--clay-soft)';
    const s = `fill="none" stroke="${tone}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"`;
    const fs = `fill="${soft}" stroke="none"`;
    const art = {
      shield: `<circle cx="60" cy="58" r="30" ${fs}/><path d="M60 26 86 36v20c0 18-12 29-26 34-14-5-26-16-26-34V36Z" ${s}/><path d="m49 57 7 7 15-16" ${s}/>`,
      paper: `<rect x="26" y="22" width="52" height="64" rx="6" ${fs}/><rect x="26" y="22" width="52" height="64" rx="6" ${s}/><path d="M36 40h26M36 52h32M36 64h20" ${s} stroke-width="3.4"/><path d="M70 78c6-3 11-9 16-19 2-4-3-8-6-5-6 6-9 14-10 24Z" ${s}/><path d="m83 53 4-6" ${s}/>`,
      face: `<circle cx="60" cy="56" r="30" ${fs}/><circle cx="60" cy="56" r="30" ${s}/><circle cx="60" cy="48" r="9" ${s}/><path d="M44 74c3-7 9-11 16-11s13 4 16 11" ${s}/>`,
      phone: `<rect x="22" y="30" width="34" height="56" rx="7" ${fs}/><rect x="22" y="30" width="34" height="56" rx="7" ${s}/><rect x="66" y="22" width="34" height="56" rx="7" ${s}/><path d="M58 56h8m0 0-3-3m3 3-3 3" ${s} stroke-width="3.4"/>`,
      noask: `<circle cx="60" cy="56" r="30" ${fs}/><path d="M48 60V44a4 4 0 0 1 8 0v12m0-2v-4a4 4 0 0 1 8 0v6m0-3a4 4 0 0 1 8 0v9c0 9-6 15-15 15s-13-5-16-13l-2-5c-1-4 4-6 6-3l3 5" ${s}/><circle cx="60" cy="56" r="30" ${s}/><path d="M38 34 82 78" stroke="${tone}" stroke-width="4" stroke-linecap="round"/>`,
      wallet: `<rect x="24" y="38" width="60" height="44" rx="9" ${fs}/><rect x="24" y="38" width="60" height="44" rx="9" ${s}/><path d="M24 50c10-12 26-18 40-14l14 4" ${s}/><circle cx="74" cy="60" r="6" ${s}/>`,
      qr: `<rect x="28" y="28" width="64" height="64" rx="8" ${fs}/><rect x="28" y="28" width="64" height="64" rx="8" ${s}/><rect x="40" y="40" width="14" height="14" rx="3" ${s} stroke-width="3.4"/><rect x="66" y="40" width="14" height="14" rx="3" ${s} stroke-width="3.4"/><rect x="40" y="66" width="14" height="14" rx="3" ${s} stroke-width="3.4"/><path d="M66 66h6v6m8 0v.04M72 80h.04M80 80v-6" ${s} stroke-width="3.4"/>`,
      safe: `<rect x="24" y="30" width="62" height="56" rx="8" ${fs}/><rect x="24" y="30" width="62" height="56" rx="8" ${s}/><circle cx="58" cy="58" r="13" ${s}/><path d="M58 58v-6M58 58l5 3" ${s} stroke-width="3.4"/><path d="M34 86v6M76 86v6" ${s}/>`,
      book: `<path d="M60 34c-7-6-17-8-28-7-3 0-5 2-5 5v36c0 3 2 5 5 5 11-1 21 1 28 7" ${fs}/><path d="M60 34c-7-6-17-8-28-7-3 0-5 2-5 5v36c0 3 2 5 5 5 11-1 21 1 28 7 7-6 17-8 28-7 3 0 5-2 5-5V32c0-3-2-5-5-5-11-1-21 1-28 7Z" ${s}/><path d="M60 34v46" ${s} stroke-width="3.4"/>`,
      people: `<circle cx="60" cy="56" r="30" ${fs}/><circle cx="48" cy="48" r="9" ${s}/><circle cx="73" cy="51" r="7" ${s}/><path d="M33 76c2-8 8-13 15-13s13 5 15 13" ${s}/><path d="M66 70c2-5 6-8 11-8 5 0 9 3 11 8" ${s} stroke-width="3.4"/>`,
      bell: `<circle cx="60" cy="54" r="30" ${fs}/><path d="M44 68c-3 0-4-3-2-5 3-3 5-6 5-12a13 13 0 0 1 26 0c0 6 2 9 5 12 2 2 1 5-2 5Z" ${s}/><path d="M54 74a6 6 0 0 0 12 0" ${s} stroke-width="3.4"/><path d="M60 33v-5" ${s} stroke-width="3.4"/><circle cx="80" cy="40" r="6" fill="${tone}" stroke="none"/>`,
      heart: `<circle cx="60" cy="56" r="30" ${fs}/><path d="M60 74c-12-7-20-14-20-23a10 10 0 0 1 20-3 10 10 0 0 1 20 3c0 9-8 16-20 23Z" ${s}/>`,
    };
    return `<svg width="${size}" height="${size}" viewBox="0 0 120 116">${art[name] || art.shield}</svg>`;
  }
  document.getElementById('recIllo').innerHTML = illo('paper', 150, 'rgba(255,255,255,.55)', 'rgba(255,255,255,.16)');

  const ic = (d, st) => `<svg width="${st||20}" height="${st||20}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const CHECK = '<path d="m5 12.5 4.5 4.5L19 6.5"/>', X = '<path d="m6 6 12 12M18 6 6 18"/>';

  const D = window.HelpData;

  // table of contents
  document.getElementById('toc').innerHTML = D.articles.map(a =>
    `<a href="#${a.id}">${illo(a.illo, 22, 'var(--clay)')}<span>${a.title}</span></a>`).join('');

  // render a block
  function renderBlock(b) {
    if (b.type === 'p') return `<p class="bd blk">${b.text}</p>`;
    if (b.type === 'list') return `<div class="blk">${b.items.map(it =>
      `<div class="li"><span class="dot"></span><div class="bd"><span class="lead">${it.lead} </span>${it.text}</div></div>`).join('')}</div>`;
    if (b.type === 'steps') return `<div class="blk">${b.label ? `<div class="steplabel">${b.label}</div>` : ''}<div class="steps">${b.items.map((it, i) =>
      `<div class="step"><div class="n">${i+1}</div><div class="bd">${it}</div></div>`).join('')}</div></div>`;
    if (b.type === 'dont') return `<div class="blk panel dont" style="flex-direction:column;gap:0"><div class="h">${ic(X,20)} Please don’t</div>${b.items.map(it =>
      `<div class="ditem bd"><span style="color:var(--clay);flex-shrink:0;margin-top:2px">${ic(X,17)}</span><span>${it}</span></div>`).join('')}</div>`;
    if (b.type === 'callout' || b.type === 'note') {
      const cls = b.type === 'note' ? 'note' : 'callout-' + (b.tone || 'clay');
      const col = b.type === 'note' ? 'var(--ink-3)' : (b.tone === 'gold' ? 'var(--gold)' : b.tone === 'sage' ? 'var(--sage)' : 'var(--clay)');
      const mark = b.type === 'note' ? '<path d="M4.5 3.8h15v16.4h-15z" fill="none"/><path d="M8 8h8M8 12h8M8 16h5"/>' : '<path d="M12 3.5c.7 4 1.8 5.1 5.8 5.8-4 .7-5.1 1.8-5.8 5.8-.7-4-1.8-5.1-5.8-5.8 4-.7 5.1-1.8 5.8-5.8Z"/>';
      return `<div class="blk panel ${cls}"><span class="pi" style="color:${col}">${ic(mark,21)}</span><p class="bd">${b.text}</p></div>`;
    }
    if (b.type === 'tech') return `<div class="blk" style="border-radius:18px;padding:15px 18px;background:color-mix(in oklab,var(--ink) 5%,var(--surface));border:1px dashed color-mix(in oklab,var(--ink) 28%,var(--line))"><div style="display:flex;align-items:center;gap:9px;font-weight:800;font-size:11.5px;letter-spacing:.7px;text-transform:uppercase;color:var(--ink-3);margin-bottom:9px"><span style="font-family:ui-monospace,monospace;font-weight:700;font-size:13px;color:var(--clay-ink);background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:1px 6px">{ }</span> Under the hood</div><p class="bd" style="margin:0;color:var(--ink-2)">${b.text}</p></div>`;
    if (b.type === 'rule') return `<div class="blk rule"><div class="lab"><svg width="16" height="16" viewBox="0 0 100 100"><circle cx="50" cy="50" r="36" fill="none" stroke="var(--paper)" stroke-width="8" stroke-linecap="round" stroke-dasharray="57.4 18" transform="rotate(-90 50 50)"/><circle cx="50" cy="50" r="7" fill="var(--gold)"/></svg> Simple rule</div><p>${b.text}</p></div>`;
    return '';
  }

  // render articles
  document.getElementById('articles').innerHTML = D.articles.map(a => `
    <article class="art ${a.star ? 'star' : ''}" id="${a.id}">
      <div class="head">
        <div class="badge">${illo(a.illo, 60, 'var(--clay)')}</div>
        <div>
          ${a.star ? `<div class="star-pill"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5c.7 4 1.8 5.1 5.8 5.8-4 .7-5.1 1.8-5.8 5.8-.7-4-1.8-5.1-5.8-5.8 4-.7 5.1-1.8 5.8-5.8Z"/></svg> MOST IMPORTANT</div>` : ''}
          <h3>${a.title}${a.soon ? '<span class="soon">SOON</span>' : ''}</h3>
          <p class="sum">${a.summary}</p>
        </div>
      </div>
      <button class="listen" data-id="${a.id}">${ic('<path d="M5 13v-1a7 7 0 0 1 14 0v1"/><rect x="3.6" y="13" width="3.8" height="6" rx="1.6"/><rect x="16.6" y="13" width="3.8" height="6" rx="1.6"/>',19)} Listen to this page</button>
      <div style="height:1px;background:var(--line);margin:22px 0"></div>
      ${a.blocks.map(renderBlock).join('')}
    </article>`).join('');

  // ── larger text ──
  const tsBtns = [...document.querySelectorAll('#tsGrp button')];
  function setScale(s, save) {
    document.documentElement.style.setProperty('--hs', s);
    tsBtns.forEach(b => b.classList.toggle('on', Math.abs(parseFloat(b.dataset.s) - s) < .001));
    if (save) try { localStorage.setItem('to_help_scale_web', s); } catch(e) {}
  }
  tsBtns.forEach(b => b.addEventListener('click', () => setScale(parseFloat(b.dataset.s), true)));
  let saved = 1; try { saved = parseFloat(localStorage.getItem('to_help_scale_web')) || 1; } catch(e) {}
  setScale([1,1.18,1.36].includes(saved) ? saved : 1, false);

  // ── read aloud ──
  function speech(a) {
    let parts = [a.title + '. ' + a.summary + '. '];
    a.blocks.forEach(b => {
      if (['p','rule','callout','note'].includes(b.type)) parts.push(b.text);
      if (b.type === 'list') b.items.forEach(it => parts.push(it.lead + '. ' + it.text));
      if (b.type === 'steps') { if (b.label) parts.push(b.label); b.items.forEach((it,i) => parts.push((i+1) + '. ' + it)); }
      if (b.type === 'dont') { parts.push('Please don’t.'); b.items.forEach(it => parts.push(it)); }
    });
    return parts.join(' ');
  }
  let active = null;
  document.querySelectorAll('.listen').forEach(btn => {
    btn.addEventListener('click', () => {
      const supported = 'speechSynthesis' in window;
      if (!supported) { btn.textContent = 'Read-aloud not available here'; return; }
      if (active === btn) { window.speechSynthesis.cancel(); return; }
      window.speechSynthesis.cancel();
      document.querySelectorAll('.listen').forEach(b => { b.classList.remove('on'); b.innerHTML = b.dataset.label || b.innerHTML; });
      const a = D.articles.find(x => x.id === btn.dataset.id);
      const u = new SpeechSynthesisUtterance(speech(a));
      u.rate = .92;
      const reset = () => { btn.classList.remove('on'); btn.innerHTML = `${ic('<path d="M5 13v-1a7 7 0 0 1 14 0v1"/><rect x="3.6" y="13" width="3.8" height="6" rx="1.6"/><rect x="16.6" y="13" width="3.8" height="6" rx="1.6"/>',19)} Listen to this page`; active = null; };
      u.onend = reset; u.onerror = reset;
      btn.classList.add('on'); btn.innerHTML = `${ic(X,19)} Stop`; active = btn;
      window.speechSynthesis.speak(u);
    });
  });
