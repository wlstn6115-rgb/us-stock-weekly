"""Refresh the public Ver2 model from its original providers."""
import argparse
from bisect import bisect_left
from concurrent.futures import ThreadPoolExecutor
import csv
from datetime import datetime, time, timedelta, timezone
import io
import json
import math
from pathlib import Path
from urllib.request import Request, urlopen
from uuid import uuid4
from zoneinfo import ZoneInfo

SYMBOLS = {
    "S&P 500": "TVC:SPX", "US 10Y Treasury": "TVC:US10Y",
    "Gold": "OANDA:XAUUSD", "Bitcoin (USD)": "BITSTAMP:BTCUSD",
    "WTI Crude": "TVC:USOIL", "Dollar Index": "TVC:DXY", "USD/KRW": "FX_IDC:USDKRW",
}
BASE = "https://wlstn6115-rgb.github.io/us-stock-weekly/asset-allocation/"
FILES = ("ver2-signal.json", "ver2-observations.json",
         "ver2-tracking-prices.json", "ver2-tracking.json")
SEOUL = ZoneInfo("Asia/Seoul")


def get(url, headers=None):
    with urlopen(Request(url, headers=headers or {}), timeout=35) as response:
        return response.read().decode("utf-8-sig")


def tradingview(symbol):
    from websockets.sync.client import connect

    session = "cs_" + uuid4().hex[:12]
    bars = {}
    with connect("wss://data.tradingview.com/socket.io/websocket",
                 origin="https://kr.tradingview.com", open_timeout=15,
                 close_timeout=3, max_size=8_000_000) as ws:
        def send(method, parameters):
            message = json.dumps({"m": method, "p": parameters}, separators=(",", ":"))
            ws.send(f"~m~{len(message)}~m~{message}")

        send("set_auth_token", ["unauthorized_user_token"])
        send("chart_create_session", [session, ""])
        definition = json.dumps({"symbol": symbol, "adjustment": "splits", "session": "regular"})
        send("resolve_symbol", [session, "symbol_1", "=" + definition])
        send("create_series", [session, "s1", "s1", "symbol_1", "60", 12000])
        for _ in range(32):
            data = ws.recv(timeout=20)
            while data:
                prefix, length, data = data.split("~m~", 2)
                if prefix or not length.isdecimal():
                    raise ValueError(f"Invalid TradingView frame for {symbol}")
                size = int(length)
                message, data = data[:size], data[size:]
                if message.startswith("~h~"):
                    ws.send(f"~m~{size}~m~{message}")
                    continue
                payload = json.loads(message)
                method, parameters = payload.get("m"), payload.get("p", [])
                if method in ("critical_error", "symbol_error", "series_error"):
                    raise ValueError(f"TradingView {method}: {symbol}")
                if method in ("timescale_update", "du") and len(parameters) >= 2:
                    for bar in parameters[1].get("s1", {}).get("s", []):
                        values = bar.get("v", [])
                        if len(values) >= 5 and isinstance(values[4], (int, float)):
                            bars[values[0]] = values[4]
                if method == "series_completed":
                    if len(bars) < 100:
                        raise ValueError(f"Insufficient TradingView history: {symbol}")
                    return sorted(bars.items())
        raise TimeoutError(f"TradingView series did not finish: {symbol}")


def fred():
    rows = csv.DictReader(io.StringIO(get("https://fred.stlouisfed.org/graph/fredgraph.csv?id=WALCL")))
    return {row.get("observation_date", row.get("DATE")): float(row["WALCL"]) / 1000
            for row in rows if row["WALCL"] not in ("", ".")}


def cnn():
    from curl_cffi import requests

    page = "https://edition.cnn.com/markets/fear-and-greed"
    with requests.Session(impersonate="chrome", timeout=30) as session:
        session.get(page).raise_for_status()
        response = session.get("https://production.dataviz.cnn.io/index/fearandgreed/graphdata",
                               headers={"Referer": page})
        response.raise_for_status()
        rows = response.json()["fear_and_greed_historical"]["data"]
    points = {}
    for row in rows:
        stamp, value = float(row["x"]), float(row["y"])
        if math.isfinite(stamp) and 0 <= value <= 100:
            day = datetime.fromtimestamp(stamp / (1000 if stamp >= 2e10 else 1), timezone.utc)
            points[day.date().isoformat()] = value
    return points


def close_series(bars, sessions):
    stamps = [row[0] for row in bars]
    result = {}
    for day, cutoff in sessions:
        end = cutoff.timestamp()
        index = bisect_left(stamps, end) - 1
        if index >= 0 and end - stamps[index] <= 8 * 3600:
            value = bars[index][1]
            if math.isfinite(value) and value > 0:
                result[day] = value
    return result


def collect(now):
    import pandas_market_calendars as calendars

    schedule = calendars.get_calendar("NYSE").schedule(
        start_date=now.date() - timedelta(days=460), end_date=now.date())
    sessions = [(day.date().isoformat(), row.market_close) for day, row in schedule.iterrows()
                if row.market_close + timedelta(minutes=15) <= now]
    latest = sessions[-1][0]
    with ThreadPoolExecutor(max_workers=4) as pool:
        tv = {label: pool.submit(tradingview, symbol) for label, symbol in SYMBOLS.items()}
        walcl, fear = pool.submit(fred), pool.submit(cnn)
        series = {label: close_series(future.result(), sessions)
                  for label, future in tv.items() if label != "USD/KRW"}
        fx = {}
        for stamp, value in tv["USD/KRW"].result():
            local = datetime.fromtimestamp(stamp, SEOUL)
            if (local.weekday() < 5 and local.time() < time(23, 30)
                    and local.date() < now.astimezone(SEOUL).date()
                    and math.isfinite(value) and value > 0):
                fx[local.date().isoformat()] = value
        series["USD/KRW"] = fx
        series["Federal Reserve Balance Sheet"] = {
            day: value for day, value in walcl.result().items() if day <= latest
        }
        fear_rows = fear.result()
        series["Fear & Greed"] = {day: fear_rows[day] for day, _ in sessions if day in fear_rows}
    for label in SYMBOLS.keys() - {"USD/KRW"}:
        if latest not in series[label] or len(series[label]) < 80:
            raise ValueError(f"Missing expected NYSE close for {label}: {latest}")
    return latest, {label: {"dates": sorted(rows), "values": [rows[d] for d in sorted(rows)]}
                    for label, rows in series.items()}


def update(site, fetch):
    folder = site / "asset-allocation"
    now = datetime.now(timezone.utc)
    public = {name: json.loads(get(BASE + name + f"?ver2={int(now.timestamp())}")) for name in FILES}
    previous = {name: json.loads((folder / name).read_text(encoding="utf-8-sig")) for name in FILES}
    for name, field in ((FILES[0], "marketDate"), (FILES[3], "through")):
        if public[name][field] >= previous[name][field]:
            previous[name] = public[name]
    for name, key in ((FILES[1], "marketDate"), (FILES[2], "date")):
        rows = {row[key]: row for row in previous[name]["observations"]}
        rows.update({row[key]: row for row in public[name]["observations"]})
        previous[name]["observations"] = [rows[k] for k in sorted(rows)]
    result = previous.copy()
    if fetch:
        from build_v2_signal import build_from_series as build_signal
        from build_v2_tracking import build_from_series as build_tracking

        latest, series = collect(now)
        signal = build_signal(series, now, source="cloud: TradingView/FRED/CNN")
        if signal["marketDate"] != latest:
            raise ValueError("Ver2 signal date differs from expected close")
        if latest >= previous[FILES[0]]["marketDate"] and latest >= previous[FILES[3]]["through"]:
            rows = {row["marketDate"]: row for row in previous[FILES[1]]["observations"]}
            if latest == previous[FILES[0]]["marketDate"]:
                signal = previous[FILES[0]]
            rows.setdefault(latest, signal)
            history = {"schemaVersion": 1, "observations": [rows[day] for day in sorted(rows)]}
            prices, tracking = build_tracking(series, site, history, previous[FILES[2]]["observations"])
            if tracking["through"] != latest:
                raise ValueError("Ver2 tracking did not reach the expected close")
            print(f"TradingView/FRED/CNN inputs checked for {latest}")
            result = dict(zip(FILES, (signal, history, prices, tracking)))
    for name, payload in result.items():
        (folder / name).write_text(json.dumps(payload, allow_nan=False, ensure_ascii=False), encoding="utf-8")
    print(f"Ver2 signal {result[FILES[0]]['marketDate']}, tracking {result[FILES[3]]['through']}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("site", type=Path)
    parser.add_argument("--preserve", action="store_true")
    args = parser.parse_args()
    update(args.site, not args.preserve)
