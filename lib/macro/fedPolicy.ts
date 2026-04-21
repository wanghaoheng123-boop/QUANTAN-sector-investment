export type FedPolicyState = {
  fedFunds: number | null
  trend3mBps: number | null
  stance: 'cutting' | 'on_hold' | 'hiking' | 'aggressive'
}

export function classifyFedPolicy(series: { date: string; value: number }[]): FedPolicyState {
  const len = series.length
  const latest = len > 0 ? series[len - 1].value : null
  const prior = len > 63 ? series[len - 64].value : len > 21 ? series[len - 22].value : null
  const trend3mBps = latest != null && prior != null ? (latest - prior) * 100 : null
  let stance: FedPolicyState['stance'] = 'on_hold'
  if (trend3mBps != null) {
    if (trend3mBps > 75) stance = 'aggressive'
    else if (trend3mBps > 10) stance = 'hiking'
    else if (trend3mBps < -10) stance = 'cutting'
  }
  return { fedFunds: latest, trend3mBps, stance }
}

