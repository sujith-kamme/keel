import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import Link from "next/link";
import { BagLink } from "@/components/bag";
import { AISLES } from "@/lib/aisles";
import { currentCustomer } from "@/lib/customer";
import { customerName } from "@/lib/store-input";
import { signOut } from "./signin/actions";
import "./globals.css";

const fraunces = Fraunces({ variable: "--font-fraunces", subsets: ["latin"], axes: ["opsz"] });
const plexSans = IBM_Plex_Sans({ variable: "--font-plex-sans", subsets: ["latin"], weight: ["400", "500", "600"] });
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "Tidewell",
  description: "Rain-ready jackets, shoes and bottles.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const email = await currentCustomer();
  return (
    <html lang="en" className={`${fraunces.variable} ${plexSans.variable} ${plexMono.variable}`}>
      <body>
        <div className="shop">
          <div className="shop-bar">Free shipping over $50 · Returns within 30 days of delivery</div>
          <header className="shop-hd">
            <Link className="shop-logo" href="/">
              Tidewell
            </Link>
            <nav className="shop-nav" aria-label="Shop">
              {AISLES.map((a) => (
                <Link key={a.slug} href={`/?aisle=${a.slug}`}>
                  {a.label}
                </Link>
              ))}
            </nav>
            <div className="shop-acct">
              <Link href="/orders">Orders</Link>
              {email ? (
                <>
                  <span>Hi, {customerName(email)}</span>
                  <form action={signOut}>
                    <button type="submit" className="linkish">
                      Sign out
                    </button>
                  </form>
                </>
              ) : (
                <Link href="/signin">Sign in</Link>
              )}
              <BagLink />
            </div>
          </header>
          {children}
          <footer className="shop-ft">
            <span>© Tidewell</span>
            <Link href="/orders">Get help with an order</Link>
            <span style={{ marginLeft: "auto" }}>Payments by PayPal · sandbox</span>
          </footer>
        </div>
      </body>
    </html>
  );
}
