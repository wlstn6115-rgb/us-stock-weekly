/* Optional public API transport for the three Cloud Run market datasets. */
globalThis.readPublicMarketDataset = async function (file, fallback, fetcher, options = {}) {
  const routes = {
    'fx.json': 'fx',
    'market-charts.json': 'market-charts',
    'simulation-history.json': 'simulation-history',
    'ver2-signal.json': 'ver2-signal',
    'ver2-observations.json': 'ver2-observations',
    'ver2-tracking.json': 'ver2-tracking',
    'ver2-tracking-prices.json': 'ver2-tracking-prices',
    'ver2-simulation-history.json': 'ver2-simulation-history',
    'ver2-practice-trends.json': 'ver2-practice-trends',
    'institutional-disclosures.json': 'institutional-disclosures',
  };
  const base = globalThis.PUBLIC_MARKET_API_URL;
  if (base && Object.hasOwn(routes, file)) {
    try {
      const api = new URL('/api/v1/' + routes[file], base);
      if (api.protocol === 'https:') {
        const signal = AbortSignal.timeout(3500);
        const response = await fetcher(api.href, { signal, credentials: 'omit' });
        if (response.ok) {
          const payload = await response.json();
          if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
            return new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } });
          }
        }
      }
    } catch {
      // The static Pages snapshot stays available when the API cannot be reached.
    }
  }
  return fetcher(fallback, options);
};

globalThis.fetchPublicMarket = function (url, options) {
  return globalThis.readPublicMarketDataset(
    url.split('?')[0].split('/').pop(), url, globalThis.fetch.bind(globalThis), options,
  );
};
