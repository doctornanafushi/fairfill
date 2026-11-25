import "server-only";
import { readFileSync } from "node:fs";
import { ApiKeyStamper } from "@turnkey/api-key-stamper";

/**
 * 署名鍵（P-256）。ユーザーのウォレット取引を承認する鍵で、ユーザー作成時に公開鍵を登録する。
 * quickstart が作った signer-key.json（signer_public_key / signer_private_key、hex）をそのまま使う。
 * Vercel では TM_SIGNER_KEY_JSON（中身）、手元では TM_SIGNER_KEY_FILE（パス）。
 * 各取引は「この署名鍵」と「True Markets」の二重承認が要り、どちらか一方だけでは資金は動かない。
 */
type SignerFile = { signer_public_key: string; signer_private_key: string };
let signer: SignerFile | null = null;
let stamper: ApiKeyStamper | null = null;

function load(): SignerFile {
  if (signer) return signer;
  const raw =
    process.env.TM_SIGNER_KEY_JSON ??
    (process.env.TM_SIGNER_KEY_FILE ? readFileSync(process.env.TM_SIGNER_KEY_FILE, "utf8") : null);
  if (!raw) throw new Error("TM_SIGNER_KEY_JSON or TM_SIGNER_KEY_FILE is not set");
  signer = JSON.parse(raw) as SignerFile;
  return signer;
}

export const signerPublicKey = () => load().signer_public_key;

/** Gateway が返した未署名ペイロードを、そのまま（パースせず）署名してスタンプを返す */
export async function stamp(payload: string): Promise<string> {
  const s = load();
  stamper ??= new ApiKeyStamper({ apiPublicKey: s.signer_public_key, apiPrivateKey: s.signer_private_key });
  return (await stamper.stamp(payload)).stampHeaderValue;
}
