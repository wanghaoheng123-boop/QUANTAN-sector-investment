/**
 * Data provider dispatcher (Phase 15 Q-048-NEW).
 * Polygon primary when POLYGON_API_KEY set; Yahoo fallback.
 */

import { YahooProvider } from './yahoo'
import { PolygonProvider } from './polygon'

export type DataClass = 'equity-eod' | 'equity-quote' | 'macro-series' | 'crypto-quote'

export interface ProviderInfo {
  name: string
  primary: boolean
}

const yahoo = new YahooProvider()
const polygon = new PolygonProvider(process.env.POLYGON_API_KEY)

export function getActiveProvider(dataClass: DataClass): ProviderInfo {
  const polygonKey = process.env.POLYGON_API_KEY?.trim()
  const polygonOk = Boolean(polygonKey) && polygon.isAvailable()

  if (polygonOk && (dataClass === 'equity-eod' || dataClass === 'equity-quote')) {
    return { name: 'polygon', primary: true }
  }
  if (dataClass === 'macro-series') {
    return { name: 'fred', primary: false }
  }
  if (dataClass === 'crypto-quote') {
    return { name: 'yahoo', primary: !polygonOk }
  }
  return { name: 'yahoo', primary: !polygonOk }
}

export function getEquityProvider() {
  const info = getActiveProvider('equity-eod')
  return info.name === 'polygon' && polygon.isAvailable() ? polygon : yahoo
}

export function getQuoteProvider() {
  const info = getActiveProvider('equity-quote')
  return info.name === 'polygon' && polygon.isAvailable() ? polygon : yahoo
}
