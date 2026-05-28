import "./globals.css";
import Link from "next/link";
import { Cormorant_Garamond, IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";

const display = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});
const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata = {
  title: "Auto Job Applier — Shivanshu",
  description: "AI-tailored resumes and cover letters per posting.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen">
        <div className="relative grid min-h-screen grid-cols-[260px_1fr]">
          {/* sidebar */}
          <aside className="glow-corner sticky top-0 z-10 flex h-screen flex-col justify-between border-r border-[var(--line-soft)] bg-[var(--ink-0)] px-7 py-8">
            <div className="relative z-10">
              {/* brand */}
              <Link href="/" className="block">
                <div className="mono-label mb-2">edition · 01</div>
                <div className="font-display text-3xl leading-[0.9] tracking-tight">
                  Auto<br />
                  <span className="italic text-[var(--violet)]">Applier</span>
                </div>
                <div className="mono-label mt-3">by shivanshu</div>
              </Link>

              <div className="hairline my-8" />

              {/* nav */}
              <nav className="space-y-3">
                <Link href="/" className="group flex items-baseline justify-between">
                  <span className="font-display text-2xl italic transition-colors group-hover:text-[var(--violet)]">
                    Tracker
                  </span>
                  <span className="mono-label">01</span>
                </Link>
                <Link href="/runs" className="group flex items-baseline justify-between">
                  <span className="font-display text-2xl italic transition-colors group-hover:text-[var(--violet)]">
                    Runs
                  </span>
                  <span className="mono-label">02</span>
                </Link>
              </nav>
            </div>

            {/* footer / status */}
            <div className="relative z-10">
              <div className="hairline mb-4" />
              <div className="space-y-1">
                <div className="mono-label">model</div>
                <div className="font-mono text-[11px] text-[var(--paper-2)]">claude-sonnet-4-6</div>
                <div className="mono-label mt-3">via</div>
                <div className="font-mono text-[11px] text-[var(--paper-2)]">aws bedrock</div>
              </div>
            </div>
          </aside>

          {/* canvas */}
          <main className="relative px-12 py-10">{children}</main>
        </div>
      </body>
    </html>
  );
}
