import { ResearchForm } from "@/components/research-form";

import styles from "./page.module.css";

const workflow = ["Plan", "Research", "Extract", "Analyze", "Write", "Review"];

export default function HomePage() {
  return (
    <div className={`page-shell ${styles.page}`}>
      <section className={styles.hero}>
        <div className={styles.intro}>
          <span className="eyebrow">Competitive intelligence / evidence grounded</span>
          <h1 className="display-title">把竞品研究变成一条可检查的证据链。</h1>
          <p className="lead">
            从一个问题开始，留下每一步状态。系统会规划分析维度、搜索公开资料、读取页面并抽取证据，再完成横向分析、报告生成与审核。
          </p>
          <div className={styles.workflow} aria-label="完整研究工作流">
            {workflow.map((step, index) => (
              <div className={styles.workflowItem} key={step}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{step}</strong>
              </div>
            ))}
          </div>
        </div>
        <ResearchForm />
      </section>

      <section className={styles.notes} aria-label="当前版本说明">
        <article>
          <span>01 / Durable state</span>
          <h2>刷新页面，不丢进度</h2>
          <p>任务、执行批次、步骤和报告由 PostgreSQL 分层保存，Web 与 Worker 各司其职。</p>
        </article>
        <article>
          <span>02 / Typed output</span>
          <h2>先校验，再写报告</h2>
          <p>模型输出必须通过 Zod，并完整覆盖用户提交的竞品，才允许进入最终报告。</p>
        </article>
        <article>
          <span>03 / Grounded evidence</span>
          <h2>结论可以回到原始页面</h2>
          <p>来源与原子证据分开保存；资料不足时明确保留缺口，不用未经验证的内容补齐结论。</p>
        </article>
      </section>
    </div>
  );
}
