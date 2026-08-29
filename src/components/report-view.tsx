"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import type { ResearchEvidence, ResearchReport, ResearchSource } from "@/lib/domain/research";
import { readApiError } from "@/lib/http/client";
import { publicSourceHref, sourceDomain } from "@/lib/search/url";

import styles from "./report-view.module.css";

const reviewStatusCopy: Record<
  ResearchReport["reviewStatus"],
  { label: string; note: string | null }
> = {
  not_reviewed: { label: "已完成 · 未启用审核", note: null },
  passed: { label: "已完成 · 审核通过", note: null },
  revision_requested: {
    label: "已完成 · 仍有审核建议",
    note: "报告已生成，Reviewer 仍建议人工复核。",
  },
};

const INITIAL_VISIBLE_ITEMS = 3;

function CollapsibleReportList<T>({
  items,
  label,
  renderItem,
}: {
  items: T[];
  label: string;
  renderItem: (item: T, index: number) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const visibleItems = expanded ? items : items.slice(0, INITIAL_VISIBLE_ITEMS);
  const hiddenCount = Math.max(0, items.length - INITIAL_VISIBLE_ITEMS);

  return (
    <>
      <ol className={styles.sources}>{visibleItems.map(renderItem)}</ol>
      {hiddenCount > 0 ? (
        <button
          aria-expanded={expanded}
          className={styles.expandButton}
          onClick={() => setExpanded((current) => !current)}
          type="button"
        >
          {expanded ? `收起，仅显示前 ${INITIAL_VISIBLE_ITEMS} 条` : `展开其余 ${hiddenCount} 条`}
          <span aria-hidden="true">{expanded ? "↑" : "↓"}</span>
          <span className={styles.srOnly}>{label}</span>
        </button>
      ) : null}
    </>
  );
}

function ReportTableOfContents({
  products,
  showReview,
}: {
  products: string[];
  showReview: boolean;
}) {
  const sections = useMemo(() => [
    { id: "report-overview", label: "竞品概览" },
    { id: "report-dimensions", label: "分维度分析" },
    { id: "report-conclusion", label: "最终结论" },
    ...(showReview ? [{ id: "report-review", label: "人工确认" }] : []),
    { id: "report-sources", label: "资料索引" },
    { id: "report-evidence", label: "证据摘录" },
    { id: "report-limitations", label: "局限说明" },
  ], [showReview]);
  const [activeId, setActiveId] = useState(sections[0].id);

  useEffect(() => {
    function updateActiveSection() {
      let nextId = sections[0].id;
      for (const section of sections) {
        const element = document.getElementById(section.id);
        if (element && element.getBoundingClientRect().top <= 180) nextId = section.id;
      }
      setActiveId(nextId);
    }

    updateActiveSection();
    window.addEventListener("scroll", updateActiveSection, { passive: true });
    window.addEventListener("resize", updateActiveSection);
    return () => {
      window.removeEventListener("scroll", updateActiveSection);
      window.removeEventListener("resize", updateActiveSection);
    };
  }, [sections]);

  return (
    <nav aria-label="报告目录" className={styles.toc}>
      <span>报告目录</span>
      <ol>
        {sections.map((section) => (
          <li key={section.id}>
            <a aria-current={activeId === section.id ? "location" : undefined} href={`#${section.id}`}>
              {section.label}
            </a>
            {section.id === "report-overview" ? (
              <ol className={styles.tocProducts}>
                {products.map((product, index) => (
                  <li key={product}><a href={`#report-product-${index + 1}`}>{product}</a></li>
                ))}
              </ol>
            ) : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function BackToTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function updateVisibility() {
      setVisible(window.scrollY > window.innerHeight * 0.8);
    }

    updateVisibility();
    window.addEventListener("scroll", updateVisibility, { passive: true });
    window.addEventListener("resize", updateVisibility);
    return () => {
      window.removeEventListener("scroll", updateVisibility);
      window.removeEventListener("resize", updateVisibility);
    };
  }, []);

  return (
    <button
      aria-hidden={!visible}
      aria-label="回到顶部"
      className={styles.backToTop}
      data-visible={visible}
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      tabIndex={visible ? 0 : -1}
      type="button"
    >
      <span aria-hidden="true">↑</span>
      <small>顶部</small>
    </button>
  );
}

export function ReportView({ taskId }: { taskId: string }) {
  const [report, setReport] = useState<ResearchReport | null>(null);
  const [sources, setSources] = useState<ResearchSource[]>([]);
  const [evidence, setEvidence] = useState<ResearchEvidence[]>([]);
  const [reviewNotes, setReviewNotes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function loadReport() {
      try {
        const response = await fetch(`/api/report/${taskId}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(await readApiError(response));
        const data = (await response.json()) as {
          report: ResearchReport;
          sources?: ResearchSource[];
          evidence?: ResearchEvidence[];
          reviewNotes?: string[];
        };
        setReport(data.report);
        setSources(data.sources ?? []);
        setEvidence(data.evidence ?? []);
        setReviewNotes(data.reviewNotes ?? []);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : "读取报告失败");
        }
      }
    }
    void loadReport();
    return () => controller.abort();
  }, [taskId]);

  if (error) {
    return (
      <div className={`page-shell ${styles.statePage}`}>
        <div className="error-callout" role="alert">{error}</div>
        <Link className="button-secondary" href={`/research/${taskId}`}>返回执行记录</Link>
      </div>
    );
  }

  if (!report) {
    return <div className={`page-shell ${styles.statePage}`}>正在调阅报告档案…</div>;
  }

  return <ReportDocument report={report} sources={sources} evidence={evidence} reviewNotes={reviewNotes} taskId={taskId} />;
}

export function ReportDocument({
  report,
  sources,
  evidence = [],
  reviewNotes = [],
  taskId,
}: {
  report: ResearchReport;
  sources: ResearchSource[];
  evidence?: ResearchEvidence[];
  reviewNotes?: string[];
  taskId: string;
}) {
  const draft = report.structuredContent;
  const reviewCopy = reviewStatusCopy[report.reviewStatus];
  const showReview = report.reviewStatus === "revision_requested" && reviewNotes.length > 0;
  return (
    <article className={`page-shell ${styles.report}`}>
      <ReportTableOfContents products={draft.products.map((product) => product.name)} showReview={showReview} />
      <div className={styles.reportBody}>
      <header className={styles.hero} id="report-top">
        <div className={styles.meta}>
          <span>REPORT / REV {String(report.revision).padStart(2, "0")}</span>
          <span>{new Date(report.createdAt).toLocaleDateString("zh-CN")}</span>
          <span>{reviewCopy.label}</span>
        </div>
        <span className="eyebrow">Preliminary competitive brief</span>
        <h1>{draft.title}</h1>
        <p>{draft.executiveSummary}</p>
        <div className={styles.heroActions}>
          <Link className="button-secondary" href={`/research/${taskId}`}>查看执行记录</Link>
          <Link className="button-secondary" href="/">新建调研</Link>
        </div>
      </header>

      <section className={styles.section} id="report-overview">
        <div className={styles.sectionIndex}>01</div>
        <div>
          <span className={styles.kicker}>Competitive set</span>
          <h2>竞品概览</h2>
          <div className={styles.products}>
            {draft.products.map((product, index) => (
              <article className={styles.product} id={`report-product-${index + 1}`} key={product.name}>
                <span>{String.fromCharCode(65 + index)}</span>
                <h3>{product.name}</h3>
                <p className={styles.positioning}>{product.positioning}</p>
                <div className={styles.productFacts}>
                  <div>
                    <h4>优势</h4>
                    <ul>{product.strengths.map((item) => <li key={item}>{item}</li>)}</ul>
                  </div>
                  <div>
                    <h4>局限</h4>
                    <ul>{product.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
                  </div>
                </div>
                <div className={styles.bestFor}><strong>适用</strong>{product.bestFor}</div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.section} id="report-dimensions">
        <div className={styles.sectionIndex}>02</div>
        <div>
          <span className={styles.kicker}>Comparison dimensions</span>
          <h2>分维度分析</h2>
          <div className={styles.dimensions}>
            {draft.dimensions.map((dimension, index) => (
              <article key={dimension.name}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{dimension.name}</h3>
                  <p>{dimension.summary}</p>
                  <small>表现突出：{dimension.leaders.join("、") || "暂无结论"}</small>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.conclusion}`} id="report-conclusion">
        <div className={styles.sectionIndex}>03</div>
        <div>
          <span className={styles.kicker}>Decision note</span>
          <h2>最终结论</h2>
          <blockquote>{draft.conclusion}</blockquote>
          <div className={styles.products}>
            {draft.products.map((product, index) => (
              <article className={styles.product} key={`verdict-${product.name}`}>
                <span>{String.fromCharCode(65 + index)}</span>
                <h3>{product.name}</h3>
                <p className={styles.positioning}>{product.positioning}</p>
                <div className={styles.bestFor}><strong>适合</strong>{product.bestFor}</div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {showReview ? (
        <section className={styles.reviewSection} aria-label="Reviewer 建议人工确认的内容" id="report-review">
          <span className={styles.kicker}>Review note / Reviewer</span>
          <h2>建议人工确认</h2>
          {reviewCopy.note ? <p>{reviewCopy.note}</p> : null}
          <ol>{reviewNotes.map((note) => <li key={note}>{note}</li>)}</ol>
        </section>
      ) : null}

      <section className={styles.section} id="report-sources">
        <div className={styles.sectionIndex}>04</div>
        <div>
          <span className={styles.kicker}>Source catalog</span>
          <h2>资料索引</h2>
          {sources.length === 0 ? (
            <p className={styles.emptySources}>本次任务没有保存公开搜索来源。未启用联网搜索时，报告只用于验证流程和展示结构。</p>
          ) : (
            <CollapsibleReportList
              items={sources}
              label="资料索引"
              renderItem={(source, index) => {
                const href = publicSourceHref(source.url);
                const domain = sourceDomain(source.canonicalUrl || source.url);
                return (
                  <li className={styles.source} key={source.id}>
                    <span className={styles.sourceIndex}>{`[S${index + 1}]`}</span>
                    <div className={styles.sourceBody}>
                      <small>{source.product}</small>
                      <h3>{source.title}</h3>
                      {href ? (
                        <a href={href} rel="noopener noreferrer" target="_blank">
                          <span className={styles.sourceDomain}>{domain}</span>
                          <span className={styles.sourceUrl}>{href}</span>
                        </a>
                      ) : (
                        <p className={styles.sourceUrl}>{source.url}</p>
                      )}
                    </div>
                  </li>
                );
              }}
            />
          )}
        </div>
      </section>

      <section className={styles.section} id="report-evidence">
        <div className={styles.sectionIndex}>05</div>
        <div>
          <span className={styles.kicker}>Evidence excerpts</span>
          <h2>证据摘录</h2>
          {evidence.length === 0 ? (
            <p className={styles.emptySources}>
              {sources.length === 0
                ? "未启用联网搜索时不会抽取页面证据；这不是数据读取失败。"
                : "本次任务没有抽出页面证据。"}
            </p>
          ) : (
            <CollapsibleReportList
              items={evidence}
              label="证据摘录"
              renderItem={(item, index) => {
                const source = sources.find((entry) => entry.id === item.sourceId);
                const href = source ? publicSourceHref(source.url) : null;
                const domain = source ? sourceDomain(source.canonicalUrl || source.url) : "";
                return (
                  <li className={styles.source} key={item.id}>
                    <span className={styles.sourceIndex}>{`[E${index + 1}]`}</span>
                    <div className={styles.sourceBody}>
                      <small>{item.product} · {item.dimension}</small>
                      <p className={styles.evidenceQuote}>{item.evidenceText}</p>
                      {href ? (
                        <a href={href} rel="noopener noreferrer" target="_blank">
                          <span className={styles.sourceDomain}>{domain}</span>
                          <span className={styles.sourceUrl}>{href}</span>
                        </a>
                      ) : source ? (
                        <p className={styles.sourceUrl}>{source.url}</p>
                      ) : null}
                    </div>
                  </li>
                );
              }}
            />
          )}
        </div>
      </section>

      <section className={styles.limitations} id="report-limitations">
        <span>
          {evidence.length > 0
            ? "证据状态 / 已读取页面正文"
            : sources.length > 0
              ? "证据状态 / 仅使用搜索摘要"
              : "证据状态 / 未启用联网搜索"}
        </span>
        <div>
          <h2>局限与来源说明</h2>
          <ul>{draft.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      </section>
      </div>
      <BackToTopButton />
    </article>
  );
}
