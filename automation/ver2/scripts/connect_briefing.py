"""Attach the cloud briefing feed to the static Pages renderer at build time."""
import argparse
from collections import Counter
import json
import re
from pathlib import Path


FIELDS = ("weeklySnapshot", "series", "finvizWeeklyGroups", "finvizWeeklyIndustryGroups",
          "marketOverlay", "monthlyCorrelations", "capexTracker")
BOOT = """
    const cloudBriefing = await (async () => {
      await import('./asset-allocation/market-api-config.js').catch(() => null);
      const base = globalThis.PUBLIC_MARKET_API_URL;
      for (const url of [base && new URL('/api/v1/briefing', base).href, './briefing-data.json']) {
        if (!url) continue;
        try {
          const response = await fetch(url, {signal: AbortSignal.timeout(3500)});
          if (!response.ok) continue;
          const data = await response.json();
          if (data.schemaVersion === 1 && data.marketOverlay?.through &&
              data.weeklySnapshot && data.series && data.finvizWeeklyGroups &&
              data.finvizWeeklyIndustryGroups && Array.isArray(data.monthlyCorrelations)) return data;
        } catch {}
      }
      return null;
    })();
    if (cloudBriefing) {
      const through = cloudBriefing.marketOverlay.through;
      const header = document.querySelector('.hero');
      if (header) for (const element of header.querySelectorAll('p')) {
        if (element.textContent.trim().startsWith('미국장 종가 기준일:'))
          element.textContent = '미국장 종가 기준일: ' + through;
      }
    }
"""


def connect(html):
    marker = re.compile(r"<script>\s*\n(?=    const weeklySnapshot = )")
    html, count = marker.subn(lambda _: '<script type="module">\n' + BOOT, html)
    if count != 1:
        raise ValueError("Expected one briefing script")
    for field in FIELDS:
        old = f"    const {field} = "
        if html.count(old) != 1:
            raise ValueError(f"Unexpected template declaration: {field}")
        html = html.replace(old, old + f"cloudBriefing?.{field} ?? ")
    return html


def merge_capex(html, briefing, incoming):
    row = re.search(r"(?m)^    const capexTracker = (.*?);\s*$", html)
    if not row:
        raise ValueError("Missing published CAPEX data")
    baseline = json.loads(row[1])
    previous = briefing.get("capexTracker") or {}
    items, investments = {}, {}
    for tracker in (incoming, previous, baseline):
        for item in tracker.get("items", []):
            key = (item["company"], item["period"], item["metricType"], item["date"])
            items[key] = item
        for item in tracker.get("investments", []):
            key = item.get("key") or (item["company"], item["period"], item["metricType"])
            investments[key] = item
    ordered = sorted(items.values(), key=lambda i: i["date"])
    days = Counter(i["date"] for i in ordered)
    briefing["capexTracker"] = {**baseline, "start": min(days), "end": max(days),
        "total": len(ordered), "timeline": [{"date": day, "count": days[day]} for day in sorted(days)],
        "categoryCounts": dict(Counter(c for item in ordered for c in item.get("categories", []))),
        "items": ordered[-80:], "investments": list(investments.values())}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("html", type=Path)
    parser.add_argument("--data", type=Path)
    parser.add_argument("--capex", type=Path)
    args = parser.parse_args()
    html = args.html.read_text(encoding="utf-8-sig")
    if args.data and args.data.exists() and args.capex and args.capex.exists():
        briefing = json.loads(args.data.read_text(encoding="utf-8"))
        merge_capex(html, briefing, json.loads(args.capex.read_text(encoding="utf-8")))
        args.data.write_text(json.dumps(briefing, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    args.html.write_text(connect(html), encoding="utf-8")
