import { HistoryList } from "@/components/history-list";

import styles from "./page.module.css";

export default function HistoryPage() {
  return (
    <div className={`page-shell ${styles.page}`}>
      <header className={styles.header}>
        <span className="eyebrow">Research archive</span>
        <h1>历史档案</h1>
        <p>按创建时间排列的任务、执行状态与报告入口，默认读取最近 30 条记录。</p>
      </header>
      <HistoryList />
    </div>
  );
}
