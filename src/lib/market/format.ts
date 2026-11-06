export function usd(n: number, digits = 0): string {
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  return (n < 0 ? '-$' : '$') + s
}

export function signedUsd(n: number, digits = 2): string {
  return (n >= 0 ? '+' : '-') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function qty(n: number, digits = 4): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits })
}

export function bps(n: number, digits = 1): string {
  return n.toFixed(digits) + ' bps'
}

export function clock(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(11, 19)
}

export function shortHash(h: string): string {
  return h.length > 14 ? h.slice(0, 10) + '...' + h.slice(-6) : h
}
