import Link from "next/link";

import styles from "./site-header.module.css";

export function SiteHeader() {
  return (
    <header className={styles.header}>
      <Link className={styles.brand} href="/" aria-label="Competitor Research Agent 首页">
        <span className={styles.mark}>C/R</span>
        <span>Competitor Research Agent</span>
      </Link>
      <nav className={styles.nav} aria-label="主导航">
        <Link href="/">新建调研</Link>
        <Link href="/history">历史档案</Link>
      </nav>
      <span className={styles.edition}>DEMO</span>
    </header>
  );
}
