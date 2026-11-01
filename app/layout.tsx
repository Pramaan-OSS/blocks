import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ApprovalsBadge } from "@/components/pramaan/approvals/approvals-badge";
import { pramaanFonts } from "@/lib/pramaan/fonts";
import "./globals.css";

export const metadata: Metadata = { title: "Blocks demo" };

const link = "flex items-center gap-2 rounded text-[13px] font-medium text-muted-foreground hover:text-foreground";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={pramaanFonts}>
      <body>
        <header className="border-b">
          <nav aria-label="Main" className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 p-4">
            <span className="font-serif text-xl">Blocks demo</span>
            <a href="/" className={link}>
              Approvals <ApprovalsBadge />
            </a>
            <a href="/contacts" className={link}>Contacts</a>
            <a href="/pipeline" className={link}>Pipeline</a>
            <a href="/missions" className={link}>
              Missions
            </a>
            <a href="/assessment" className={link}>
              Assessments
            </a>
            <a href="/wallet" className={link}>
              Wallet
            </a>
            <a href="/connections" className={link}>
              Connections
            </a>
            <a href="/memory" className={link}>
              Memory
            </a>
            <a href="/picker" className={link}>
              Find an action
            </a>
            <a href="/consent" className={link}>
              Opt-outs
            </a>
            <a href="/activity" className={link}>
              Activity
            </a>
            <a href="/checkout" className={link}>
              Checkout
            </a>
            <a href="/payouts" className={link}>
              Payouts
            </a>
            <a href="/identity" className={link}>
              Identity
            </a>
            <a href="/chat" className={link}>
              Chat
            </a>
            <a href="/account" className={link}>
              Account
            </a>
            <a href="/password-reset" className={link}>Passwords</a>
            <a href="/subscriptions" className={link}>
              Subscriptions
            </a>
            <a href="/voice" className={link}>
              Phone
            </a>
            <a href="/booking" className={link}>
              Booking
            </a>
            <a href="/e-sign" className={link}>
              E-signature
            </a>
            <a href="/upload" className={link}>
              Upload
            </a>
          </nav>
        </header>
        <main className="mx-auto max-w-5xl p-4">{children}</main>
      </body>
    </html>
  );
}
