import { ResearchProgress } from "@/components/research-progress";

import styles from "./page.module.css";

interface ResearchPageProps {
  params: Promise<{ id: string }>;
}

export default async function ResearchPage({ params }: ResearchPageProps) {
  const { id } = await params;
  return (
    <div className={`page-shell ${styles.page}`}>
      <header className={styles.header}>
        <div>
          <span className="eyebrow">Live research ledger</span>
          <h1>调研正在形成。</h1>
        </div>
        <p>
          页面只读取持久化状态；关闭或刷新不会中断后台任务。你可以随时回来查看搜索、证据分析、报告生成与审核进度。
        </p>
      </header>
      <ResearchProgress taskId={id} />
    </div>
  );
}
