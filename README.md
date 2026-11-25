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

## Buying through Gateway

1. **Sign in with Solana** — the wallet signs a one-time message (no transaction, no fee). The server verifies the
   ed25519 signature against an HMAC-protected nonce and sets an HTTP-only session cookie.
2. **One Gateway user per wallet** — the wallet address is the `external_ref_id`, so each user gets their own Gateway
   Solana wallet (idempotent).
3. **Deposit** — the server builds an unsigned USDC `transferChecked` transaction; Phantom signs and sends it. The
   server never touches the user's keys.
4. **Buy with a last-second guard** — FairFill creates the Gateway order, re-checks the live quote against the
   oracle price (per share, multiplier-adjusted) and **refuses to sign** if it is ≥ 10% off. In our tests Gateway itself
   once quoted a $1,000 AAOIx order at $335,879 per share; this guard is what stops that from being executed.
5. Every wallet transaction needs two approvals — FairFill's signer key and True Markets — so neither can move funds alone.

When the AMM is the cheapest fair option, FairFill links to Jupiter instead of pretending Gateway is better.

## Run locally

```bash
cp .env.example .env.local   # fill in the values
npm install
npm run dev                  # http://localhost:3000
```

## Notes

- The compare and curve endpoints only quote; orders are executed only from `/api/buy` after the user confirms.
- Token amounts are converted to shares with the on-chain Token-2022 `ScaledUiAmount` multiplier (dividends, splits).
- Gateway charges a flat 0.5% fee and pays network fees; prices shown include fees.
- Finnhub's free tier is for non-commercial use; production should use a paid oracle (e.g. Pyth Pro).
