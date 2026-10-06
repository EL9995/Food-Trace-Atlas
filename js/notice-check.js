// Checks a barcode (UPC) and/or a lot, product code or date against the text of FDA recall notices
// collected by scripts/fetch_recalls.py (data/notices.json + data/recalls.json).
// The match logic is plain functions so it can be tested and reused (e.g. for pantry alerts).
(() => {
  const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const digits = (s) => String(s || '').replace(/\D/g, '');

  // UPC-A/EAN digits minus the check digit and leading zeros; notices often drop either.
  const upcBody = (upc) => digits(upc).slice(0, -1).replace(/^0+/, '');

  // A barcode is in a line if its digits (minus check digit) appear in one number group run of that line.
  function lineHasUpc(line, upc) {
    const body = upcBody(upc);
    if (body.length < 10) return false;
    const noPhones = line.replace(/\b1?[\s.-]?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g, ' ');
    return noPhones.split(/[|;,]/).some((part) => digits(part).replace(/^0+/, '').includes(body));
  }

  const commonPrefix = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return a.slice(0, i); };

  // Ranges like "0188 265 09:20 - 0188 265 10:30": the code is inside if it has the same shape,
  // shares the start the two ends share, and sorts between them.
  function inRange(line, code) {
    const c = norm(code);
    for (const part of line.split(/[|;]/)) {
      const m = part.match(/^(.+?)\s+(?:-|–|—|to|through|thru)\s+(.+)$/i);
      if (!m) continue;
      const a = norm(m[1]); const b = norm(m[2]);
      if (a.length !== c.length || b.length !== c.length) continue;
      const pre = commonPrefix(a, b);
      if (pre.length >= 3 && c.startsWith(pre) && a <= c && c <= b) return part.trim();
    }
    return null;
  }

  // Lines in a notice that list codes: table rows, and lines mentioning lot, code, UPC or dates.
  const isCodeLine = (l) => l.includes(' | ') || /\b(lot|upc|code|best|use by|sell by|exp|dates?)\b/i.test(l);

  function matchNotice(text, upc, code) {
    const lines = text.split('\n');
    const upcLines = upc ? lines.filter((l) => lineHasUpc(l, upc)) : [];
    const c = norm(code);
    let codeLines = []; let rangeHits = [];
    if (c.length >= 4) {
      codeLines = lines.filter((l) => norm(l).includes(c));
      rangeHits = lines.map((l) => [l, inRange(l, code)]).filter(([, r]) => r);
    }
    return { upcLines, codeLines, rangeHits, codeTable: lines.filter(isCodeLine) };
  }

  // Result kinds, strongest first.
  function verdict(m, upc, code) {
    const codeHit = m.codeLines.length || m.rangeHits.length;
    if (upc && m.upcLines.length && code && codeHit) return { kind: 'hit', text: m.codeLines.length ? 'Your barcode and your code both appear in this FDA notice.' : 'Your barcode appears in this FDA notice, and your code falls inside a code range it lists.' };
    if (upc && m.upcLines.length && code) return { kind: 'maybe', text: 'Your barcode appears in this FDA notice, but your code was not found. Compare your package with the codes below.' };
    if (upc && m.upcLines.length) return { kind: 'hit', text: 'Your barcode appears in this FDA notice. Compare the lot codes and dates on your package with the ones below.' };
    if (!upc && codeHit) return { kind: 'maybe', text: m.codeLines.length ? 'Your code appears in this FDA notice. Check that the product and barcode match too: short codes can repeat across companies.' : 'Your code falls inside a code range in this FDA notice. Check that the product and barcode match too.' };
    if (upc && codeHit) return { kind: 'weak', text: 'Your code appears in this FDA notice, but your barcode does not. It may be a different product.' };
    return null;
  }

  let cache = null;
  async function load() {
    if (cache) return cache;
    const [recalls, notices] = await Promise.all([
      fetch('data/recalls.json', { cache: 'no-cache' }).then((r) => r.json()),
      fetch('data/notices.json', { cache: 'no-cache' }).then((r) => r.json()),
    ]);
    cache = { recalls, notices };
    return cache;
  }

  async function run(upc, code) {
    const { recalls, notices } = await load();
    const results = [];
    for (const r of recalls.recalls) {
      const n = notices[r.id];
      if (!n || !n.text) continue;
      const m = matchNotice(n.text, upc, code);
      const v = verdict(m, upc, code);
      if (v) results.push({ recall: r, notice: n, match: m, verdict: v });
    }
    const rank = { hit: 0, maybe: 1, weak: 2 };
    results.sort((a, b) => rank[a.verdict.kind] - rank[b.verdict.kind] || b.recall.fda_publish_date.localeCompare(a.recall.fda_publish_date));
    const dates = recalls.recalls.map((r) => r.fda_publish_date).sort();
    return { results, generated: recalls.generated, count: Object.keys(notices).length, from: dates[0], to: dates[dates.length - 1] };
  }

  window.NoticeCheck = { run, matchNotice, verdict, inRange, lineHasUpc, norm };
})();
