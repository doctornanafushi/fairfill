import "server-only";
import type { Reference } from "@/lib/types";
import { memo } from "./util";

// 基準価格の優先順位: Pyth（有料キー）→ Finnhub（無料キー）→ 呼び出し側で見積もりの中央値
const STALE_SEC = 15 * 60;
const cache = memo<Reference | null>(30 * 1000);

async function fromPyth(ticker: string): Promise<Reference | null> {
  const key = process.env.PYTH_API_KEY;
  if (!key) return null;
  const base = "https://pyth.dourolabs.app/hermes";
  const headers = { Authorization: `Bearer ${key}` };
  const feeds = (await (
    await fetch(`${base}/v2/price_feeds?query=${encodeURIComponent(ticker)}&asset_type=equity`, { headers })
  ).json()) as any[];
  const cands = feeds.filter((x) => {
    const at = x.attributes ?? {};
    const names = [at.base, at.display_symbol, at.nasdaq_symbol].filter(Boolean).map((s: string) => s.toUpperCase());
    return names.includes(ticker) && String(at.quote_currency ?? "USD").toUpperCase() === "USD";
  });
  if (!cands.length) return null;
  const latest = (await (
    await fetch(`${base}/v2/updates/price/latest?${cands.map((c) => `ids[]=${c.id}`).join("&")}&parsed=true`, {
      headers,
    })
  ).json()) as any;
  const now = Date.now() / 1000;
  const ps = (latest.parsed ?? [])
    .map((p: any) => ({
      price: Number(p.price.price) * 10 ** Number(p.price.expo),
      age: now - Number(p.price.publish_time),
    }))
    .sort((a: any, b: any) => a.age - b.age);
  if (!ps.length) return null;
  return { price: ps[0].price, source: "pyth", label: `Pyth ${ticker}`, ageSec: ps[0].age, stale: ps[0].age > STALE_SEC };
}

async function fromFinnhub(ticker: string): Promise<Reference | null> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return null;
  const res = await fetch(
    `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${key}`,
    { cache: "no-store" },
  );
  if (!res.ok) {
    console.error(`[finnhub] ${ticker}: HTTP ${res.status} (check FINNHUB_API_KEY in .env.local)`);
    return null;
  }
  const q = (await res.json()) as { c?: number; pc?: number; t?: number };
  const price = Number(q.c) || Number(q.pc);
  if (!price) return null;
  const age = q.t ? Date.now() / 1000 - Number(q.t) : null;
  return {
    price,
    source: "finnhub",
    label: Number(q.c) ? `Finnhub ${ticker}` : `Finnhub ${ticker} (prev. close)`,
    ageSec: age,
    stale: age === null || age > STALE_SEC,
  };
}

export function referencePrice(ticker: string): Promise<Reference | null> {
  return cache(ticker, async () => {
    for (const f of [fromPyth, fromFinnhub]) {
      try {
        const r = await f(ticker);
        if (r) return r;
      } catch (e) {
        console.error(`[reference] ${ticker}:`, e); // 次の取得元へ
      }
    }
    return null;
  });
}
