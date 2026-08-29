"use client";

import { FormEvent, useEffect, useState } from "react";

import { readApiError } from "@/lib/http/client";

import styles from "./admin-password-dialog.module.css";

export function AdminPasswordDialog({
  actionLabel,
  open,
  onAuthenticated,
  onCancel,
}: {
  actionLabel: string;
  open: boolean;
  onAuthenticated: () => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPassword("");
        setError(null);
        setSubmitting(false);
        onCancel();
      }
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onCancel, open]);

  if (!open) return null;

  function cancel() {
    setPassword("");
    setError(null);
    setSubmitting(false);
    onCancel();
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      setPassword("");
      setSubmitting(false);
      onAuthenticated();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "管理员验证失败");
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.backdrop} onMouseDown={(event) => {
      if (event.currentTarget === event.target) cancel();
    }}>
      <section aria-labelledby="admin-dialog-title" aria-modal="true" className={styles.dialog} role="dialog">
        <button aria-label="关闭管理员验证" className={styles.close} onClick={cancel} type="button">×</button>
        <span>ADMIN ACCESS</span>
        <h2 id="admin-dialog-title">需要管理员密码</h2>
        <p>游客可以查看已有报告；{actionLabel}会使用搜索或模型 API，需要管理员确认。</p>
        <form onSubmit={login}>
          <label htmlFor="admin-password">管理员密码</label>
          <input
            autoComplete="current-password"
            autoFocus
            id="admin-password"
            maxLength={200}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
          {error ? <div className="error-callout" role="alert">{error}</div> : null}
          <button className="button-primary" disabled={submitting} type="submit">
            {submitting ? "正在验证…" : "验证并继续"}
          </button>
        </form>
      </section>
    </div>
  );
}
