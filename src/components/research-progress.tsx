"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { AdminPasswordDialog } from "@/components/admin-password-dialog";
import type { ResearchStep, ResearchTaskDetail, StepType, TaskStatus } from "@/lib/domain/research";
import { readApiError } from "@/lib/http/client";

import styles from "./research-progress.module.css";

const statusLabels: Record<TaskStatus, string> = {
  queued: "等待 Worker",
  running: "正在执行",
  completed: "已完成",
  failed: "执行失败",
  cancelled: "已取消",
};

type PhaseState = "pending" | "active" | "completed" | "failed";

function latestStep(steps: ResearchStep[], type: StepType): ResearchStep | undefined {
  return [...steps].reverse().find((step) => step.stepType === type);
}

function stepPhaseState(steps: ResearchStep[], type: StepType, status: TaskStatus): PhaseState {
  const step = latestStep(steps, type);
  if (step?.status === "completed") return "completed";
  if (step?.status === "failed") return "failed";
  if (step?.status === "running") return "active";
  if (status === "completed") return "completed";
  return "pending";
}

function phaseState(
  status: TaskStatus,
  phase: "queued" | "planning" | "researching" | "extracting" | "gap_filling" | "analyzing" | "generating" | "reviewing" | "report",
  steps: ResearchStep[],
): PhaseState {
  if (status === "cancelled") return "pending";
  if (phase === "queued") return status === "queued" ? "active" : "completed";
  if (phase === "report") return status === "completed" ? "completed" : "pending";
  if (phase === "planning" || phase === "researching" || phase === "extracting" || phase === "gap_filling" || phase === "analyzing" || phase === "generating" || phase === "reviewing") {
    const state = stepPhaseState(steps, phase, status);
    if (state !== "pending") return state;
    if (status === "failed" && phase === "generating" && !latestStep(steps, "researching") && !latestStep(steps, "extracting")) {
      return "failed";
    }
    return state;
  }
  return "pending";
}

function phaseMark(state: PhaseState): string {
  if (state === "completed") return "✓";
  if (state === "active") return "●";
  if (state === "failed") return "!";
  return "○";
}

export function ResearchProgress({ taskId }: { taskId: string }) {
  const [detail, setDetail] = useState<ResearchTaskDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [showAdminDialog, setShowAdminDialog] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const response = await fetch(`/api/research/${taskId}`, { cache: "no-store" });
        if (!response.ok) throw new Error(await readApiError(response));
        const nextDetail = (await response.json()) as ResearchTaskDetail;
        if (cancelled) return;
        setDetail(nextDetail);
        setError(null);
        if (nextDetail.task.status === "queued" || nextDetail.task.status === "running") {
          timer = setTimeout(poll, 1500);
        }
      } catch (pollError) {
        if (!cancelled) setError(pollError instanceof Error ? pollError.message : "读取状态失败");
      }
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [taskId]);

  async function retry() {
    setRetrying(true);
    setError(null);
    try {
      const response = await fetch(`/api/research/${taskId}/run`, { method: "POST" });
      if (response.status === 401) {
        setRetrying(false);
        setShowAdminDialog(true);
        return;
      }
      if (!response.ok) throw new Error(await readApiError(response));
      window.location.reload();
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "重新入队失败");
      setRetrying(false);
    }
  }

  if (!detail && !error) {
    return <div className={`${styles.loading} panel`}>正在读取持久化状态…</div>;
  }

  if (!detail) {
    return <div className="error-callout" role="alert">{error}</div>;
  }

  const { task, steps, sourceCount } = detail;
  const hasExtracting = steps.some((step) => step.stepType === "planning" || step.stepType === "extracting" || step.stepType === "researching");
  const hasReviewing = steps.some((step) => step.stepType === "reviewing");
  const phases = hasExtracting
    ? [
        { key: "queued" as const, title: "任务进入持久化队列", note: "Web 请求已经结束，执行权交给 Worker。" },
        { key: "planning" as const, title: "规划分析维度与搜索词", note: "按主题生成共享分析维度，并为每个竞品确定一条搜索词。" },
        { key: "researching" as const, title: "搜索公开资料", note: "每个竞品执行一次有界搜索，并保存去重后的 Sources。" },
        { key: "extracting" as const, title: "读取页面并抽取证据", note: "每竞品最多读取两页，抽取原子 Evidence 后再生成报告。" },
        ...(steps.some((step) => step.stepType === "gap_filling")
          ? [{ key: "gap_filling" as const, title: "补全证据缺口", note: "按固定预算定向补搜、读取并补抽最多三个证据空格。" }]
          : []),
        { key: "analyzing" as const, title: "执行横向证据分析", note: "按规划维度覆盖全部竞品，并明确标记 Evidence 缺口。" },
        { key: "generating" as const, title: "生成并校验结构化报告", note: "Provider 只能使用已保存证据，并完整覆盖所有竞品。" },
        ...(hasReviewing
          ? [{ key: "reviewing" as const, title: "审核报告", note: "检查竞品覆盖、无来源结论和结构完整性，必要时要求修改。" }]
          : []),
        { key: "report" as const, title: "保存最终报告", note: "报告、步骤和任务状态在一次数据库流程中完成。" },
      ]
    : [
        { key: "queued" as const, title: "任务进入持久化队列", note: "Web 请求已经结束，执行权交给 Worker。" },
        { key: "generating" as const, title: "生成并校验结构化报告", note: "Provider 输出必须通过 Zod，并完整覆盖所有竞品。" },
        ...(hasReviewing
          ? [{ key: "reviewing" as const, title: "审核报告", note: "检查竞品覆盖、无来源结论和结构完整性，必要时要求修改。" }]
          : []),
        { key: "report" as const, title: "保存最终报告", note: "报告、步骤和任务状态在一次数据库流程中完成。" },
      ];
  const stage = steps.some((step) => step.stepType === "analyzing")
    ? "完整调研"
    : steps.some((step) => step.stepType === "planning")
      ? "动态规划"
    : steps.some((step) => step.stepType === "extracting")
      ? "证据分析"
    : steps.some((step) => step.stepType === "researching") || sourceCount > 0
      ? "联网搜索"
      : "基础生成";

  return (
    <section className={`${styles.ledger} panel`}>
      <div className={styles.summary}>
        <div>
          <span className={styles.label}>Research topic</span>
          <h2>{task.topic}</h2>
          <div className={styles.tags}>
            {task.competitors.map((competitor) => <span key={competitor}>{competitor}</span>)}
          </div>
        </div>
        <div className={styles.statusBlock} data-status={task.status}>
          <span className={styles.pulse} aria-hidden="true" />
          <strong>{statusLabels[task.status]}</strong>
          <small>{task.id.slice(0, 8).toUpperCase()}</small>
        </div>
      </div>

      <div className={styles.stats}>
        <div><span>执行步骤</span><strong>{steps.length}</strong></div>
        <div><span>资料来源</span><strong>{sourceCount}</strong></div>
        <div>
          <span>调研模式</span>
          <strong>{stage}</strong>
        </div>
      </div>

      <ol className={styles.timeline}>
        {phases.map((phase) => {
          const state = phaseState(task.status, phase.key, steps);
          return (
            <li className={styles.phase} data-state={state} key={phase.key}>
              <span className={styles.mark}>{phaseMark(state)}</span>
              <div>
                <strong>{phase.title}</strong>
                <p>{phase.note}</p>
              </div>
              <span className={styles.phaseState}>{state}</span>
            </li>
          );
        })}
      </ol>

      {task.error ? <div className="error-callout" role="alert">{task.error}</div> : null}
      {error ? <div className="error-callout" role="alert">{error}</div> : null}

      <footer className={styles.footer}>
        <span>最后更新 {new Date(task.updatedAt).toLocaleString("zh-CN")}</span>
        <div className={styles.actions}>
          {task.status === "failed" ? (
            <button className="button-primary" disabled={retrying} onClick={retry} type="button">
              {retrying ? "正在重新入队…" : "重新执行"}
            </button>
          ) : null}
          {task.status === "completed" ? (
            <Link className="button-primary" href={`/report/${task.id}`}>打开报告 →</Link>
          ) : null}
        </div>
      </footer>
      <AdminPasswordDialog
        actionLabel="重新执行调研"
        onAuthenticated={() => {
          setShowAdminDialog(false);
          void retry();
        }}
        onCancel={() => setShowAdminDialog(false)}
        open={showAdminDialog}
      />
    </section>
  );
}
