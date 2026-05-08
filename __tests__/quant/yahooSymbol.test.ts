import { describe, it, expect } from 'vitest'
import { yahooSymbolFromParam } from '@/lib/quant/yahooSymbol'

describe('yahooSymbolFromParam', () => {
  it('uppercases plain ticker symbols', () => {
    expect(yahooSymbolFromParam('aapl')).toBe('AAPL')
    expect(yahooSymbolFromParam('Msft')).toBe('MSFT')
  })

  it('passes through ^-prefixed indices unchanged', () => {
    expect(yahooSymbolFromParam('^VIX')).toBe('^VIX')
    expect(yahooSymbolFromParam('^GSPC')).toBe('^GSPC')
    expect(yahooSymbolFromParam('^DJI')).toBe('^DJI')
  })

  it('lowercases ^-prefixed indices and uppercases', () => {
    expect(yahooSymbolFromParam('^vix')).toBe('^VIX')
  })

  it('prepends ^ for known plain US-index names (F4.10 expanded set)', () => {
    expect(yahooSymbolFromParam('VIX')).toBe('^VIX')
    expect(yahooSymbolFromParam('GSPC')).toBe('^GSPC')
    expect(yahooSymbolFromParam('DJI')).toBe('^DJI')
    expect(yahooSymbolFromParam('IXIC')).toBe('^IXIC')
    expect(yahooSymbolFromParam('NDX')).toBe('^NDX')
    expect(yahooSymbolFromParam('TNX')).toBe('^TNX')
    expect(yahooSymbolFromParam('IRX')).toBe('^IRX')
    expect(yahooSymbolFromParam('TYX')).toBe('^TYX')
    expect(yahooSymbolFromParam('RUT')).toBe('^RUT')
    expect(yahooSymbolFromParam('SPX')).toBe('^SPX')
  })

  it('does not prepend ^ for non-index plain symbols', () => {
    expect(yahooSymbolFromParam('AAPL')).toBe('AAPL')
    expect(yahooSymbolFromParam('SPY')).toBe('SPY')
    expect(yahooSymbolFromParam('XLK')).toBe('XLK')
  })

  it('preserves dash and dot separators in tickers', () => {
    expect(yahooSymbolFromParam('BRK-B')).toBe('BRK-B')
    expect(yahooSymbolFromParam('BF.B')).toBe('BF.B')
  })

  it('preserves futures equals-sign suffix', () => {
    expect(yahooSymbolFromParam('GC=F')).toBe('GC=F')
    expect(yahooSymbolFromParam('CL=F')).toBe('CL=F')
  })

  it('trims surrounding whitespace', () => {
    expect(yahooSymbolFromParam('  AAPL  ')).toBe('AAPL')
    expect(yahooSymbolFromParam('\tVIX\n')).toBe('^VIX')
  })

  it('returns string (never null) — caller responsible for further validation', () => {
    // This is the key API contract: yahooSymbolFromParam is permissive
    // (returns whatever the user typed, uppercased). normalizeTicker in
    // sanitize.ts is the strict alternative for routes that need to reject.
    expect(typeof yahooSymbolFromParam('whatever-string')).toBe('string')
  })
})
