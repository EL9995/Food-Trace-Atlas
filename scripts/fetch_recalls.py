#!/usr/bin/env python3
"""Collect FDA recall notices into data/recalls.json and write RSS feeds.

Sources (both public, FDA.gov):
  - Recalls, Market Withdrawals, & Safety Alerts: the table's own data feed, plus each notice page for photos.
  - Major Product Recalls: the list of large multi-product recalls and each page's "Content current as of" date.

Run by .github/workflows/pages.yml every few hours. Standard library only.
FDA's robots.txt asks for 2 seconds between requests; every request here waits that long.
"""
import html
import json
import re
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "recalls.json"
NOTICES = ROOT / "data" / "notices.json"  # announcement text per notice, for the code check
FEEDS = ROOT / "feeds"
SITE = "https://el9995.github.io/Food-Trace-Atlas/"

FDA = "https://www.fda.gov"
TABLE = FDA + "/datatables/views/ajax?view_name=recall_solr_index&view_display_id=recall_datatable_block_1&start=0&length={n}&draw=1"
RECALLS_PAGE = FDA + "/safety/recalls-market-withdrawals-safety-alerts"
MAJOR_PAGE = FDA + "/safety/recalls-market-withdrawals-safety-alerts/major-product-recalls"

KEEP_DAYS = 365        # keep (and backfill) notices this far back
MAX_DETAIL_FETCHES = 120  # notice pages per run (2 s each); the rest are filled on later runs
REFRESH_DAYS = 30      # companies often expand recalls: re-read notices this new once a day
UA = "FoodTraceAtlas/0.1 (+https://github.com/EL9995/Food-Trace-Atlas)"

_last = 0.0


def get(url):
    global _last
    wait = 2.0 - (time.time() - _last)
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=60) as r:
        body = r.read().decode("utf-8", "replace")
    _last = time.time()
    return body


def text(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def parse_table(rows):
    out = []
    for r in rows:
        date = re.search(r'datetime="([^"]+)"', r[0])
        link = re.search(r'href="([^"]+)"', r[1])
        if not (date and link):
            continue
        url = FDA + link.group(1) if link.group(1).startswith("/") else link.group(1)
        out.append({
            "id": url.rstrip("/").rsplit("/", 1)[-1],
            "url": url,
            "fda_publish_date": date.group(1)[:10],
            "brands": text(r[1]),
            "product": text(r[2]),
            "types": [t for t in (text(x) for x in r[3].split(",")) if t],
            "reason": text(r[4]),
            "company": text(r[5]),
            "terminated": bool(text(r[6])),
        })
    return out


def notice_text(page):
    """The company announcement as plain lines; each table row becomes one 'cell | cell' line."""
    i = page.find('id="recall-announcement"')
    if i < 0:
        return ""
    seg = page[i:]
    ends = [seg.find(k) for k in ("Company Contact Information", "recall-photos", "Product Photos", "</article>")]
    seg = seg[:min([e for e in ends if e > 0] or [len(seg)])]
    seg = re.sub(r"<(script|style)[\s\S]*?</\1>", "", seg)

    def cell(c):
        t = text(re.sub(r"<br\s*/?>|</p>|</li>", " ; ", c))
        t = re.sub(r"\s*;\s*(;\s*)*", "; ", t)          # empty paragraphs between codes
        t = re.sub(r"\s*([-–])\s*;\s*", r" \1 ", t)      # "A -; B" is one range "A - B"
        return t.strip("; ")

    def row(m):
        cells = re.findall(r"<t[hd][^>]*>([\s\S]*?)</t[hd]>", m.group(0))
        return "\n" + " | ".join(cell(c) for c in cells) + "\n"
    seg = re.sub(r"<tr[\s\S]*?</tr>", row, seg)
    seg = re.sub(r"<br\s*/?>|</(p|li|h\d|div|table)>", "\n", seg)
    lines = [text(l) for l in seg.split("\n")]
    lines = [l for l in lines if l and l not in ("Company Announcement", 'id="recall-announcement">Company Announcement')]
    return "\n".join(l.strip(" >") for l in lines if l.strip(" >"))


def parse_notice(page):
    """Photos, the company's announcement date and the announcement text from a notice page."""
    photos = []
    for m in re.finditer(r'<img[^>]+src="(/files/styles/recall_image_[^"]+)"[^>]*>', page):
        tag = m.group(0)
        alt = re.search(r'alt="([^"]*)"', tag)
        small = m.group(1)
        full = re.sub(r"/styles/[^/]+/public/", "/", small).split("?")[0]
        photos.append({"src": FDA + full, "thumb": FDA + small, "alt": html.unescape(alt.group(1)).strip() if alt else ""})
    ann = re.search(r"Company Announcement Date:.*?datetime=\"([^\"]+)\"", page, re.S)
    return {"photos": photos, "company_announcement_date": ann.group(1)[:10] if ann else None, "text": notice_text(page)}


def parse_major(page):
    main = page[page.find("<main"):]
    items, seen = [], set()
    for m in re.finditer(r'<a[^>]+href="(/safety/major-product-recalls/[^"]+)"[^>]*>(.*?)</a>', main, re.S):
        url = FDA + m.group(1)
        if url in seen:
            continue
        seen.add(url)
        title = text(m.group(2))
        year = re.match(r"(\d{4})", title)
        items.append({"id": m.group(1).rsplit("/", 1)[-1], "url": url, "title": title, "year": year.group(1) if year else None})
    return items


def current_as_of(page):
    m = re.search(r"Content current as of:.*?datetime=\"([^\"]+)\"", page, re.S)
    return m.group(1)[:10] if m else None


def rss(title, link, items, path):
    def item(r):
        pub = datetime.fromisoformat(r["fda_publish_date"]).replace(hour=12, tzinfo=timezone.utc)
        desc = f'{r["product"]}. Reason: {r["reason"]}. Company: {r["company"]}. Product type: {", ".join(r["types"])}.'
        return (f"<item><title>{html.escape(r['brands'] or r['company'])}: {html.escape(r['reason'])}</title>"
                f"<link>{html.escape(r['url'])}</link><guid isPermaLink=\"true\">{html.escape(r['url'])}</guid>"
                f"<pubDate>{format_datetime(pub)}</pubDate><description>{html.escape(desc)}</description></item>")
    body = "".join(item(r) for r in items[:60])
    path.write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n<rss version="2.0"><channel>'
        f"<title>{html.escape(title)}</title><link>{html.escape(link)}</link>"
        "<description>New FDA recall notices, collected from FDA.gov by Food Trace Atlas. Always confirm at FDA.gov.</description>"
        f"<lastBuildDate>{format_datetime(datetime.now(timezone.utc))}</lastBuildDate>{body}</channel></rss>\n",
        encoding="utf-8")


def main():
    old = json.loads(DATA.read_text()) if DATA.exists() else {"recalls": [], "major": []}
    notices = json.loads(NOTICES.read_text()) if NOTICES.exists() else {}
    by_id = {r["id"]: r for r in old.get("recalls", [])}
    today = datetime.now(timezone.utc).date()
    stamp = now_iso()

    # 1. The recall table: the newest 400 rows reach back more than a year in one request.
    rows = json.loads(get(TABLE.format(n=400)))["data"]
    cutoff = (today - timedelta(days=KEEP_DAYS)).isoformat()
    added = 0
    for r in parse_table(rows):
        if r["fda_publish_date"] < cutoff:
            continue
        prev = by_id.get(r["id"])
        if prev:
            prev.update({k: r[k] for k in ("brands", "product", "types", "reason", "company", "terminated")})
            continue
        r.update({"source": "FDA Recalls, Market Withdrawals, & Safety Alerts", "source_url": RECALLS_PAGE,
                  "first_seen": stamp, "retrieved": stamp, "status": "confirmed", "photos": None})
        by_id[r["id"]] = r
        added += 1

    # 2. Notice pages for photos and text, newest first, a limited number per run.
    #    Unread notices first; recent ones are re-read daily because recalls get expanded.
    fresh_from = (today - timedelta(days=REFRESH_DAYS)).isoformat()
    day_ago = (datetime.now(timezone.utc) - timedelta(hours=20)).strftime("%Y-%m-%dT%H:%M:%SZ")

    def needs_read(r):
        n = notices.get(r["id"])
        if r.get("photos") is None or n is None:
            return True
        return r["fda_publish_date"] >= fresh_from and n["retrieved"] < day_ago

    fetched = 0
    for r in sorted(by_id.values(), key=lambda x: x["fda_publish_date"], reverse=True):
        if fetched >= MAX_DETAIL_FETCHES or not needs_read(r):
            continue
        try:
            info = parse_notice(get(r["url"]))
            body = info.pop("text")
            r.update(info)
            r["retrieved"] = now_iso()
            prev = notices.get(r["id"])
            if prev and prev["text"] and prev["text"] != body:
                r["notice_changed"] = r["retrieved"]
            notices[r["id"]] = {"url": r["url"], "retrieved": r["retrieved"], "text": body}
        except Exception as e:  # keep going; it is retried next run
            print(f"notice failed {r['url']}: {e}", file=sys.stderr)
        fetched += 1

    # 3. Major Product Recalls: new entries, and entries FDA has updated since we last looked.
    major_old = {m["id"]: m for m in old.get("major", [])}
    major = []
    for m in parse_major(get(MAJOR_PAGE)):
        prev = major_old.get(m["id"], {})
        m["first_seen"] = prev.get("first_seen", stamp)
        m["current_as_of"] = prev.get("current_as_of")
        m["updated_seen"] = prev.get("updated_seen")
        try:
            as_of = current_as_of(get(m["url"]))
            if as_of and m["current_as_of"] and as_of != m["current_as_of"]:
                m["updated_seen"] = stamp
            m["current_as_of"] = as_of or m["current_as_of"]
        except Exception as e:
            print(f"major page failed {m['url']}: {e}", file=sys.stderr)
        m.update({"source": "FDA Major Product Recalls", "source_url": MAJOR_PAGE, "retrieved": now_iso(), "status": "confirmed"})
        major.append(m)

    keep = (today - timedelta(days=KEEP_DAYS)).isoformat()
    recalls = sorted((r for r in by_id.values() if r["fda_publish_date"] >= keep),
                     key=lambda x: (x["fda_publish_date"], x["first_seen"]), reverse=True)
    DATA.parent.mkdir(exist_ok=True)
    DATA.write_text(json.dumps({
        "generated": now_iso(),
        "sources": [{"name": "FDA Recalls, Market Withdrawals, & Safety Alerts", "url": RECALLS_PAGE},
                    {"name": "FDA Major Product Recalls", "url": MAJOR_PAGE}],
        "note": "Collected from FDA.gov every few hours. Not every recall is posted on FDA.gov (USDA FSIS handles most meat, poultry and egg recalls). Always confirm at FDA.gov.",
        "recalls": recalls,
        "major": major,
    }, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")

    ids = {r["id"] for r in recalls}
    NOTICES.write_text(json.dumps({k: v for k, v in notices.items() if k in ids}, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")

    # 4. Feeds: one for everything, one per FDA product type.
    FEEDS.mkdir(exist_ok=True)
    rss("Food Trace Atlas: all FDA recalls", SITE, recalls, FEEDS / "all.xml")
    for t in sorted({t for r in recalls for t in r["types"]}):
        rss(f"Food Trace Atlas: FDA recalls, {t}", SITE, [r for r in recalls if t in r["types"]], FEEDS / f"{slugify(t)}.xml")

    print(f"{len(recalls)} recalls ({added} new, {fetched} notice pages read), {len(major)} major recalls")


if __name__ == "__main__":
    main()
