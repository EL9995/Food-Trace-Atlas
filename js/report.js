// Recall report: reads data/recalls.json (written by scripts/fetch_recalls.py) and shows a daily or
// weekly report filtered by the visitor's categories, as a list or as slides.
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  // Dates are YYYY-MM-DD strings; do day math at noon UTC so time zones never shift the day.
  const today = new Date().toLocaleDateString('en-CA');
  const addDays = (d, n) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const nice = (d, opts = { month: 'short', day: 'numeric' }) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
  const niceLong = (d) => nice(d, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  // Types that are not food for people; "Food only" leaves these out.
  const NOT_FOOD = new Set(['Drugs', 'Medical Devices', 'Cosmetics', 'Animal & Veterinary', 'Pet Food', 'Animal Feed', 'Tobacco', 'Biologics']);

  const params = new URLSearchParams(location.search);
  const state = {
    range: params.get('range') === 'day' ? 'day' : params.get('range') === 'week' ? 'week' : store.get('range', 'week'),
    end: /^\d{4}-\d{2}-\d{2}$/.test(params.get('end') || '') ? params.get('end') : today,
    // null means every category. A link's ?cats= (e.g. from the LINE bot) wins over the saved picks.
    cats: params.has('cats') ? params.get('cats').split(',').filter(Boolean) : store.get('cats', null),
  };
  const lastVisit = store.get('lastVisit', null);
  store.set('lastVisit', new Date().toISOString());

  let data = { recalls: [], major: [] };
  let types = [];
  let shown = [];

  const isNew = (r) => lastVisit && r.first_seen > lastVisit;
  const picked = (r) => state.cats === null || r.types.some((t) => state.cats.includes(t));
  const start = () => (state.range === 'day' ? state.end : addDays(state.end, -6));
  const periodText = () => (state.range === 'day' ? niceLong(state.end) : `${nice(start())} – ${nice(state.end, { month: 'short', day: 'numeric', year: 'numeric' })}`);

  function syncUrl() {
    const p = new URLSearchParams({ range: state.range });
    if (state.end !== today) p.set('end', state.end);
    if (state.cats !== null) p.set('cats', state.cats.join(','));
    history.replaceState(null, '', `?${p}`);
  }

  function renderCats() {
    const counts = Object.fromEntries(types.map((t) => [t, data.recalls.filter((r) => r.types.includes(t)).length]));
    $('#cats-list').innerHTML = types.map((t) => `<label class="chip"><input type="checkbox" value="${esc(t)}" ${state.cats === null || state.cats.includes(t) ? 'checked' : ''}> ${esc(t)} <small>${counts[t]}</small></label>`).join('');
    const n = state.cats === null ? types.length : state.cats.length;
    $('#cats-sum').textContent = n === types.length ? '· all categories' : `· ${n} of ${types.length} picked`;
  }

  function setCats(list) {
    state.cats = list === null || list.length === types.length ? null : list;
    store.set('cats', state.cats);
    renderCats(); render();
  }

  function photoOf(r) { return r.photos && r.photos[0]; }

  function itemHTML(r) {
    const p = photoOf(r);
    const img = p ? `<img class="thumb" loading="lazy" src="${esc(p.thumb)}" alt="${esc(p.alt)}">` : '<div class="thumb none">No photo from FDA</div>';
    return `<article class="item">
      ${img}
      <div>
        <h3>${esc(r.brands || r.company)}</h3>
        <p class="product">${esc(r.product)}</p>
        <p class="reason">${esc(r.reason)}</p>
        <p class="meta">${esc(r.company)} · posted by FDA ${esc(nice(r.fda_publish_date))}${r.company_announcement_date ? ` · company announced ${esc(nice(r.company_announcement_date))}` : ''} · <a href="${esc(r.url)}" target="_blank" rel="noopener">Read FDA notice</a></p>
        <div class="tags">${isNew(r) ? '<span class="tag new">New since last visit</span>' : ''}${r.terminated ? '<span class="tag">Terminated</span>' : ''}${r.types.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
      </div>
    </article>`;
  }

  function render() {
    document.querySelectorAll('[data-range]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.range === state.range)));
    $('#period-label').textContent = periodText();
    $('#next').disabled = state.end >= today;
    const oldest = data.recalls.length ? data.recalls[data.recalls.length - 1].fda_publish_date : today;
    $('#prev').disabled = start() <= oldest;

    const from = start();
    shown = data.recalls.filter((r) => r.fda_publish_date >= from && r.fda_publish_date <= state.end && picked(r));
    const hiddenCount = data.recalls.filter((r) => r.fda_publish_date >= from && r.fda_publish_date <= state.end && !picked(r)).length;
    const word = state.range === 'day' ? 'on this day' : 'this week';
    const newCount = shown.filter(isNew).length;

    $('#summary').innerHTML = `<p>${shown.length} FDA recall notice${shown.length === 1 ? '' : 's'} ${word}${newCount ? ` · ${newCount} new since your last visit` : ''}${hiddenCount ? ` <span class="empty">(${hiddenCount} more outside your categories)</span>` : ''}</p>
      <button type="button" class="btn primary" id="play" ${shown.length ? '' : 'disabled'}>Play as slides</button>`;
    $('#play').addEventListener('click', () => openDeck(0));

    $('#list').innerHTML = shown.length
      ? `<div class="card list-card">${shown.map(itemHTML).join('')}</div>`
      : `<div class="card empty">No FDA recall notices posted ${state.range === 'day' ? 'on this day' : 'in these 7 days'}${state.cats !== null ? ' in your categories' : ''}. FDA usually posts on weekdays.</div>`;

    const feedTypes = state.cats === null ? [] : state.cats;
    $('#feeds').innerHTML = [`<a href="feeds/all.xml">All recalls</a>`, ...feedTypes.map((t) => `<a href="feeds/${slug(t)}.xml">${esc(t)}</a>`)].join('')
      + (state.cats === null ? '<span class="empty">Pick categories above to get a feed for each.</span>' : '');
    syncUrl();
  }

  function renderMajor() {
    const recent = addDays(today, -14);
    const major = [...data.major].sort((a, b) => (b.current_as_of || '').localeCompare(a.current_as_of || ''));
    $('#major').innerHTML = major.map((m) => {
      const fresh = (m.updated_seen && m.updated_seen.slice(0, 10) >= recent) || (m.current_as_of && m.current_as_of >= recent);
      return `<div class="major-item">
        <a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.title)}</a>
        <p class="meta">${m.current_as_of ? `FDA page last updated ${esc(nice(m.current_as_of, { month: 'short', day: 'numeric', year: 'numeric' }))}` : 'Update date not shown'} ${fresh ? '<span class="tag new">Updated recently</span>' : ''}</p>
      </div>`;
    }).join('') || '<p class="empty">None listed.</p>';
  }

  // ---- Slides ----
  let slide = 0;
  const deckSlides = () => ['intro', ...shown, 'outro'];

  function slideHTML(s) {
    if (s === 'intro') {
      const cats = state.cats === null ? 'All categories' : state.cats.join(', ');
      return `<div class="slide text"><div>
        <p class="eyebrow">FDA recall report · ${state.range === 'day' ? 'daily' : 'weekly'}</p>
        <h2>${esc(periodText())}</h2>
        <p>${shown.length} recall notice${shown.length === 1 ? '' : 's'} posted by FDA.</p>
        <p>${esc(cats)}</p>
      </div></div>`;
    }
    if (s === 'outro') {
      return `<div class="slide text"><div>
        <h2>Check your pantry</h2>
        <p>Compare the lot codes and dates on your package with each FDA notice. If it matches, follow the notice's instructions.</p>
        <p>Collected from FDA.gov ${data.generated ? `on ${esc(niceLong(data.generated.slice(0, 10)))}` : ''}. Not every recall is posted there; meat, poultry and eggs are mostly at FSIS.usda.gov.</p>
        <p><a href="https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts" target="_blank" rel="noopener">FDA recalls</a> · <a href="https://www.fsis.usda.gov/recalls" target="_blank" rel="noopener">USDA FSIS recalls</a></p>
      </div></div>`;
    }
    const r = s;
    const photos = r.photos || [];
    const photo = photos.length
      ? `<div class="photo">
          <img class="main" src="${esc(photos[0].src)}" alt="${esc(photos[0].alt)}">
          ${photos.length > 1 ? `<div class="strip">${photos.map((p, i) => `<img src="${esc(p.thumb)}" alt="${esc(p.alt)}" data-i="${i}" aria-current="${i === 0}">`).join('')}</div>` : ''}
          <p class="credit">Photo published by FDA with the notice</p>
        </div>`
      : '<div class="nophoto">FDA did not publish a photo with this notice.</div>';
    return `<div class="slide${photos.length ? '' : ' no-photo'}">${photo}
      <div class="facts">
        <p class="eyebrow">${esc(nice(r.fda_publish_date, { month: 'long', day: 'numeric', year: 'numeric' }))}${isNew(r) ? ' · new' : ''}</p>
        <h2>${esc(r.brands || r.company)}</h2>
        <p class="product">${esc(r.product)}</p>
        <p class="reason">${esc(r.reason)}</p>
        <dl>
          <dt>Company</dt><dd>${esc(r.company)}</dd>
          ${r.company_announcement_date ? `<dt>Announced</dt><dd>${esc(nice(r.company_announcement_date, { month: 'short', day: 'numeric', year: 'numeric' }))}</dd>` : ''}
          <dt>Source</dt><dd><a href="${esc(r.url)}" target="_blank" rel="noopener">FDA notice</a> (lot codes and dates)</dd>
        </dl>
        <div class="tags">${r.types.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
      </div>
    </div>`;
  }

  function showSlide() {
    const all = deckSlides();
    slide = Math.max(0, Math.min(slide, all.length - 1));
    $('#deck-stage').innerHTML = slideHTML(all[slide]);
    $('#deck-count').textContent = `${slide + 1} / ${all.length}`;
    $('#deck-prev').disabled = slide === 0;
    $('#deck-next').textContent = slide === all.length - 1 ? 'Done' : 'Next ›';
    $('#deck-stage').querySelectorAll('.strip img').forEach((t) => t.addEventListener('click', () => {
      const p = all[slide].photos[t.dataset.i];
      const main = $('#deck-stage .main'); main.src = p.src; main.alt = p.alt;
      $('#deck-stage').querySelectorAll('.strip img').forEach((x) => x.setAttribute('aria-current', String(x === t)));
    }));
  }

  function openDeck(i) { slide = i; $('#deck').hidden = false; document.body.style.overflow = 'hidden'; showSlide(); $('#deck-next').focus(); }
  function closeDeck() { $('#deck').hidden = true; document.body.style.overflow = ''; $('#play')?.focus(); }
  function step(n) { if (n > 0 && slide === deckSlides().length - 1) return closeDeck(); slide += n; showSlide(); }

  $('#deck-close').addEventListener('click', closeDeck);
  $('#deck-prev').addEventListener('click', () => step(-1));
  $('#deck-next').addEventListener('click', () => step(1));
  document.addEventListener('keydown', (e) => {
    if ($('#deck').hidden) return;
    if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'Escape') closeDeck();
  });
  let touchX = null;
  $('#deck-stage').addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  $('#deck-stage').addEventListener('touchend', (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX; touchX = null;
    if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
  });

  // ---- Controls ----
  document.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => { state.range = b.dataset.range; store.set('range', state.range); render(); }));
  $('#prev').addEventListener('click', () => { state.end = addDays(state.end, state.range === 'day' ? -1 : -7); render(); });
  $('#next').addEventListener('click', () => { const e = addDays(state.end, state.range === 'day' ? 1 : 7); state.end = e > today ? today : e; render(); });
  $('#cats-list').addEventListener('change', () => setCats([...document.querySelectorAll('#cats-list input:checked')].map((i) => i.value)));
  document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
    const p = b.dataset.preset;
    setCats(p === 'all' ? null : p === 'none' ? [] : types.filter((t) => !NOT_FOOD.has(t)));
  }));

  fetch('data/recalls.json', { cache: 'no-cache' })
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((d) => {
      data = d;
      const counts = {};
      d.recalls.forEach((r) => r.types.forEach((t) => { counts[t] = (counts[t] || 0) + 1; }));
      types = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
      if (state.cats) state.cats = state.cats.filter((t) => types.includes(t));
      const when = new Date(d.generated);
      $('#checked').textContent = `FDA recall report · last checked ${when.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
      renderCats(); render(); renderMajor();
      if (params.get('slides') === '1' && shown.length) openDeck(0);
    })
    .catch(() => { $('#list').innerHTML = '<div class="card">Couldn\'t load the recall data. Try again shortly, or see <a href="https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts">FDA.gov</a>.</div>'; });
})();
