"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { ResearchTask, TaskStatus } from "@/lib/domain/research";
import { readApiError } from "@/lib/http/client";

import styles from "./history-list.module.css";

const statusLabels: Record<TaskStatus, string> = {
  queued: "排队中",
  running: "执行中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

export function HistoryList() {
  const [tasks, setTasks] = useState<ResearchTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function loadTasks() {
      try {
        const response = await fetch("/api/research?limit=30", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(await readApiError(response));
        const data = (await response.json()) as { tasks: ResearchTask[] };
        setTasks(data.tasks);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : "读取历史任务失败");
        }
      }
    }
    void loadTasks();
    return () => controller.abort();
  }, []);

  if (error) return <div className="error-callout" role="alert">{error}</div>;
  if (!tasks) return <div className={`${styles.state} panel`}>正在整理档案索引…</div>;
  if (!tasks.length) {
    return (
      <div className={`${styles.empty} panel`}>
        <span>ARCHIVE / EMPTY</span>
        <h2>还没有调研记录。</h2>
        <p>创建第一项任务后，它的执行状态和报告入口会出现在这里。</p>
        <Link className="button-primary" href="/">新建调研 →</Link>
      </div>
    );
  }

  return (
    <section className={`${styles.archive} panel`}>
      <div className={styles.columns} aria-hidden="true">
        <span>编号 / 日期</span><span>主题 / 竞品</span><span>状态 / 入口</span>
      </div>
      {tasks.map((task, index) => (
        <article className={styles.row} key={task.id}>
          <div className={styles.index}>
            <strong>{String(index + 1).padStart(2, "0")}</strong>
            <time>{new Date(task.createdAt).toLocaleDateString("zh-CN")}</time>
          </div>
          <div className={styles.subject}>
            <h2>{task.topic}</h2>
            <p>{task.competitors.join(" / ")}</p>
          </div>
          <div className={styles.action}>
            <span data-status={task.status}>{statusLabels[task.status]}</span>
            <Link href={task.status === "completed" ? `/report/${task.id}` : `/research/${task.id}`}>
              {task.status === "completed" ? "查看报告" : "查看执行"} →
            </Link>
          </div>
        </article>
      ))}
    </section>
  );
}
