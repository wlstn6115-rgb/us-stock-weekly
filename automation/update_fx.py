"""Collect hourly USD/KRW observations without changing historical simulation FX."""
import argparse
from datetime import datetime, timezone
from pathlib import Path
from update_historical_prices import atomic_write, positive


def payload_from_frame(frame, now):
    values = frame['Close'].dropna()
    if values.empty:
        raise ValueError('No FX observations')
    stamp = values.index[-1]
    if stamp.tzinfo is None:
        raise ValueError('FX observation timezone missing')
    observed = stamp.to_pydatetime().astimezone(timezone.utc)
    value = float(values.iloc[-1])
    age = (now-observed).total_seconds()
    if not positive(value) or age < -300 or age > 7*86400:
        raise ValueError('FX observation invalid or stale')
    return {'schemaVersion':1, 'date':observed.date().isoformat(), 'observedAt':observed.isoformat(),
            'value':value, 'unit':'KRW per USD', 'source':'Yahoo Finance KRW=X',
            'interval':'1h', 'observationType':'hourly bar timestamp; latest bar may be incomplete',
            'updatedAt':now.isoformat()}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    args=parser.parse_args()
    import yfinance as yf
    frame=yf.download('KRW=X', period='5d', interval='1h', auto_adjust=False,
                      multi_level_index=False, progress=False, threads=False)
    payload=payload_from_frame(frame, datetime.now(timezone.utc))
    atomic_write(args.output, payload, lambda p: positive(p['value']))
    print(f"FX {payload['value']} at {payload['observedAt']}")

if __name__=='__main__':
    main()
