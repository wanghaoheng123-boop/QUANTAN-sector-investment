# Crypto (BTC) data — team workflow

Use this when debugging “errors / no data / chart blank” reports.

## Roles (specialized team)

| Track | Owns | Verifies |
|--------|------|----------|
| **Client** | `app/crypto/btc/page.tsx`, WebSockets, `fetch` | Network tab: `/api/crypto/btc`, status, JSON `candles.length` |
| **API** | `app/api/crypto/btc/**/route.ts` | Server can reach Binance → Kraken → CoinGecko; no Edge-only limits |
| **Chart** | `components/KLineChart.tsx` | No duplicate bar times; `fitContent` after `setData` |
| **Ops** | `next.config.js` PWA | `/api/*` is **NetworkOnly** (not cached by SW) |
| **QA** | `npm run diagnose:crypto` | All three REST sources or document geo-block |

## Ordered checklist

1. **Browser → API**  
   DevTools → Network → `api/crypto/btc?interval=1d` → **200** + `candles` array.  
   If **404**: wrong `basePath` → set `NEXT_PUBLIC_BASE_PATH` to match `next.config.js` `basePath`.

2. **API → exchanges**  
   Run `npm run diagnose:crypto`. If Binance fails but Kraken/CoinGecko OK, server region is restricted; fallbacks should still return 200.

3. **PWA**  
   After deploy, hard-refresh or clear site data so old cached API responses are gone.

4. **WebSocket**  
   Filter **WS** to `stream.binance.com`. If stuck “reconnecting”, REST candles can still work; header uses `/api/crypto/btc/quote` (CoinGecko) after a few seconds.

5. **Chart crash**  
   Wrapped in `CryptoChartBoundary`; invalid OHLC rows are stripped by `normalizeBtcCandles` before render.

## Regression commands

```bash
npm run diagnose:crypto
npm run verify:btc
```

Optional with app running:

```bash
set VERIFY_APP_BASE_URL=http://127.0.0.1:3000
npm run diagnose:crypto
```
