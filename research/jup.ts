// jup.ts — Jupiter（AMMアグリゲータ）で USDC → 銘柄 の見積もりを取る（キー不要・取引しない）
//
//   npx tsx jup.ts 10 100 1000 10000
//
//   環境変数 OUT_MINT / OUT_DECIMALS で銘柄を変更（省略時 NVDAx）
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const OUT_MINT = process.env.OUT_MINT ?? "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh"; // NVDAx
const OUT_DECIMALS = Number(process.env.OUT_DECIMALS ?? 8);
const SIZES = process.argv.slice(2).length ? process.argv.slice(2) : ["10", "100", "1000", "10000"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log("注文額(USDC)  受取       実効価格     価格影響   経路");
  for (const size of SIZES) {
    const amount = Math.round(Number(size) * 1e6); // USDC は 6 桁
    const url =
      `https://lite-api.jup.ag/swap/v1/quote?inputMint=${USDC}&outputMint=${OUT_MINT}` +
      `&amount=${amount}&slippageBps=50`;
    const res = await fetch(url);
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok || !j.outAmount) {
      console.log(`${size.padStart(10)}    ✗ HTTP ${res.status} ${JSON.stringify(j).slice(0, 200)}`);
    } else {
      const out = Number(j.outAmount) / 10 ** OUT_DECIMALS;
      const price = Number(size) / out;
      const impact = (Number(j.priceImpactPct) * 100).toFixed(3) + "%";
      const route = (j.routePlan ?? []).map((r: any) => r.swapInfo?.label).join(" → ");
      console.log(
        `${size.padStart(10)}    ${out.toFixed(6).padStart(10)}  ${price.toFixed(4).padStart(10)}  ${impact.padStart(8)}   ${route}`,
      );
    }
    await sleep(1200);
  }
}

main();
