import { connection } from "next/server";
import { issueNonce } from "@/lib/server/session";

export async function GET() {
  await connection();
  return Response.json({ nonce: issueNonce(), issuedAt: new Date().toISOString() });
}
