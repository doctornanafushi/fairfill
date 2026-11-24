import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FairFill — fair prices for tokenized stocks",
  description:
    "Compare AMM, True Markets Gateway and the real stock price before you buy a tokenized stock on Solana.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
