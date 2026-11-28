import Link from "next/link";
import SharedReport from "@/components/SharedReport";

export const metadata = { title: "Best execution report — FairFill" };

export default function ReportPage() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-8">
      <header className="mb-6">
        <Link href="/" className="text-2xl font-semibold tracking-tight">
          Fair<span className="text-accent">Fill</span>
        </Link>
        <p className="mt-1 text-sm text-ink-2">A shareable record of how a tokenized-stock order was filled versus every alternative.</p>
      </header>
      <SharedReport />
    </main>
  );
}
