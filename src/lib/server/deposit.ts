import "server-only";
import { ComputeBudgetProgram, Connection, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { USDC_MINT } from "./gateway";

const RPC = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

/**
 * 入金用の未署名トランザクション（USDC: ユーザーのウォレット → そのユーザーの Gateway ウォレット）を作る。
 * 受け取り側のトークンアカウントがなければ作る（費用はユーザー持ち、約 0.002 SOL）。
 * 署名と送信はブラウザの Phantom が行うので、サーバーは秘密鍵に一切触れない。
 */
export async function buildDepositTx(ownerPk: string, gatewayAddress: string, amountUsdc: number): Promise<string> {
  const conn = new Connection(RPC, "confirmed");
  const owner = new PublicKey(ownerPk);
  const dest = new PublicKey(gatewayAddress);
  const mint = new PublicKey(USDC_MINT);

  const fromAta = getAssociatedTokenAddressSync(mint, owner);
  const toAta = getAssociatedTokenAddressSync(mint, dest, true);
  const raw = BigInt(Math.round(amountUsdc * 1e6)); // USDC は 6 桁

  const ixs = [
    // 優先手数料なしの取引は混雑時に捨てられやすい。上限 6 万 CU × 単価で、費用は 0.00002 SOL 未満
    ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(process.env.PRIORITY_MICROLAMPORTS ?? 250_000) }),
    createAssociatedTokenAccountIdempotentInstruction(owner, toAta, dest, mint),
    createTransferCheckedInstruction(fromAta, mint, toAta, owner, raw, 6),
  ];
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({ payerKey: owner, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(msg).serialize()).toString("base64");
}

/**
 * ブラウザで署名済みの取引を、サーバーから送って着地を見届ける。
 * ブロックハッシュが有効なあいだ 2 秒ごとに再送し、confirmed になったら返す。
 * 失効したら「捨てられた（資金は動いていない）」として返す。
 */
export async function sendAndConfirm(signedB64: string): Promise<{ signature: string; landed: boolean; error?: string }> {
  const conn = new Connection(RPC, "confirmed");
  const raw = Buffer.from(signedB64, "base64");
  VersionedTransaction.deserialize(raw); // 形式チェック（壊れた入力なら例外）
  const { lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  let signature = "";
  try {
    signature = await conn.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 0 });
  } catch (e: any) {
    return { signature: "", landed: false, error: e?.message ?? "simulation failed" };
  }
  for (;;) {
    const st = (await conn.getSignatureStatuses([signature])).value[0];
    if (st?.err) return { signature, landed: false, error: JSON.stringify(st.err) };
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return { signature, landed: true };
    if ((await conn.getBlockHeight("confirmed")) > lastValidBlockHeight + 150) return { signature, landed: false, error: "expired" };
    await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 2000));
  }
}
