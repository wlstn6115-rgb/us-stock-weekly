"""Collect public briefing prices and FINVIZ data with the existing Ver2 sources."""

import json
import csv
import io
import math
import os
import re
import calendar
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import urlopen
from zoneinfo import ZoneInfo

from refresh_cloud_ver2 import collect, close_series, tradingview


EXTRA = {"Nasdaq 100": "TVC:NDX", "Dow": "TVC:DJI", "Russell 2000": "TVC:RUT"}
KST = ZoneInfo("Asia/Seoul")
MARKET_FIELDS = ("weeklySnapshot", "series", "finvizWeeklyGroups",
                 "finvizWeeklyIndustryGroups", "marketOverlay", "monthlyCorrelations")
CORRELATION_LABELS = ("S&P 500", "US 10Y Treasury", "Gold", "Bitcoin (USD)",
                      "WTI Crude", "Dollar Index", "KOSPI", "USD/KRW")
SITE = "https://wlstn6115-rgb.github.io/us-stock-weekly/"
FRED_MACRO = {
    "US Industrial Production": ("INDPRO", "Federal Reserve", True, False),
    "US Retail Sales YoY": ("RSAFS", "U.S. Census Bureau", True, False),
    "US GDP Annual Growth Rate": ("GDPC1", "U.S. Bureau of Economic Analysis", True, True),
    "US Unemployment Rate": ("UNRATE", "U.S. Bureau of Labor Statistics", False, False),
}


def public_pmi():
    from bs4 import BeautifulSoup
    from curl_cffi import requests

    response = requests.get("https://tradingeconomics.com/united-states/manufacturing-pmi",
                            impersonate="chrome", timeout=20)
    response.raise_for_status()
    page = BeautifulSoup(response.text, "html.parser")
    tag = page.select_one('meta[name="description"]')
    summary = tag.get("content", "") if tag else ""
    match = re.search(
        r"Manufacturing PMI in the United States (?:\w+ )+to (\d+(?:\.\d+)?) points in ([A-Za-z]+) "
        r"from (\d+(?:\.\d+)?) points in ([A-Za-z]+) of (\d{4})",
        summary, re.I,
    )
    if not match:
        raise ValueError("Public PMI summary layout changed")
    current, month_name, previous, previous_name, year = match.groups()
    months = {name.lower(): i for i, name in enumerate(calendar.month_name) if name}
    month, prior = months[month_name.lower()], months[previous_name.lower()]
    year = int(year)
    if month != prior % 12 + 1:
        raise ValueError("PMI summary does not identify adjacent releases")
    return {f"{year}-{prior:02d}-01": float(previous),
            f"{year + (month < prior)}-{month:02d}-01": float(current)}


def extract(html):
    data = {}
    for key in MARKET_FIELDS:
        row = re.search(rf"(?m)^    const {key} = (.*?);\s*$", html)
        if not row:
            raise ValueError(f"Missing published briefing field: {key}")
        data[key] = json.loads(row[1])
    return data


def finviz(group, rows):
    from bs4 import BeautifulSoup
    from curl_cffi import requests

    url = f"https://finviz.com/groups?g={group}&o=name&v=140"
    response = requests.get(url, impersonate="chrome", timeout=20)
    response.raise_for_status()
    table = BeautifulSoup(response.text, "html.parser")
    values = {}
    for row in table.select("tr"):
        cells = row.find_all("td", recursive=False)
        if len(cells) < 8:
            continue
        link = cells[1].find("a")
        if not link:
            continue
        numbers = [cell.get_text(strip=True) for cell in cells[2:]]
        if not re.fullmatch(r"[+-]?\d+(?:\.\d+)?%", numbers[0]):
            continue
        values[link.get_text(strip=True)] = float(numbers[0][:-1])
    if not rows or any(row[group] not in values for row in rows):
        raise ValueError(f"Incomplete FINVIZ {group} response")
    return url, values


def correlations(data, month):
    import pandas as pd

    prices = {}
    for name in CORRELATION_LABELS:
        item = data[name]
        prices[name] = pd.Series({day: value for day, value in zip(item["dates"], item["values"])
                                  if day.startswith(month)}, dtype=float).sort_index()
    returns = pd.concat([prices[name].pct_change(fill_method=None).rename(name)
                         for name in CORRELATION_LABELS], axis=1).dropna()
    if len(returns) < 5:
        return None
    matrix = returns.corr()
    dates = prices["S&P 500"].index
    return {"month": month, "start": dates[0], "end": dates[-1],
            "observations": len(returns), "labels": CORRELATION_LABELS,
            "matrix": {a: {b: 1.0 if a == b else round(float(matrix.loc[a, b]), 4)
                            if math.isfinite(matrix.loc[a, b]) else None
                            for b in CORRELATION_LABELS} for a in CORRELATION_LABELS}}


def fred_macro(code, yoy, quarterly):
    with urlopen(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={code}", timeout=20) as response:
        csv_text = response.read().decode("utf-8-sig")
    rows = {day: float(value) for day, value in list(csv.reader(io.StringIO(csv_text)))[1:]
            if value not in ("", ".")}
    result = {}
    for day, value in rows.items():
        prior = str(int(day[:4]) - 1) + day[4:]
        if yoy and (prior not in rows or rows[prior] <= 0):
            continue
        # The existing chart labels GDP by the last month of each quarter.
        label = f"{day[:4]}-{int(day[5:7]) + 2:02d}-01" if quarterly else day
        result[label] = round((value / rows[prior] - 1) * 100, 1) if yoy else value
    return result


def update_macro(series, cutoff):
    with ThreadPoolExecutor(max_workers=4) as pool:
        pending = {name: pool.submit(fred_macro, code, yoy, quarterly)
                   for name, (code, _, yoy, quarterly) in FRED_MACRO.items()}
        for name, future in pending.items():
            old = series[name]
            previous = dict(zip(old["dates"], old["values"]))
            try:
                fresh = {day: value for day, value in future.result().items()
                         if day <= cutoff and math.isfinite(value)}
                overlap = sorted(previous.keys() & fresh.keys())[-3:]
                if len(overlap) < 3 or any(abs(previous[d] - fresh[d]) > 0.11 for d in overlap):
                    raise ValueError("published overlap differs from official series")
            except (OSError, ValueError) as error:
                print(f"::warning::{name}: existing series retained ({error})")
                continue
            code, agency, _, _ = FRED_MACRO[name]
            source = f"FRED {code} - {agency}"
            dates = sorted(set(previous) | {d for d in fresh if d >= min(previous)})
            series[name] = {**old, "source": source, "sources": list(dict.fromkeys([*old.get("sources", []), source])),
                            "dates": dates, "values": [fresh[d] if d in fresh else previous[d] for d in dates],
                            "pointSources": [source if d in fresh else old["source"] for d in dates]}
            print(f"{name}: {dates[-1]} ({source})")
    old = series["US S&P 500"]
    equity = series["S&P 500"]
    closes = {day[:7] + "-01": value for day, value in zip(equity["dates"], equity["values"])
              if day <= cutoff}
    month = cutoff[:7] + "-01"
    if month in closes and (not old["dates"] or month >= old["dates"][-1]):
        points = dict(zip(old["dates"], zip(old["values"], old.get("pointSources", [old["source"]] * len(old["dates"])))))
        source = "TradingView TVC:SPX - latest close of month"
        points[month] = (closes[month], source)
        dates = sorted(points)
        series["US S&P 500"] = {**old, "source": source,
                               "dates": dates, "values": [points[d][0] for d in dates],
                               "pointSources": [points[d][1] for d in dates]}
    token = os.environ.get("TRADING_ECONOMICS_API_KEY")
    old = series["US Manufacturing PMI"]
    previous = dict(zip(old["dates"], old["values"]))
    try:
        if token:
            query = urlencode({"c": token, "f": "json"})
            url = "https://api.tradingeconomics.com/historical/country/united%20states/indicator/manufacturing%20pmi"
            with urlopen(f"{url}?{query}", timeout=20) as response:
                items = json.load(response)
            incoming = {row["DateTime"][:7] + "-01": float(row["Value"]) for row in items
                        if row["Country"] == "United States" and row["Value"] is not None}
        else:
            incoming = public_pmi()
        incoming = {day: value for day, value in incoming.items() if day <= cutoff}
        overlap = sorted(previous.keys() & incoming.keys())[-3:]
        if len(overlap) < (3 if token else 1) or any(abs(previous[d] - incoming[d]) > 0.11 for d in overlap[:-1] if len(overlap) > 1) or (len(overlap) == 1 and abs(previous[overlap[0]] - incoming[overlap[0]]) > 0.11):
            raise ValueError("PMI overlap differs")
        if not all(math.isfinite(value) and 0 <= value <= 100 for value in incoming.values()):
            raise ValueError("PMI values invalid")
    except (OSError, ValueError, TypeError, KeyError):
        print("::warning::S&P Global PMI: source could not validate the release; previous release retained")
        return
    source = "Trading Economics - S&P Global"
    points = {**previous, **{d: v for d, v in incoming.items() if d >= min(previous)}}
    dates = sorted(points)
    series["US Manufacturing PMI"] = {**old, "source": source, "dates": dates,
                                       "values": [points[d] for d in dates],
                                       "pointSources": [source] * len(dates)}


def refresh(previous, now):
    import pandas_market_calendars as calendars

    latest, series = collect(now)
    if latest < previous["marketOverlay"]["through"]:
        raise ValueError("Refusing an older market close")
    schedule = calendars.get_calendar("NYSE").schedule(
        start_date=now.date() - timedelta(days=460), end_date=latest)
    sessions = [(day.date().isoformat(), row.market_close) for day, row in schedule.iterrows()]
    with ThreadPoolExecutor(max_workers=4) as pool:
        jobs = {name: pool.submit(tradingview, symbol) for name, symbol in EXTRA.items()}
        quotes = pool.submit(tradingview, "KRX:KOSPI")
        for name, future in jobs.items():
            points = close_series(future.result(), sessions)
            if latest not in points:
                raise ValueError(f"Missing {name} close for {latest}")
            series[name] = {"dates": list(points), "values": list(points.values())}
        korea = {}
        now_kst = now.astimezone(KST)
        for stamp, value in quotes.result():
            local = datetime.fromtimestamp(stamp, KST)
            if (local.weekday() < 5 and time(9) <= local.time() < time(15, 30)
                    and (local.date() < now_kst.date() or now_kst.time() >= time(15, 45))
                    and math.isfinite(value) and value > 0):
                korea[local.date().isoformat()] = value
        if not korea:
            raise ValueError("KOSPI close unavailable")
        series["KOSPI"] = {"dates": sorted(korea), "values": [korea[d] for d in sorted(korea)]}
    for name, item in series.items():
        if name not in previous["series"]:
            continue
        old = previous["series"][name]
        points = dict(zip(old["dates"], zip(old["values"], old.get("pointSources", [""] * len(old["dates"])))))
        source = old.get("source", "")
        points.update({day: (value, source) for day, value in zip(item["dates"], item["values"])})
        dates = sorted(points)
        previous["series"][name] = {**old, "dates": dates, "values": [points[d][0] for d in dates],
                                    "pointSources": [points[d][1] for d in dates]}
    monday = datetime.fromisoformat(latest).date()
    monday -= timedelta(days=monday.weekday())
    for name, item in previous["weeklySnapshot"].items():
        points = previous["series"][name]
        rows = list(zip(points["dates"], points["values"]))
        end_day = rows[-1][0]
        market_monday = datetime.fromisoformat(end_day).date()
        market_monday -= timedelta(days=market_monday.weekday())
        boundary = market_monday.isoformat()
        prior = [row for row in rows if row[0] < boundary]
        current = [row for row in rows if row[0] >= boundary]
        if not prior or not current or prior[-1][1] <= 0:
            raise ValueError(f"Cannot compare snapshot for {name}")
        selected = [prior[-1], *current]
        first, last = selected[0][1], selected[-1][1]
        previous["weeklySnapshot"][name] = {**item, "dates": [r[0] for r in selected],
            "values": [r[1] for r in selected], "first": first, "last": last,
            "pointSources": [item.get("source", "") for _ in selected],
            "changePct": round((last / first - 1) * 100, 2)}
    for key, group in (("finvizWeeklyGroups", "sector"), ("finvizWeeklyIndustryGroups", "industry")):
        saved = previous[key]
        if saved.get("currentStart") == monday.isoformat() and saved.get("currentEnd", "") >= latest:
            continue
        ny = now.astimezone(ZoneInfo("America/New_York"))
        if ny.weekday() < 5 and time(9, 30) <= ny.time() < time(16, 15):
            raise ValueError("FINVIZ comparison waits until the US close buffer")
        if saved.get("currentStart") != monday.isoformat():
            prior_close = max(day for day, _ in sessions if day < monday.isoformat())
            if saved.get("currentEnd") != prior_close:
                raise ValueError("FINVIZ prior-week final snapshot is missing")
            saved.update(previousStart=saved["currentStart"], previousEnd=saved["currentEnd"],
                         previousFetchedAt=saved["fetchedAt"], currentStart=monday.isoformat())
            for row in saved["items"]:
                row["previousPerfWeek"] = row["perfWeek"]
        url, perf = finviz(group, saved["items"])
        for row in saved["items"]:
            row.update(perfWeek=perf[row[group]], change=None)
        saved.update(source=url, fetchedAt=now.astimezone(KST).strftime("%Y-%m-%d %H:%M"),
                     currentEnd=latest, currentWeekHasData=True)
        saved["items"].sort(key=lambda row: row["perfWeek"], reverse=True)
    previous["marketOverlay"]["through"] = latest
    update_macro(previous["series"], latest)
    month = latest[:7]
    updated = correlations(previous["series"], month)
    if updated:
        saved = {row["month"]: row for row in previous["monthlyCorrelations"]}
        saved[month] = updated
        previous["monthlyCorrelations"] = [saved[key] for key in sorted(saved)]
    previous["schemaVersion"] = 1
    previous["generatedAt"] = now.isoformat()
    return previous


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("published_html", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--preserve", action="store_true")
    args = parser.parse_args()
    now = datetime.now(timezone.utc)
    data = extract(args.published_html.read_text(encoding="utf-8-sig"))
    try:
        with urlopen(SITE + "briefing-data.json", timeout=12) as response:
            public = json.load(response)
        if public["marketOverlay"]["through"] >= data["marketOverlay"]["through"]:
            # Keep the original collector's macro series when the HTML has been refreshed.
            for name in data["series"].keys() & public["series"].keys():
                if data["series"][name]["dates"][-1:] > public["series"][name]["dates"][-1:]:
                    public["series"][name] = data["series"][name]
            data = public
    except HTTPError as error:
        if error.code != 404:
            raise
    if not args.preserve:
        data = refresh(data, now)
    elif "schemaVersion" not in data:
        raise SystemExit(0)
    args.output.write_text(json.dumps(data, ensure_ascii=False, allow_nan=False), encoding="utf-8")
