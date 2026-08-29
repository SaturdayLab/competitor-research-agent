"use client";

import { FormEvent, KeyboardEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { readApiError } from "@/lib/http/client";
import {
  getCategorySpecificityHint,
  getRefreshExclusions,
  getSynchronizedAutomaticTopic,
  mergeRefreshedProducts,
} from "@/lib/ai/product-discovery-selection";

import styles from "./research-form.module.css";

type SelectionMode = "manual" | "automatic";
type DiscoveryScope = "domestic" | "overseas" | "global";
type DiscoveredProduct = {
  name: string;
  region: "domestic" | "overseas";
  reason: string;
  sourceIds: string[];
};

const regionLabels = { domestic: "国内", overseas: "海外" } as const;

const presets = {
  coding: {
    topic: "AI Coding 产品竞品分析",
    competitors: ["Cursor", "Claude Code", "Codex"],
    focus: "Agent 能力、交互形态、价格、目标用户",
  },
  collaboration: {
    topic: "协同办公产品竞品分析",
    competitors: ["Notion", "飞书", "Slack"],
    focus: "文档、知识管理、即时沟通、第三方集成、目标用户",
  },
};

export function ResearchForm() {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [automaticTopic, setAutomaticTopic] = useState<string | null>(null);
  const [competitorInput, setCompetitorInput] = useState("");
  const [competitors, setCompetitors] = useState<string[]>([]);
  const [focus, setFocus] = useState("");
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("manual");
  const [category, setCategory] = useState("");
  const [discoveryCount, setDiscoveryCount] = useState(3);
  const [discoveryScope, setDiscoveryScope] = useState<DiscoveryScope>("global");
  const [discoveredProducts, setDiscoveredProducts] = useState<DiscoveredProduct[]>([]);
  const [lockedProducts, setLockedProducts] = useState<string[]>([]);
  const [excludedProducts, setExcludedProducts] = useState<string[]>([]);
  const [discoveryNotice, setDiscoveryNotice] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const categoryHint = getCategorySpecificityHint(category);

  function clearDiscoveryResults() {
    setDiscoveredProducts([]);
    setLockedProducts([]);
    setExcludedProducts([]);
    setDiscoveryNotice(null);
    setCompetitors([]);
  }

  function addCompetitors(value: string) {
    const candidates = value
      .split(/[，,、;；\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (!candidates.length) return competitors;

    const next = [...competitors];
    for (const candidate of candidates) {
      if (!next.some((item) => item.toLocaleLowerCase() === candidate.toLocaleLowerCase())) {
        next.push(candidate);
      }
    }
    setCompetitors(next.slice(0, 6));
    setCompetitorInput("");
    return next.slice(0, 6);
  }

  function handleCompetitorKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === "," || event.key === "，") {
      event.preventDefault();
      addCompetitors(competitorInput);
    }
    if (event.key === "Backspace" && !competitorInput && competitors.length) {
      setCompetitors((current) => current.slice(0, -1));
    }
  }

  function applyPreset(key: keyof typeof presets) {
    const preset = presets[key];
    clearDiscoveryResults();
    setTopic(preset.topic);
    setAutomaticTopic(null);
    setCompetitors(preset.competitors);
    setFocus(preset.focus);
    setCompetitorInput("");
    setSelectionMode("manual");
    setError(null);
  }

  function changeSelectionMode(mode: SelectionMode) {
    setSelectionMode(mode);
    setCompetitorInput("");
    clearDiscoveryResults();
    setError(null);
  }

  async function handleDiscovery() {
    setError(null);
    setDiscoveryNotice(null);
    if (category.trim().length < 2) {
      setError("请先填写至少 2 个字符的产品类别。");
      return;
    }

    const refreshing = discoveredProducts.length > 0;
    const locked = new Set(lockedProducts);
    const unlocked = discoveredProducts.filter((product) => !locked.has(product.name));
    const replacementCount = refreshing ? discoveryCount - locked.size : discoveryCount;
    if (replacementCount < 1) {
      setDiscoveryNotice("所有候选都已锁定；请先解锁至少一个产品再换一批。");
      return;
    }
    const nextExcludedProducts = refreshing
      ? getRefreshExclusions(excludedProducts, discoveredProducts)
      : [];
    let requestScope: DiscoveryScope = discoveryScope;
    if (refreshing && discoveryScope === "global") {
      const unlockedRegions = new Set(unlocked.map((product) => product.region));
      if (unlockedRegions.size === 1) requestScope = unlocked[0].region;
    }

    setDiscovering(true);
    try {
      const response = await fetch("/api/research/discover-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          count: replacementCount,
          scope: requestScope,
          excludeProducts: nextExcludedProducts,
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      const data = (await response.json()) as {
        products: DiscoveredProduct[];
        requestedCount: number;
        partial: boolean;
        cached: boolean;
      };
      const nextProducts = refreshing
        ? mergeRefreshedProducts(discoveredProducts, data.products, locked, discoveryCount)
        : data.products;
      setDiscoveredProducts(nextProducts);
      setCompetitors(nextProducts.map((product) => product.name));
      setExcludedProducts(nextExcludedProducts);
      setCompetitorInput("");
      const synchronizedTopic = getSynchronizedAutomaticTopic(topic, automaticTopic, category);
      if (synchronizedTopic !== topic) setTopic(synchronizedTopic);
      setAutomaticTopic(synchronizedTopic === topic && topic !== automaticTopic ? automaticTopic : synchronizedTopic);
      const cacheNote = data.cached ? " 已复用缓存，没有产生重复搜索。" : "";
      setDiscoveryNotice(nextProducts.length < discoveryCount
        ? `目前有 ${nextProducts.length} 个有搜索依据的产品，少于请求的 ${discoveryCount} 个。${cacheNote}`
        : `${refreshing ? "已替换未锁定产品" : `已找到 ${nextProducts.length} 个候选产品`}。锁定满意的产品后，可以继续换一批。${cacheNote}`);
    } catch (discoveryError) {
      setError(discoveryError instanceof Error ? discoveryError.message : "自动发现产品失败");
    } finally {
      setDiscovering(false);
    }
  }

  function toggleProductLock(name: string) {
    setLockedProducts((current) => current.includes(name)
      ? current.filter((product) => product !== name)
      : [...current, name]);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const finalCompetitors = selectionMode === "manual" && competitorInput.trim()
      ? addCompetitors(competitorInput)
      : competitors;
    if (finalCompetitors.length < 2) {
      setError(selectionMode === "automatic"
        ? "请先点击“发现产品”，获得至少 2 个候选产品后再开始调研。"
        : "请至少添加 2 个竞品；输入后按 Enter 确认。");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, competitors: finalCompetitors, focus }),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      const data = (await response.json()) as { task: { id: string } };
      router.push(`/research/${data.task.id}`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "创建任务失败");
      setSubmitting(false);
    }
  }

  return (
    <aside className={`${styles.card} panel`} aria-labelledby="research-form-title">
      <div className={styles.cardHead}>
        <span>NEW RESEARCH</span>
        <span className={styles.dot} aria-hidden="true" />
      </div>
      <h2 id="research-form-title">建立调研档案</h2>
      <p className={styles.caption}>填写问题与比较对象，任务会进入独立后台队列。</p>

      <div className={styles.modeToggle} aria-label="选品方式">
        <button
          aria-pressed={selectionMode === "manual"}
          data-active={selectionMode === "manual"}
          onClick={() => changeSelectionMode("manual")}
          type="button"
        >
          手动选择
          <small>已知要比较谁</small>
        </button>
        <button
          aria-pressed={selectionMode === "automatic"}
          data-active={selectionMode === "automatic"}
          onClick={() => changeSelectionMode("automatic")}
          type="button"
        >
          自动发现
          <small>从一个品类开始</small>
        </button>
      </div>

      {selectionMode === "manual" ? (
        <div className={styles.presets} aria-label="示例任务">
          <button type="button" onClick={() => applyPreset("coding")}>AI Coding 示例</button>
          <button type="button" onClick={() => applyPreset("collaboration")}>协同办公示例</button>
        </div>
      ) : null}

      <form onSubmit={handleSubmit}>
        {selectionMode === "automatic" ? (
          <section className={styles.discoveryPanel} aria-label="自动发现产品设置">
            <label className={styles.field}>
              <span>产品类别</span>
              <input
                maxLength={100}
                minLength={2}
                onChange={(event) => {
                  const nextCategory = event.target.value;
                  const nextTopic = getSynchronizedAutomaticTopic(topic, automaticTopic, nextCategory);
                  setCategory(nextCategory);
                  if (nextTopic !== topic) {
                    setTopic(nextTopic);
                    setAutomaticTopic(nextTopic || null);
                  }
                  clearDiscoveryResults();
                }}
                placeholder="例如：AI 编程助手"
                required
                value={category}
              />
              {categoryHint ? <small className={styles.categoryHint}>{categoryHint}</small> : null}
            </label>
            <div className={styles.discoveryOptions}>
              <label className={styles.compactField}>
                <span>产品数量</span>
                <select value={discoveryCount} onChange={(event) => {
                  setDiscoveryCount(Number(event.target.value));
                  clearDiscoveryResults();
                }}>
                  {[2, 3, 4, 5, 6].map((count) => <option key={count} value={count}>{count} 个</option>)}
                </select>
              </label>
              <fieldset className={styles.scopeField}>
                <legend>地域范围</legend>
                <div>
                  {(["domestic", "overseas", "global"] as const).map((scope) => (
                    <label key={scope}>
                      <input
                        checked={discoveryScope === scope}
                        name="discovery-scope"
                        onChange={() => {
                          setDiscoveryScope(scope);
                          clearDiscoveryResults();
                        }}
                        type="radio"
                      />
                      <span>{scope === "domestic" ? "国内" : scope === "overseas" ? "海外" : "全球"}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
            <button
              className={styles.discoverButton}
              disabled={discovering || (discoveredProducts.length > 0 && lockedProducts.length === discoveredProducts.length)}
              onClick={handleDiscovery}
              type="button"
            >
              {discovering ? "正在搜索并筛选…" : discoveredProducts.length ? "换一批未锁定产品  →" : "发现产品  →"}
            </button>
            <p className={styles.discoveryBudget}>单次最多 2 次搜索与 1 次模型筛选；确认产品后才开始正式调研。</p>
          </section>
        ) : null}

        <label className={styles.field}>
          <span>调研主题</span>
          <input
            required
            minLength={3}
            maxLength={160}
            value={topic}
            onChange={(event) => {
              setTopic(event.target.value);
              setAutomaticTopic(null);
            }}
            placeholder="例如：AI Coding 产品竞品分析"
          />
        </label>

        {selectionMode === "manual" ? (
          <div className={styles.field}>
            <label htmlFor="competitor-input">竞品（2–6 个）</label>
            <div className={styles.tagField}>
              {competitors.map((competitor) => (
                <span className={styles.tag} key={competitor}>
                  {competitor}
                  <button
                    type="button"
                    aria-label={`移除 ${competitor}`}
                    onClick={() => setCompetitors((items) => items.filter((item) => item !== competitor))}
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                id="competitor-input"
                value={competitorInput}
                onChange={(event) => setCompetitorInput(event.target.value)}
                onKeyDown={handleCompetitorKeyDown}
                onBlur={() => addCompetitors(competitorInput)}
                placeholder={competitors.length ? "继续添加…" : "输入名称后按 Enter"}
              />
            </div>
          </div>
        ) : null}

        {selectionMode === "automatic" && discoveredProducts.length > 0 ? (
          <div className={styles.discoveryResults} aria-label="自动发现结果">
            {discoveredProducts.map((product) => (
                <article data-locked={lockedProducts.includes(product.name)} key={product.name}>
                  <div>
                    <strong>{product.name}</strong>
                    <div className={styles.productActions}>
                      <span>{regionLabels[product.region]}</span>
                      <button
                        aria-pressed={lockedProducts.includes(product.name)}
                        onClick={() => toggleProductLock(product.name)}
                        type="button"
                      >
                        {lockedProducts.includes(product.name) ? "已锁定" : "锁定"}
                      </button>
                    </div>
                  </div>
                  <p>{product.reason}</p>
                </article>
              ))}
          </div>
        ) : null}

        {discoveryNotice ? <p className={styles.discoveryNotice} aria-live="polite">{discoveryNotice}</p> : null}

        <label className={styles.field}>
          <span>重点关注 <small>可选</small></span>
          <textarea
            maxLength={500}
            rows={3}
            value={focus}
            onChange={(event) => setFocus(event.target.value)}
            placeholder="Agent 能力、价格、目标用户…"
          />
        </label>

        {error ? <div className="error-callout" role="alert">{error}</div> : null}

        <button className={`button-primary ${styles.submit}`} disabled={submitting || discovering} type="submit">
          {submitting ? "正在建立档案…" : "开始调研  →"}
        </button>
      </form>
      <p className={styles.disclaimer}>未启用联网搜索时，系统只生成用于流程演示的报告，不包含实时来源。</p>
    </aside>
  );
}
