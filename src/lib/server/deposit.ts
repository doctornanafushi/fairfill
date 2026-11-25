import "server-only";
import { Connection, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
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
    createAssociatedTokenAccountIdempotentInstruction(owner, toAta, dest, mint),
    createTransferCheckedInstruction(fromAta, mint, toAta, owner, raw, 6),
  ];
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({ payerKey: owner, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(msg).serialize()).toString("base64");
}
