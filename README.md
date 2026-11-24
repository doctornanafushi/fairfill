# FairFill — fair prices for tokenized stocks

Tokenized stocks on Solana (xStocks, Ondo Global Markets) trade 24/7, but almost all of them
have little or no AMM liquidity. Of the 1,966 tokenized stocks Gateway lists on Solana, only
~50 had more than $1,000 of DEX liquidity in our scan, and even a $50 swap through a thin pool
paid up to 24% over the real share price.

FairFill answers one question before a user buys: **what is the fairest way to buy this stock right now?**

For a ticker and an amount it asks, at the same moment:

- **the AMM** (Jupiter aggregator quote),
- **True Markets Gateway** (order quote — never executed),
- **the real stock price** (oracle: Pyth if available, Finnhub otherwise),

for every token that represents the stock (e.g. `AAPLX` and `AAPLON`), and shows how much each
option overpays versus the reference price, recommends the cheapest fair option and blocks
quotes that are far off (⛔ ≥ 10%).

## Price curve and the theory behind it

FairFill samples each option at 7 order sizes ($10 → $10,000) and fits `p(Δ) = α + βΔ`.
For a constant-product pool `x·y = k` (USDC reserve Y, stock reserve X, fee factor γ),
spending Δ USDC yields `XγΔ/(Y+γΔ)` tokens, so the average price is `p₀/γ + Δ/X` — exactly
linear in Δ. α is the fee-inclusive marginal price and α/β ≈ Y/γ estimates the pool depth.
Concentrated-liquidity pools behave like a CPMM with virtual reserves inside their active
range, so a drop in R² reveals where the order walks out of the range. Gateway quotes stay
flat (β ≈ 0), and the intersection of the two lines is the order size above which Gateway wins.

## Run locally

```bash
cp .env.example .env.local   # fill in the values
npm install
npm run dev                  # http://localhost:3000
```

## Notes

- Quotes only — the compare and curve endpoints never execute an order.
- Gateway charges a flat 0.5% fee and pays network fees; prices shown include fees.
- Finnhub's free tier is for non-commercial use; production should use a paid oracle (e.g. Pyth Pro).
