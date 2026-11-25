"use client";

import { useCallback, useEffect, useState } from "react";
import { VersionedTransaction } from "@solana/web3.js";

// Phantom（window.phantom.solana）の最小限の型
type Provider = {
  publicKey?: { toString(): string };
  connect(): Promise<{ publicKey: { toString(): string } }>;
  disconnect(): Promise<void>;
  signMessage(msg: Uint8Array, display?: string): Promise<{ signature: Uint8Array }>;
  signAndSendTransaction(tx: VersionedTransaction): Promise<{ signature: string }>;
};
const provider = (): Provider | null =>
  (typeof window !== "undefined" && ((window as any).phantom?.solana ?? (window as any).solana)) || null;

const toB64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

export type Me = {
  wallet: string;
  userId: string;
  depositAddress: string | null;
  usdc: number;
  balances: { symbol: string; amount: number; chain: string }[];
};

export function useWallet() {
  const [me, setMe] = useState<Me | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<Me | null> => {
    const r = await fetch("/api/me");
    if (r.status === 401) {
      setMe(null);
      return null;
    }
    const j = await r.json();
    if (!r.ok) {
      setError(j.error);
      return null;
    }
    setMe(j);
    return j as Me;
  }, []);

  // 初回表示時に、すでにログイン済みなら状態を復元する
  useEffect(() => {
    let alive = true;
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => alive && j && setMe(j))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  async function signIn() {
    const p = provider();
    if (!p) return setError("Phantom wallet not found. Install it from phantom.com and reload.");
    setError(null);
    try {
      setBusy("Connecting…");
      const { publicKey } = await p.connect();
      const pk = publicKey.toString();
      setBusy("Sign the message in Phantom…");
      const { nonce, issuedAt } = await (await fetch("/api/auth/nonce")).json();
      // サーバーの loginMessage() と一字一句同じ文面に署名する
      const message = [
        // 「〜 wants you to sign in with your Solana account:」で始めると、Phantom が SIWS 形式として
        // 厳密に検査し、ドメインなどが足りないと「invalid formatting」で拒否する。普通の文面にする
        "Sign in to FairFill",
        "",
        `Wallet: ${pk}`,
        "",
        "Signing proves you own this wallet. It does not send a transaction or cost any fees.",
        "",
        `Nonce: ${nonce}`,
        `Issued At: ${issuedAt}`,
      ].join("\n");
      const { signature } = await p.signMessage(new TextEncoder().encode(message), "utf8");
      const v = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicKey: pk, message, signature: toB64(signature) }),
      });
      if (!v.ok) throw new Error((await v.json()).error);
      setBusy("Setting up your Gateway wallet…");
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? "Sign-in failed");
    } finally {
      setBusy(null);
    }
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    await provider()?.disconnect().catch(() => {});
    setMe(null);
  }

  async function deposit(amount: number): Promise<string | null> {
    const p = provider();
    if (!p) return null;
    setError(null);
    try {
      setBusy("Building the deposit transaction…");
      const r = await fetch("/api/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setBusy("Approve the transfer in Phantom…");
      const tx = VersionedTransaction.deserialize(fromB64(j.transaction));
      const { signature } = await p.signAndSendTransaction(tx);
      setBusy("Waiting for the deposit to land…");
      const before = me?.usdc ?? 0;
      for (let i = 0; i < 20; i++) {
        await new Promise((res) => setTimeout(res, 3000));
        const now = await refresh();
        if (now && now.usdc > before) break; // 残高に反映されたら終了
      }
      return signature;
    } catch (e: any) {
      setError(e?.message ?? "Deposit failed");
      return null;
    } finally {
      setBusy(null);
    }
  }

  return { me, busy, error, setError, signIn, signOut, deposit, refresh };
}

export function WalletPanel({ w }: { w: ReturnType<typeof useWallet> }) {
  const [amount, setAmount] = useState(2);
  const [lastTx, setLastTx] = useState<string | null>(null);

  if (!w.me) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-1 p-4">
        <p className="text-sm text-ink-2">
          Connect a Solana wallet to buy through True Markets Gateway. Signing in is a free message signature.
        </p>
        <button
          onClick={w.signIn}
          disabled={!!w.busy}
          className="rounded-lg border border-accent px-4 py-2 text-sm text-ink hover:bg-accent/10 disabled:opacity-50"
        >
          {w.busy ?? "Connect Phantom"}
        </button>
        {w.error && <p className="w-full text-sm text-crit">⛔ {w.error}</p>}
      </div>
    );
  }

  const me = w.me;
  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface-1 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <span className="text-ink-3">Wallet </span>
          <span className="num">{short(me.wallet)}</span>
          <span className="mx-2 text-ink-3">·</span>
          <span className="text-ink-3">Gateway balance </span>
          <span className="num text-ink">{me.usdc.toFixed(2)} USDC</span>
          {me.balances
            .filter((b) => b.symbol.toUpperCase() !== "USDC")
            .map((b) => (
              <span key={b.symbol + b.chain} className="num ml-3 text-ink-2">
                {b.amount.toFixed(6)} {b.symbol}
              </span>
            ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => w.refresh()} className="rounded-md border border-border px-2.5 py-1 text-xs text-ink-2 hover:text-ink">
            Refresh
          </button>
          <button onClick={w.signOut} className="rounded-md border border-border px-2.5 py-1 text-xs text-ink-2 hover:text-ink">
            Sign out
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-ink-3">Deposit USDC to your Gateway wallet</span>
        {me.depositAddress && <span className="num text-xs text-ink-3">({short(me.depositAddress)})</span>}
        <input
          type="number"
          min={0.1}
          step={0.1}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          className="num w-24 rounded-md border border-border bg-surface-2 px-2 py-1 outline-none focus:border-accent"
          aria-label="Deposit amount"
        />
        <button
          onClick={async () => setLastTx(await w.deposit(amount))}
          disabled={!!w.busy || !me.depositAddress}
          className="rounded-md bg-accent px-3 py-1.5 text-white disabled:opacity-50"
        >
          {w.busy ?? "Deposit"}
        </button>
        {lastTx && (
          <a
            className="text-xs text-accent underline"
            href={`https://solscan.io/tx/${lastTx}`}
            target="_blank"
            rel="noreferrer"
          >
            View transaction
          </a>
        )}
      </div>
      <p className="text-xs text-ink-3">
        Your Gateway wallet needs two approvals to move funds — FairFill&apos;s signer and True Markets — so neither side can
        move it alone.
      </p>
      {w.error && <p className="text-sm text-crit">⛔ {w.error}</p>}
    </div>
  );
}
