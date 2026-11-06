import type { EngineState } from './types.ts'

/** One observation of a stock: taken every time the engine publishes a new state. */
export interface HistorySample {
  /** seconds (block time) */
  ts: number
  /** oracle reference price */
  ref: number
  hook: number
  control: number
  /** hook pool deviation from the reference, bps */
  devBps: number
  /** worst-case fee a swap would pay in the hook pool right now, bps */
  feeBps: number
  baseFeeBps: number
  /** hook-pool volume in USD over the loaded event window (0 when none) */
  volume: number
}

export interface Candle {
  /** bucket start, seconds */
  t: number
  o: number
  h: number
  l: number
  c: number
  /** USD traded in the bucket */
  vol: number
  /** highest fee in the bucket, bps */
  fee: number
  baseFee: number
  dev: number
  ref: number
}

export type Series = 'hook' | 'control'

/** Bounded per-symbol history. Samples with the same timestamp replace the last one (a user trade moves the pool without moving the clock). */
export class HistoryBuf {
  private m = new Map<string, HistorySample[]>()
  private cap: number
  constructor(cap = 4000) {
    this.cap = cap
  }

  push(sym: string, s: HistorySample): void {
    let a = this.m.get(sym)
    if (!a) {
      a = []
      this.m.set(sym, a)
    }
    const last = a[a.length - 1]
    if (last && last.ts === s.ts) a[a.length - 1] = s
    else a.push(s)
    if (a.length > this.cap) a.splice(0, a.length - this.cap)
  }

  get(sym: string): readonly HistorySample[] {
    return this.m.get(sym) ?? []
  }

  record(state: EngineState): void {
    const ts = state.chainTs
    if (!ts) return
    for (const m of state.markets) {
      this.push(m.sym, {
        ts,
        ref: m.refPriceUsd,
        hook: m.hook.priceUsd,
        control: m.control.priceUsd,
        devBps: m.hook.devBps,
        feeBps: Math.max(m.hook.feeBuyBps, m.hook.feeSellBps),
        baseFeeBps: m.hook.baseFeeBps,
        volume: m.hook.volumeUsd,
      })
    }
  }
}

/** Fold samples into OHLC candles of `bucketSec` seconds. */
export function toCandles(samples: readonly HistorySample[], bucketSec: number, series: Series): Candle[] {
  const out: Candle[] = []
  let prevVol = samples.length ? samples[0]!.volume : 0
  for (const s of samples) {
    const p = series === 'hook' ? s.hook : s.control
    const t = Math.floor(s.ts / bucketSec) * bucketSec
    const cur = out[out.length - 1]
    if (cur && cur.t === t) {
      cur.h = Math.max(cur.h, p)
      cur.l = Math.min(cur.l, p)
      cur.c = p
      cur.vol += Math.max(0, s.volume - prevVol)
      cur.fee = Math.max(cur.fee, s.feeBps)
      cur.dev = s.devBps
      cur.ref = s.ref
    } else {
      out.push({ t, o: p, h: p, l: p, c: p, vol: Math.max(0, s.volume - prevVol), fee: s.feeBps, baseFee: s.baseFeeBps, dev: s.devBps, ref: s.ref })
    }
    prevVol = s.volume
  }
  return out
}

export const RESOLUTIONS = [
  { id: '1m', label: '1m', sec: 60 },
  { id: '5m', label: '5m', sec: 300 },
  { id: '15m', label: '15m', sec: 900 },
] as const
export type ResolutionId = (typeof RESOLUTIONS)[number]['id']
