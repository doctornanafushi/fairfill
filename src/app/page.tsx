import Terminal from "@/components/Terminal";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Fair<span className="text-accent">Fill</span>
          </h1>
          <p className="mt-1 text-sm text-ink-2">
            Before you buy a tokenized stock, see what the AMM, True Markets Gateway and the real stock price say.
          </p>
        </div>
        <p className="text-xs text-ink-3">Solana · xStocks · Ondo Global Markets</p>
      </header>
      <Terminal />
      <footer className="mt-10 border-t border-border pt-4 text-xs leading-relaxed text-ink-3">
        Tokenized stocks are not offered to persons in the United States or the United Kingdom. FairFill shows quotes for
        information only and is not investment advice. Every trade moves real funds on-chain.
      </footer>
    </main>
  );
}
