import Link from "next/link";
import styles from "./marketing.module.css";

function MoonMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <circle
        cx="11"
        cy="11"
        r="9.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path d="M11 1.5a9.5 9.5 0 0 1 0 19z" fill="currentColor" />
    </svg>
  );
}

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={styles.page}>
      <a className={styles.skip} href="#main">
        Skip to main content
      </a>
      <div className={styles.wrap}>
        <header className={styles.header}>
          <Link href="/" className={styles.brand}>
            <MoonMark />
            <span>LunarSprints</span>
          </Link>
          <nav aria-label="Main" className={styles.nav}>
            <Link href="/#how">How it works</Link>
            <Link href="/#pricing">Pricing</Link>
            <Link href="/app">Sign in</Link>
            <Link href="/app" className={styles.navCta}>
              Start free
            </Link>
          </nav>
        </header>
        <main id="main">{children}</main>
        <footer className={styles.footer}>
          <span>
            A{" "}
            <a href="https://neorishi.io" rel="noopener">
              NeoRishi
            </a>{" "}
            product
          </span>
          <nav aria-label="Legal" className={styles.footerNav}>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/refunds">Refunds</Link>
            <Link href="/contact">Contact</Link>
          </nav>
        </footer>
      </div>
    </div>
  );
}
