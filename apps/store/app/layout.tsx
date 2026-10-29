import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Harbor & Pine Outfitters",
  description: "Support chat",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full">
        <main className="mx-auto w-full max-w-2xl p-8">
          <h1 className="text-2xl font-semibold">Harbor &amp; Pine Outfitters</h1>
          <p className="mb-6 text-sm text-black/60 dark:text-white/60">Support chat</p>
          {children}
        </main>
      </body>
    </html>
  );
}
