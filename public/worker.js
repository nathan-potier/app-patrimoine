// Cloudflare Worker : proxy gratuit vers Yahoo Finance (résout le blocage CORS)
// Routes : GET /search?q=total   |   GET /quote?symbols=AAPL,AIR.PA
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; mypatrimoine)' };
const CORS = {
  'Access-Control-Allow-Origin': 'https://mypatrimoine-np.web.app', // pour restreindre : mets l'URL de ton site
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json'
};
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: CORS });

async function getChart(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  const r = await fetch(url, { headers: UA, cf: { cacheTtl: 60, cacheEverything: true } });
  if (!r.ok) return null;
  const j = await r.json();
  const m = j && j.chart && j.chart.result && j.chart.result[0] && j.chart.result[0].meta;
  return m && m.regularMarketPrice > 0 ? { price: m.regularMarketPrice, currency: m.currency } : null;
}

export default {
  async fetch(req) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(req.url);

    if (url.pathname === '/search') {
      const q = url.searchParams.get('q') || '';
      if (q.length < 2) return json([]);
      const r = await fetch(
        `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&lang=fr-FR`,
        { headers: UA, cf: { cacheTtl: 3600, cacheEverything: true } }
      );
      if (!r.ok) return json([]);
      const j = await r.json();
      const ok = ['EQUITY', 'ETF', 'MUTUALFUND', 'CRYPTOCURRENCY'];
      return json((j.quotes || [])
        .filter(x => x.symbol && ok.includes(x.quoteType))
        .map(x => ({ symbol: x.symbol, name: x.longname || x.shortname || x.symbol, exchange: x.exchDisp || x.exchange || '', type: x.quoteType })));
    }

    if (url.pathname === '/quote') {
      const symbols = (url.searchParams.get('symbols') || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 40);
      const fx = {}; // taux de change mis en cache pendant la requête
      const toEUR = async (price, cur) => {
        if (cur === 'EUR') return price;
        let c = cur;
        if (c === 'GBp' || c === 'GBX') { price = price / 100; c = 'GBP'; } // Londres cote en pence
        if (!(c in fx)) { const f = await getChart(`${c}EUR=X`); fx[c] = f ? f.price : null; }
        return fx[c] ? price * fx[c] : null;
      };
      const out = {};
      await Promise.all(symbols.map(async (sym) => {
        const c = await getChart(sym);
        out[sym] = c ? { price: c.price, currency: c.currency, priceEUR: await toEUR(c.price, c.currency) } : null;
      }));
      return json(out);
    }

    return json({ error: 'not found' }, 404);
  }
};