// クライアントとサーバーで共有する型

export type Venue = "Jupiter" | "Gateway";
export type Verdict = "good" | "caution" | "danger" | "unknown";

export type Reference = {
  price: number;
  source: "pyth" | "finnhub" | "median";
  label: string; // 表示用（例: "Finnhub AAPL"）
  ageSec: number | null;
  stale: boolean; // 古い（市場時間外など）
};

export type TokenInfo = {
  symbol: string; // 例: AAPLX
  issuer: string; // xstocks / ondo
  assetId: string; // Gateway の asset id
  mint: string; // Solana のミント
  decimals: number;
  name: string;
  multiplier: number; // 1トークン = 何株か（Token-2022 ScaledUiAmount。読めなければ 1）
};

export type QuoteOption = {
  token: TokenInfo;
  venue: Venue;
  amountUsdc: number;
  qtyOut: number | null; // 受け取れるトークン量（生の数量）
  shares: number | null; // 株数に換算した量 = qtyOut × multiplier
  price: number | null; // 1株あたりの実効価格（手数料込み、倍率で換算済み）
  overpayPct: number | null; // 基準価格に対する払いすぎ率
  verdict: Verdict;
  route: string; // Jupiter の経路など
  error?: string;
};

export type CompareResult = {
  ticker: string;
  amountUsdc: number;
  reference: Reference | null;
  options: QuoteOption[];
  best: QuoteOption | null;
  savedVsWorstUsd: number | null;
  warnings: string[];
  thresholds: { warnPct: number; dangerPct: number };
  fetchedAt: string;
};

export type CurvePoint = { amountUsdc: number; price: number | null; overpayPct: number | null }; // price は1株あたり

// 実効価格 p(Δ) = α + βΔ の当てはめ（CPMM 近似）
export type LinearFit = {
  alpha: number; // Δ→0 での価格（手数料・スプレッド込みの切片）
  beta: number; // 傾き（1USDC あたりの価格上昇）
  depthUsdc: number | null; // α/β：CPMM なら USDC 側の準備金 Y に相当
  r2: number | null;
  used: number; // 当てはめに使った点の数
};

export type CurveSeries = {
  key: string; // 例: "AAPLX·Jupiter"
  token: TokenInfo;
  venue: Venue;
  points: CurvePoint[];
  fit: LinearFit | null;
};

export type Crossover = {
  token: string;
  // この金額を超えると Gateway の方が安くなる（null: 範囲内で交差しない）
  breakEvenUsdc: number | null;
  note: string;
};

export type CurveResult = {
  ticker: string;
  reference: Reference | null;
  sizes: number[];
  series: CurveSeries[];
  crossovers: Crossover[];
  fetchedAt: string;
};

// 最良執行レポート：購入の直前に取った全選択肢のスナップショットと、実際の約定を並べたもの
export type ReportOption = {
  symbol: string;
  issuer: string;
  venue: Venue;
  pricePerShare: number | null;
  overpayPct: number | null;
  verdict: Verdict;
  executed: boolean; // 実際に執行した選択肢
};

export type ExecutionReport = {
  version: 1;
  orderId: string;
  status: string;
  executedAt: string; // ISO
  wallet: string;
  gatewayWallet: string | null;
  ticker: string;
  token: { symbol: string; issuer: string; multiplier: number };
  venue: "Gateway";
  amountUsdc: number;
  tokensReceived: number;
  sharesReceived: number;
  fillPricePerShare: number;
  reference: { price: number; label: string; stale: boolean } | null;
  fillVsReferencePct: number | null;
  guard: { checked: boolean; thresholdPct: number };
  options: ReportOption[]; // 執行直前の全選択肢（安い順）
  worst: { symbol: string; venue: Venue; pricePerShare: number } | null;
  savedVsWorstUsd: number | null; // 最悪の選択肢で同額を買った場合と比べて得した金額
  savedVsWorstPct: number | null; // その割合（= 1 − 約定価格 / 最悪の価格）
  nextBest: { symbol: string; venue: Venue; pricePerShare: number } | null;
  diffVsNextBestPct: number | null; // 次善の選択肢との差（プラスなら約定の方が安い）
};
