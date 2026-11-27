"""Attach the cloud briefing feed to the static Pages renderer at build time."""
import argparse
import re
from pathlib import Path


FIELDS = ("weeklySnapshot", "series", "finvizWeeklyGroups", "finvizWeeklyIndustryGroups",
          "marketOverlay", "monthlyCorrelations")
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


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("html", type=Path)
    args = parser.parse_args()
    args.html.write_text(connect(args.html.read_text(encoding="utf-8-sig")), encoding="utf-8")
