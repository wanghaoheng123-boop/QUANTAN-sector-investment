import { redirect } from 'next/navigation'

// The backtest page is deprecated — all functionality is now in the unified Trading Command Center at /simulator.
// The ?mode=backtest URL param opens directly in Historical Backtest mode.
export default function BacktestPage() {
  redirect('/simulator?mode=backtest')
}
