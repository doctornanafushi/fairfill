// screen2.ts — 流動性の低いトークン化株を洗い出して、AMM(Jupiter) と Gateway を比較する
//
//   1. Gateway の資産一覧から Solana 上の株 (asset_class === "stock") を全部取る
//   2. DexScreener で各銘柄の DEX 流動性(USD)と24h出来高を一括取得（30銘柄ずつ）
//   3. 同じ株を表すトークンの組（economic_asset_id が同じもの）を数える
//   4. 流動性が低い順に TOP 銘柄だけ、Jupiter の少額/大口と Gateway の大口を同時に見積もる
//   取引は一切しない（Gateway は注文を作るだけで execute しない）。
//
//   export TM_KEY_FILE="$HOME/.truemarkets/api-key.json"
//   npx tsx screen2.ts
//   TOP=30 SMALL=50 LARGE=1000 MIN_LIQ=1000 npx tsx screen2.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createPrivateKey, sign } from "node:crypto";

const API = "https://api.truemarkets.co";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USER_ID = process.env.TM_USER_ID ?? "24d9ab10-88fc-4ae8-82c6-8fc2c41e0921";
const TOP = Number(process.env.TOP ?? 30); // 比較する銘柄数
const SMALL = Number(process.env.SMALL ?? 50); // 少額(USDC)
const LARGE = Number(process.env.LARGE ?? 1000); // 大口(USDC)
const MIN_LIQ = Number(process.env.MIN_LIQ ?? 1000); // これ未満の流動性は「プールなし」扱い
const STAMP = Date.now();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const usd = (n: number) => (isNaN(n) ? "-" : "$" + Math.round(n).toLocaleString("en-US"));
const f = (n: number, d = 2) => (isNaN(n) ? "-" : n.toFixed(d));

// ---------- DexScreener: 流動性と出来高 ----------
type Liq = { liq: number; vol24: number; pairs: number; topDex: string; priceUsd: number };
async function fetchLiquidity(mints: string[]): Promise<Map<string, Liq>> {
  const m = new Map<string, Liq>();
  for (const mint of mints) m.set(mint, { liq: 0, vol24: 0, pairs: 0, topDex: "", priceUsd: NaN });
  const best = new Map<string, number>();

  for (let i = 0; i < mints.length; i += 30) {
    const batch = mints.slice(i, i + 30);
    const url = `https://api.dexscreener.com/tokens/v1/solana/${batch.join(",")}`;
    let pairs: any[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(url);
      if (res.status === 429) { await sleep(3000); continue; }
      pairs = await res.json().catch(() => []);
      break;
    }
    for (const p of Array.isArray(pairs) ? pairs : []) {
      const liq = Number(p.liquidity?.usd ?? 0);
      const vol = Number(p.volume?.h24 ?? 0);
      for (const side of [p.baseToken?.address, p.quoteToken?.address]) {
        const e = side && m.get(side);
        if (!e) continue;
        // 一番流動性の大きいペアの DEX 名と価格を代表値にする
        if (liq > (best.get(side) ?? -1)) {
          best.set(side, liq);
          e.topDex = p.dexId;
          if (side === p.baseToken?.address) e.priceUsd = Number(p.priceUsd);
        }
        e.liq += liq;
        e.vol24 += vol;
        e.pairs += 1;
      }
    }
    process.stdout.write(`\r流動性を取得中 ${Math.min(i + 30, mints.length)}/${mints.length}   `);
    await sleep(250);
  }
  console.log();
  return m;
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
  const res = await fetch(`${API}/v1/auth/api-key/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key_id: apiKey.key_id, timestamp, signature }),
  });
  const j: any = await res.json().catch(() => ({}));
  token = j.token ?? j.access_token ?? j.data?.token ?? j.data?.access_token ?? "";
  return !!token;
}

async function gatewayPrice(assetId: string, usdc: number) {
  const res = await fetch(`${API}/v1/gateway/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "TM-On-Behalf-Of": USER_ID,
    },
    body: JSON.stringify({ asset_id: assetId, qty: String(usdc), qty_unit: "quote", side: "buy", type: "market" }),
  });
  const j: any = await res.json().catch(() => ({}));
  const q = (j.data ?? j).quote;
  const out = Number(q?.qty_out);
  if (!out) return { price: NaN, note: `GW:${res.status} ${JSON.stringify(j).slice(0, 60)}` };
  return { price: usdc / out, note: "" }; // 手数料込み
}

// ---------- Jupiter ----------
async function jupPrice(mint: string, decimals: number, usdc: number) {
  const url =
    `https://lite-api.jup.ag/swap/v1/quote?inputMint=${USDC}&outputMint=${mint}` +
    `&amount=${Math.round(usdc * 1e6)}&slippageBps=50`;
  const res = await fetch(url);
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok || !j.outAmount) return { price: NaN, route: `経路なし(${res.status})` };
  const out = Number(j.outAmount) / 10 ** decimals;
  const route = (j.routePlan ?? []).map((r: any) => r.swapInfo?.label).join("→");
  return { price: usdc / out, route };
}

// ---------- 本体 ----------
async function main() {
  const { data } = (await (await fetch(`${API}/v1/gateway/assets`)).json()) as { data: any[] };
  const stocks = data.filter((a) => a.chain === "solana" && a.asset_class === "stock" && a.address && a.tradeable !== false);
  console.log(`Solana 上の株: ${stocks.length} 銘柄`);

  // --- 1) 流動性 ---
  const liq = await fetchLiquidity(stocks.map((a) => a.address));
  const table = stocks.map((a) => ({
    symbol: a.symbol, name: a.name, issuer: a.issuer, id: a.id, economic_asset_id: a.economic_asset_id,
    mint: a.address, decimals: Number(a.decimals ?? 8), ...liq.get(a.address)!,
  }));
  writeFileSync(`liquidity-${STAMP}.json`, JSON.stringify(table, null, 2));

  const noPool = table.filter((r) => r.liq < MIN_LIQ);
  const buckets = [1e3, 1e4, 1e5, 1e6, Infinity];
  console.log(`\n■ DEX 流動性の分布（${MIN_LIQ} 未満は「プールなし」扱い）`);
  let lo = 0;
  for (const hi of buckets) {
    const n = table.filter((r) => r.liq >= lo && r.liq < hi).length;
    console.log(`  ${usd(lo).padStart(12)} 〜 ${hi === Infinity ? "".padStart(12) : usd(hi).padStart(12)} : ${n} 銘柄`);
    lo = hi;
  }
  console.log(`  issuer 別のプールなし: ${JSON.stringify(countBy(noPool, "issuer"))}`);

  // --- 2) 同じ株を表すトークンの組 ---
  const groups = new Map<string, any[]>();
  for (const a of data) {
    if (a.asset_class !== "stock" || !a.economic_asset_id) continue;
    const g = groups.get(a.economic_asset_id) ?? [];
    g.push(a);
    groups.set(a.economic_asset_id, g);
  }
  const multi = [...groups.values()].filter((g) => g.length > 1);
  console.log(`\n■ 同じ株を表す複数トークン（economic_asset_id が同じ）: ${multi.length} 組`);
  for (const g of multi.slice(0, 8)) {
    console.log("  " + g.map((a) => `${a.symbol}[${a.issuer ?? "-"}/${a.chain}]`).join("  ⇔  "));
  }

  // --- 3) 薄い順に TOP 銘柄だけ比較 ---
  const cands = table.filter((r) => r.liq >= MIN_LIQ).sort((x, y) => x.liq - y.liq).slice(0, TOP);
  const hasGw = await mintToken();
  console.log(`\n■ 流動性が低い順に ${cands.length} 銘柄を比較（少額 ${SMALL} / 大口 ${LARGE} USDC）` +
    (hasGw ? "" : "  ※TM_KEY_FILE なし：Jupiter のみ"));

  const rows: any[] = [];
  for (const [i, r] of cands.entries()) {
    const s = await jupPrice(r.mint, r.decimals, SMALL);
    await sleep(1100);
    const l = await jupPrice(r.mint, r.decimals, LARGE);
    await sleep(1100);
    const gw = hasGw ? await gatewayPrice(r.id, LARGE) : { price: NaN, note: "" };
    if (hasGw) await sleep(800);
    const ammImpact = (l.price / s.price - 1) * 100;
    const gwVsJup = (gw.price / l.price - 1) * 100; // マイナスなら Gateway が安い
    const winner = isNaN(l.price) && !isNaN(gw.price) ? "GW(AMM不可)"
      : isNaN(gwVsJup) ? "-" : gwVsJup < 0 ? "Gateway" : "Jupiter";
    rows.push({ ...r, jup_small: s.price, jup_large: l.price, amm_impact_pct: ammImpact,
      gw_large: gw.price, gw_vs_jup_pct: gwVsJup, winner_large: winner, route_large: l.route, note: gw.note });
    process.stdout.write(`\r  ${i + 1}/${cands.length} ${r.symbol}            `);
  }

  console.log("\n\n銘柄        発行体   DEX流動性    AMM悪化率  Jup大口      GW大口       GW-Jup   大口の勝者   経路");
  for (const r of rows) {
    console.log(
      `${String(r.symbol).padEnd(10)} ${String(r.issuer).padEnd(8)} ${usd(r.liq).padStart(10)}  ` +
      `${(f(r.amm_impact_pct, 3) + "%").padStart(9)}  ${f(r.jup_large, 4).padStart(10)}  ${f(r.gw_large, 4).padStart(10)}  ` +
      `${(f(r.gw_vs_jup_pct, 3) + "%").padStart(8)}   ${String(r.winner_large).padEnd(11)}  ${r.route_large}` +
      (r.note ? "  " + r.note : ""),
    );
  }
  const wins = countBy(rows, "winner_large");
  console.log(`\n大口(${LARGE} USDC)の勝者: ${JSON.stringify(wins)}`);

  writeFileSync(`screen2-${SMALL}-${LARGE}-${STAMP}.json`, JSON.stringify({ rows, multi: multi.map((g) => g.map((a) => ({ symbol: a.symbol, issuer: a.issuer, chain: a.chain, id: a.id }))) }, null, 2));
  console.log(`✓ liquidity-${STAMP}.json と screen2-${SMALL}-${LARGE}-${STAMP}.json に保存しました`);
}

function countBy(rows: any[], key: string) {
  const c: Record<string, number> = {};
  for (const r of rows) c[String(r[key])] = (c[String(r[key])] || 0) + 1;
  return c;
}

main().catch((e) => {
  console.error("\n✗", e?.message ?? e);
  process.exit(1);
});
