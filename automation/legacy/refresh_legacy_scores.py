"""Publish the existing legacy scoring engine from validated cloud market series."""
import argparse
import hashlib
import json
import math
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.error import HTTPError
from urllib.request import urlopen

from main import run, write_atomic
from src.allocation_policy import score_model_version, select_policy
from src.public_history import score_history


ROOT = Path(__file__).resolve().parent
BASE = "https://wlstn6115-rgb.github.io/us-stock-weekly/asset-allocation/"
ASSETS = ("QQQ", "BTC", "GOLD", "CASH")
STATE = "legacy-score-state.json"
REQUIRED = ("S&P 500", "Nasdaq 100", "US 10Y Treasury", "Dollar Index", "Gold", "Bitcoin (USD)")


def read(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def download(name):
    with urlopen(BASE + name, timeout=15) as response:
        return json.load(response)


def public_state(result):
    return {
        "market_date": result["market_date"],
        "config_hash": result["config_hash"],
        "weights": result["weights"],
        "factors": {key: {"value": value["value"]} for key, value in result["factors"].items()},
        "scores": {asset: {"current_score": result["scores"][asset]["current_score"]} for asset in ASSETS},
    }


def refresh(briefing, output, preserve=False):
    config = read(ROOT / "config/model.json")
    registry = read(ROOT / "config/allocation_policies.json")
    config_hash = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()
    market = download("market.json")
    history = download("score-history.json")
    try:
        state = download(STATE)
    except HTTPError as exc:
        if exc.code != 404:
            raise
        state = read(ROOT / STATE)
    if not preserve and briefing and briefing["marketOverlay"]["through"] > market["result"]["market_date"]:
        cutoff = briefing["marketOverlay"]["through"]
        if state["config_hash"] != config_hash or state["market_date"] != market["result"]["market_date"]:
            raise ValueError("Latest published legacy score has no matching adaptive-weight state")
        for name in REQUIRED:
            item = briefing["series"][name]
            dates, values = item["dates"], item["values"]
            if (len(dates) < 80 or len(dates) != len(values) or dates != sorted(set(dates))
                    or cutoff not in dates or not all(math.isfinite(v) and v > 0 for v in values)):
                raise ValueError(f"Invalid legacy score input: {name}")
        with TemporaryDirectory() as temp:
            work = Path(temp)
            archive = work / "history" / config_hash
            for row in history["observations"]:
                if row["modelVersion"] != config_hash or row["date"] >= cutoff:
                    continue
                if all(isinstance(row["scores"].get(asset), (int, float)) for asset in ASSETS):
                    write_atomic(archive / f'{row["date"]}.json', {"market_date": row["date"],
                        "scores": {asset: {"current_score": row["scores"][asset]} for asset in ASSETS}})
            write_atomic(archive / f'{state["market_date"]}.json', state)
            captured = datetime.fromisoformat(briefing["generatedAt"]).isoformat()
            result = run({"schema_version": 1, "market_date": cutoff, "generated_at": captured,
                          "series": briefing["series"], "market_items": [],
                          "validation_status": "PASS"}, config, work, portfolio=None)
        if not all(row["usable"] for row in result["scores"].values()):
            raise ValueError("Legacy score coverage is insufficient")
        state = public_state(result)
        allowed = ("market_date", "generated_at", "available_at", "config_hash", "regime", "stress", "scores", "warnings")
        public = {key: result[key] for key in allowed}
        public.update(model_version=score_model_version(result), status="scores_only",
                      minimum_score_coverage=config["minimum_coverage"])
        for score in public["scores"].values():
            for contribution in score["contributions"]:
                contribution["latest_observation"] = result["factors"][contribution["factor"]]["latest_observation"]
        market = {"result": public, "rules": config["rules"],
                  "allocation_policy": select_policy(public, registry)}
        rows = {(row["date"], row["modelVersion"]): row for row in history["observations"]}
        row = score_history([result])["observations"][0]
        rows[(row["date"], row["modelVersion"])] = row
        history["observations"] = [rows[key] for key in sorted(rows)]
    for filename, payload in (("market.json", market), ("score-history.json", history), (STATE, state)):
        write_atomic(output / filename, payload)
    print(f'Legacy score: {market["result"]["market_date"]}')


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("briefing", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--preserve", action="store_true")
    args = parser.parse_args()
    refresh(read(args.briefing) if args.briefing.exists() else None, args.output, args.preserve)
