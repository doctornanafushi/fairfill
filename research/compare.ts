// compare.ts — 実在の株のティッカーと金額を入れると、
//   ・Pyth オラクルの株価（基準価格）
//   ・Solana 上のトークン化株（xStocks / Ondo …）ごとの Jupiter と Gateway の見積もり
// を並べ、基準価格に対する「払いすぎ率」で一番得な買い方を推奨し、危ない見積もりに警告を出す。
// 取引は一切しない（Gateway は注文を作るだけで execute しない）。
//
//   export TM_KEY_FILE="$HOME/.truemarkets/api-key.json"
//   export PYTH_API_KEY=...        # あれば pyth.dourolabs.app、なければ旧公開エンドポイントを試す
//   npx tsx compare.ts AAPL 100
//   npx tsx compare.ts AAOI 500
//
//   WARN=2 DANGER=10 で警告のしきい値(%)を変更
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createPrivateKey, sign } from "node:crypto";

const TM_API = "https://api.truemarkets.co";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USER_ID = process.env.TM_USER_ID ?? "24d9ab10-88fc-4ae8-82c6-8fc2c41e0921";
const PYTH_KEY = process.env.PYTH_API_KEY ?? "";
const PYTH = PYTH_KEY ? "https://pyth.dourolabs.app/hermes" : "https://hermes.pyth.network";
const WARN = Number(process.env.WARN ?? 2); // 基準価格より何%高ければ注意
const DANGER = Number(process.env.DANGER ?? 10); // 何%高ければ危険（推奨しない）

const [tickerArg, amountArg = "100"] = process.argv.slice(2);
if (!tickerArg) {
  console.error("使い方: npx tsx compare.ts <ティッカー 例: AAPL> <金額USDC>");
  process.exit(1);
}
const TICKER = tickerArg.toUpperCase();
const AMOUNT = Number(amountArg);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const f = (n: number, d = 2) => (isFinite(n) ? n.toFixed(d) : "-");

// ---------- トークン → 元の株のティッカー ----------
function underlying(a: any): string {
  const s = String(a.symbol ?? "").toUpperCase();
  if (a.issuer === "xstocks" && s.endsWith("X")) return s.slice(0, -1); // NVDAX → NVDA, BRK.BX → BRK.B
  if (a.issuer === "ondo" && s.endsWith("ON")) return s.slice(0, -2); // AAPLON → AAPL
  if (a.issuer === "coinbase" && s.endsWith("C")) return s.slice(0, -1); // NVDAC → NVDA
  return s;
}

// ---------- Pyth：基準価格 ----------
async function pythGet(path: string) {
  const res = await fetch(`${PYTH}${path}`, {
    headers: PYTH_KEY ? { Authorization: `Bearer ${PYTH_KEY}` } : {},
  });
  if (!res.ok) throw new Error(`Pyth ${res.status} ${(await res.text()).slice(0, 120)}`);
  return res.json();
}

type Ref = { price: number; conf: number; symbol: string; ageSec: number; isOpen?: boolean };
async function referencePrice(ticker: string): Promise<Ref | null> {
  const feeds: any[] = await pythGet(`/v2/price_feeds?query=${encodeURIComponent(ticker)}&asset_type=equity`);
  // 元の株そのもの（base が一致、USD 建て）。通常・時間外・夜間などの派生フィードがあれば全部候補にする
  const cands = feeds.filter((x) => {
    const at = x.attributes ?? {};
    const names = [at.base, at.display_symbol, at.nasdaq_symbol, at.generic_symbol]
      .filter(Boolean)
      .map((s: string) => String(s).toUpperCase());
    const quote = String(at.quote_currency ?? "USD").toUpperCase();
    return (names.includes(ticker) || String(at.symbol ?? "").toUpperCase().includes(`.${ticker}/USD`)) && quote === "USD";
  });
  if (!cands.length) return null;

  const qs = cands.map((x) => `ids[]=${x.id}`).join("&");
  const latest: any = await pythGet(`/v2/updates/price/latest?${qs}&parsed=true`);
  const now = Date.now() / 1000;
  const prices: Ref[] = (latest.parsed ?? []).map((p: any) => {
    const feed = cands.find((c) => c.id.replace(/^0x/, "") === String(p.id).replace(/^0x/, ""));
    const e = 10 ** Number(p.price.expo);
    return {
      price: Number(p.price.price) * e,
      conf: Number(p.price.conf) * e,
      symbol: feed?.attributes?.symbol ?? feed?.attributes?.description ?? p.id,
      ageSec: now - Number(p.price.publish_time),
      isOpen: feed?.market_hours?.is_open,
    };
  });
  // 一番新しいフィードを採用（市場時間外なら夜間・時間外のフィードが選ばれる）
  prices.sort((a, b) => a.ageSec - b.ageSec);
  return prices[0] ?? null;
}

// ---------- Finnhub：基準価格（無料キーで使える代替） ----------
async function finnhubPrice(ticker: string): Promise<Ref | null> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return null;
  const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${key}`);
  if (!res.ok) throw new Error(`Finnhub ${res.status}`);
  const q: any = await res.json();
  // c: 現在値（取れないと 0）、pc: 前日終値、t: 最終取引の UNIX 秒
  const price = Number(q.c) || Number(q.pc);
  if (!price) return null;
  return {
    price,
    conf: 0,
    symbol: Number(q.c) ? `Finnhub ${ticker}` : `Finnhub ${ticker}（前日終値）`,
    ageSec: q.t ? Date.now() / 1000 - Number(q.t) : NaN,
  };
}

// ---------- Gateway ----------
let token = "";
async function mintToken() {
  const keyFile = process.env.TM_KEY_FILE;
  if (!keyFile || !existsSync(keyFile)) return false;
  const apiKey = JSON.parse(readFileSync(keyFile, "utf8"));
  const key = createPrivateKey({ key: apiKey.private_key, format: "jwk" });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = sign("sha256", Buffer.from(`${apiKey.key_id}.${timestamp}`), {
    key,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  const res = await fetch(`${TM_API}/v1/auth/api-key/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key_id: apiKey.key_id, timestamp, signature }),
  });
  const j: any = await res.json().catch(() => ({}));
  token = j.token ?? j.access_token ?? j.data?.token ?? j.data?.access_token ?? "";
  return !!token;
}

async function gatewayQuote(assetId: string, usdc: number) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${TM_API}/v1/gateway/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "TM-On-Behalf-Of": USER_ID,
      },
      body: JSON.stringify({ asset_id: assetId, qty: String(usdc), qty_unit: "quote", side: "buy", type: "market" }),
    });
    if (res.status === 429) {
      const wait = Number(res.headers.get("X-RateLimit-Reset") ?? 2);
      await sleep(Math.max(1, wait) * 1000);
      continue;
    }
    const j: any = await res.json().catch(() => ({}));
    const out = Number((j.data ?? j).quote?.qty_out);
    return out ? { out, note: "" } : { out: NaN, note: `HTTP ${res.status}` };
  }
  return { out: NaN, note: "レート制限" };
}

// ---------- Jupiter ----------
async function jupiterQuote(mint: string, decimals: number, usdc: number) {
  const url =
    `https://lite-api.jup.ag/swap/v1/quote?inputMint=${USDC}&outputMint=${mint}` +
    `&amount=${Math.round(usdc * 1e6)}&slippageBps=50`;
  const res = await fetch(url);
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok || !j.outAmount) return { out: NaN, note: "経路なし" };
  const route = (j.routePlan ?? []).map((r: any) => r.swapInfo?.label).join("→");
  return { out: Number(j.outAmount) / 10 ** decimals, note: route };
}

// ---------- 判定 ----------
function verdict(overpay: number) {
  if (!isFinite(overpay)) return "—";
  if (overpay >= DANGER) return "⛔ 危険";
  if (overpay >= WARN) return "⚠ 注意";
  return "✓ 良好";
}

async function main() {
  // 1) 対象トークン
  const { data } = (await (await fetch(`${TM_API}/v1/gateway/assets`)).json()) as { data: any[] };
  const tokens = data.filter(
    (a) => a.chain === "solana" && a.asset_class === "stock" && a.tradeable !== false && underlying(a) === TICKER,
  );
  if (!tokens.length) {
    console.error(`✗ ${TICKER} のトークン化株が Solana 上に見つかりません`);
    process.exit(1);
  }
  console.log(`■ ${TICKER} を ${AMOUNT} USDC 分買う場合`);
  console.log(`  対象トークン: ${tokens.map((t) => `${t.symbol}(${t.issuer})`).join(", ")}`);

  // 2) 基準価格
  // 優先順位: Pyth（キーあり）→ Finnhub（無料キー）→ 見積もりの中央値（下で計算）
  let ref: Ref | null = null;
  if (PYTH_KEY) {
    try {
      ref = await referencePrice(TICKER);
    } catch (e: any) {
      console.log(`  ⚠ Pyth から取得できません: ${e.message}`);
    }
  }
  if (!ref) {
    try {
      ref = await finnhubPrice(TICKER);
    } catch (e: any) {
      console.log(`  ⚠ Finnhub から取得できません: ${e.message}`);
    }
  }
  if (ref) {
    const age = !isFinite(ref.ageSec) ? "時刻不明"
      : ref.ageSec < 120 ? `${Math.round(ref.ageSec)}秒前`
      : ref.ageSec < 7200 ? `${Math.round(ref.ageSec / 60)}分前`
      : `${Math.round(ref.ageSec / 3600)}時間前`;
    const stale =
      ref.isOpen === false ? "  ※米国市場は閉場中（終値ベース）"
      : ref.ageSec > 15 * 60 ? "  ※古い（市場時間外の可能性）" : "";
    console.log(`  基準価格: $${f(ref.price, 4)} ±${f(ref.conf, 4)}  [${ref.symbol}、${age}]${stale}`);
  } else {
    console.log("  基準価格: なし（払いすぎ率は出せません）");
  }

  // 3) 見積もり
  const hasGw = await mintToken();
  if (!hasGw) console.log("  ⚠ TM_KEY_FILE がないため Gateway の見積もりは省略");
  const rows: any[] = [];
  for (const t of tokens) {
    const dec = Number(t.decimals ?? 8);
    const [j, g] = await Promise.all([
      jupiterQuote(t.address, dec, AMOUNT),
      hasGw ? gatewayQuote(t.id, AMOUNT) : Promise.resolve({ out: NaN, note: "省略" }),
    ]);
    for (const [venue, q] of [["Jupiter", j], ["Gateway", g]] as const) {
      const price = AMOUNT / q.out; // 1トークンあたりの実効価格（手数料込み）
      const overpay = ref ? (price / ref.price - 1) * 100 : NaN;
      rows.push({ token: t.symbol, issuer: t.issuer, venue, out: q.out, price, overpay, note: q.note });
    }
    await sleep(600);
  }

  // 3.5) オラクルが取れないときは、見積もりの中央値を暫定の基準にする（外れ値を見つけるため）
  if (!ref) {
    const ps = rows.map((r) => r.price).filter((p) => isFinite(p)).sort((a, b) => a - b);
    if (ps.length >= 3) {
      const mid = ps.length % 2 ? ps[(ps.length - 1) / 2] : (ps[ps.length / 2 - 1] + ps[ps.length / 2]) / 2;
      ref = { price: mid, conf: 0, symbol: "見積もりの中央値（暫定）", ageSec: 0 };
      console.log(`  暫定基準: $${f(mid, 4)}（オラクルなしのため、${ps.length}件の見積もりの中央値）`);
      for (const r of rows) r.overpay = (r.price / mid - 1) * 100;
    }
  }

  // 4) 表示
  console.log("\n  トークン     発行体    取引場所   受取量          実効価格      払いすぎ率   判定      備考");
  for (const r of rows) {
    console.log(
      `  ${r.token.padEnd(11)} ${r.issuer.padEnd(8)}  ${r.venue.padEnd(8)}  ${f(r.out, 6).padStart(12)}  ` +
        `${("$" + f(r.price, 4)).padStart(12)}  ${(f(r.overpay, 2) + "%").padStart(9)}   ${verdict(r.overpay).padEnd(7)}  ${r.note}`,
    );
  }

  // 5) 推奨
  const ok = rows.filter((r) => isFinite(r.price));
  const scored = ref ? ok.filter((r) => r.overpay < DANGER) : ok;
  scored.sort((a, b) => a.price - b.price);
  console.log();
  if (!scored.length) {
    console.log(`  ⛔ どの買い方も基準価格より ${DANGER}% 以上高い（または見積もりなし）。今は買わない方がいいです。`);
  } else {
    const best = scored[0];
    const worst = ok.sort((a, b) => b.price - a.price)[0];
    const saved = AMOUNT * (1 - best.price / worst.price);
    console.log(`  ✅ 推奨: ${best.token}（${best.issuer}）を ${best.venue} で買う  実効 $${f(best.price, 4)}` +
      (ref ? `（基準 +${f(best.overpay, 2)}%）` : ""));
    if (worst !== best) console.log(`     最悪の選択肢（${worst.token} / ${worst.venue}）と比べて約 $${f(saved, 2)} 得`);
  }
  const dangers = rows.filter((r) => r.overpay >= DANGER);
  if (dangers.length)
    console.log(`  ⛔ 警告: ${dangers.map((r) => `${r.token}/${r.venue}`).join(", ")} は基準価格から大きく外れた見積もりです`);

  // 6) 保存（あとで README やデモの根拠に使う）
  const now = new Date();
  const out = `compare-${TICKER}-${AMOUNT}-${now.toISOString().replace(/[:.]/g, "-")}.json`;
  const num = (n: number) => (isFinite(n) ? n : null); // NaN/Infinity は JSON にできないので null に
  writeFileSync(
    out,
    JSON.stringify(
      {
        ticker: TICKER,
        amount_usdc: AMOUNT,
        fetched_at: now.toISOString(),
        reference: ref ? { ...ref, price: num(ref.price), conf: num(ref.conf), ageSec: num(ref.ageSec) } : null,
        thresholds: { warn_pct: WARN, danger_pct: DANGER },
        options: rows.map((r) => ({
          token: r.token,
          issuer: r.issuer,
          venue: r.venue,
          qty_out: num(r.out),
          effective_price: num(r.price),
          overpay_pct: num(r.overpay),
          verdict: verdict(r.overpay),
          route: r.note,
        })),
        recommended: scored[0] ? { token: scored[0].token, venue: scored[0].venue, effective_price: scored[0].price } : null,
      },
      null,
      2,
    ),
  );
  console.log(`\n  ✓ ${out} に保存しました`);
}

main().catch((e) => {
  console.error("✗", e?.message ?? e);
  process.exit(1);
});
