import { randomUUID } from "node:crypto";

import type {
  CreateResearchInput,
  ResearchEvidence,
  ResearchReport,
  ResearchSource,
  ResearchStep,
  ResearchTask,
  ResearchTaskDetail,
  StepType,
  WorkflowRun,
} from "@/lib/domain/research";
import type {
  CompleteWorkflowInput,
  FailWorkflowInput,
  ResearchRunBundle,
  ResearchRepository,
  SaveResearchEvidenceInput,
  SaveResearchSourceInput,
  UpdateSourceFetchInput,
} from "@/lib/research/repository";

export class MemoryResearchRepository implements ResearchRepository {
  private readonly tasks = new Map<string, ResearchTask>();
  private readonly runs = new Map<string, WorkflowRun>();
  private readonly steps = new Map<string, ResearchStep>();
  private readonly reports = new Map<string, ResearchReport>();
  private readonly sources = new Map<string, ResearchSource>();
  private readonly evidence = new Map<string, ResearchEvidence>();

  async getRunBundle(runId: string): Promise<ResearchRunBundle | null> {
    const run = this.runs.get(runId);
    if (!run) return null;
    const task = this.requireTask(run.taskId);
    const steps = [...this.steps.values()]
      .filter((step) => step.runId === runId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const report = [...this.reports.values()]
      .filter((item) => item.runId === runId)
      .sort((left, right) => right.revision - left.revision)[0] ?? null;
    return {
      task: structuredClone(task),
      run: structuredClone(run),
      steps: structuredClone(steps),
      report: report ? structuredClone(report) : null,
      sources: await this.listSources(task.id, runId),
      evidence: await this.listEvidence(task.id, runId),
    };
  }

  async createTask(input: CreateResearchInput, userId: string | null = null): Promise<ResearchTask> {
    const now = new Date().toISOString();
    const task: ResearchTask = {
      id: randomUUID(),
      userId,
      topic: input.topic,
      competitors: [...input.competitors],
      focus: input.focus ?? null,
      status: "queued",
      currentStep: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(task.id, task);
    await this.createRun(task.id);
    return structuredClone(task);
  }

  async enqueueTask(taskId: string): Promise<WorkflowRun> {
    const task = this.requireTask(taskId);
    const hasActiveRun = [...this.runs.values()].some(
      (run) => run.taskId === taskId && (run.status === "queued" || run.status === "running"),
    );
    if (hasActiveRun) {
      throw new Error("该任务已有待执行或运行中的工作流");
    }
    task.status = "queued";
    task.currentStep = null;
    task.error = null;
    task.updatedAt = new Date().toISOString();
    return this.createRun(taskId);
  }

  async claimNextRun(workerId: string): Promise<WorkflowRun | null> {
    const run = [...this.runs.values()]
      .filter((candidate) => candidate.status === "queued")
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
    if (!run) return null;

    const now = new Date().toISOString();
    run.status = "running";
    run.attemptCount += 1;
    run.workerId = workerId;
    run.startedAt ??= now;

    const task = this.requireTask(run.taskId);
    task.status = "running";
    task.currentStep = "generating";
    task.error = null;
    task.updatedAt = now;
    return structuredClone(run);
  }

  async getTask(taskId: string): Promise<ResearchTask | null> {
    const task = this.tasks.get(taskId);
    return task ? structuredClone(task) : null;
  }

  async getTaskDetail(taskId: string): Promise<ResearchTaskDetail | null> {
    const task = await this.getTask(taskId);
    if (!task) return null;
    const steps = [...this.steps.values()]
      .filter((step) => step.taskId === taskId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((step) => structuredClone(step));
    const sourceCount = [...this.sources.values()].filter((source) => source.taskId === taskId).length;
    return { task, steps, report: await this.getReport(taskId), sourceCount };
  }

  async getReport(taskId: string): Promise<ResearchReport | null> {
    const reports = [...this.reports.values()]
      .filter((report) => report.taskId === taskId)
      .sort((left, right) => right.revision - left.revision);
    return reports[0] ? structuredClone(reports[0]) : null;
  }

  async listTasks(limit = 20): Promise<ResearchTask[]> {
    return [...this.tasks.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit)
      .map((task) => structuredClone(task));
  }

  async beginStep(
    runId: string,
    taskId: string,
    stepType: StepType,
    input: unknown,
  ): Promise<ResearchStep> {
    const run = this.requireRun(runId);
    if (run.taskId !== taskId || run.status !== "running") {
      throw new Error("工作流不属于该任务或尚未运行");
    }
    const task = this.requireTask(taskId);
    const now = new Date().toISOString();
    const attempt = [...this.steps.values()].filter(
      (step) => step.runId === runId && step.stepType === stepType,
    ).length + 1;
    const step: ResearchStep = {
      id: randomUUID(),
      runId,
      taskId,
      stepType,
      status: "running",
      input: structuredClone(input),
      output: null,
      error: null,
      attempt,
      startedAt: now,
      finishedAt: null,
      createdAt: now,
    };
    this.steps.set(step.id, step);
    task.currentStep = stepType;
    task.updatedAt = now;
    return structuredClone(step);
  }

  async completeStep(stepId: string, output: unknown): Promise<void> {
    const step = this.requireStep(stepId);
    const run = this.requireRun(step.runId);
    if (run.status !== "running" || step.status !== "running") {
      throw new Error("工作流或步骤不处于运行状态");
    }
    step.status = "completed";
    step.output = structuredClone(output);
    step.error = null;
    step.finishedAt = new Date().toISOString();
  }

  async saveSources(
    taskId: string,
    runId: string,
    sources: SaveResearchSourceInput[],
  ): Promise<ResearchSource[]> {
    this.requireTask(taskId);
    const run = this.requireRun(runId);
    if (run.taskId !== taskId) throw new Error("工作流不属于该任务");
    if (run.status !== "running") throw new Error("只能为运行中的工作流保存来源");

    const existingByUrl = new Map(
      [...this.sources.values()]
        .filter((source) => source.runId === runId)
        .map((source) => [source.canonicalUrl, source]),
    );
    const now = new Date().toISOString();
    for (const input of sources) {
      if (existingByUrl.has(input.canonicalUrl)) continue;
      const source: ResearchSource = {
        ...structuredClone(input),
        id: randomUUID(),
        taskId,
        runId,
        retrievedAt: now,
        extractedText: null,
        fetchStatus: "pending",
        fetchError: null,
      };
      this.sources.set(source.id, source);
      existingByUrl.set(source.canonicalUrl, source);
    }
    return this.listSources(taskId, runId);
  }

  async listSources(taskId: string, runId?: string): Promise<ResearchSource[]> {
    this.requireTask(taskId);
    if (runId) {
      const run = this.requireRun(runId);
      if (run.taskId !== taskId) throw new Error("工作流不属于该任务");
    }
    return [...this.sources.values()]
      .filter((source) => source.taskId === taskId && (!runId || source.runId === runId))
      .sort((left, right) => left.retrievedAt.localeCompare(right.retrievedAt))
      .map((source) => structuredClone(source));
  }

  async updateSourceFetch(sourceId: string, patch: UpdateSourceFetchInput): Promise<ResearchSource> {
    const source = this.sources.get(sourceId);
    if (!source) throw new Error("调研来源不存在");
    source.fetchStatus = patch.fetchStatus;
    if (patch.extractedText !== undefined) source.extractedText = patch.extractedText;
    if (patch.fetchError !== undefined) source.fetchError = patch.fetchError;
    if (patch.contentHash) source.metadata = { ...source.metadata, contentHash: patch.contentHash };
    return structuredClone(source);
  }

  async saveEvidence(taskId: string, items: SaveResearchEvidenceInput[]): Promise<ResearchEvidence[]> {
    this.requireTask(taskId);
    const now = new Date().toISOString();
    const saved: ResearchEvidence[] = [];
    for (const item of items) {
      const source = this.sources.get(item.sourceId);
      if (!source || source.taskId !== taskId) throw new Error("来源不属于该任务");
      const record: ResearchEvidence = {
        id: randomUUID(),
        taskId,
        sourceId: item.sourceId,
        product: item.product,
        dimension: item.dimension,
        value: structuredClone(item.value),
        evidenceText: item.evidenceText,
        confidence: item.confidence ?? null,
        createdAt: now,
      };
      this.evidence.set(record.id, record);
      saved.push(structuredClone(record));
    }
    return saved;
  }

  async listEvidence(taskId: string, runId?: string): Promise<ResearchEvidence[]> {
    this.requireTask(taskId);
    if (runId) {
      const run = this.requireRun(runId);
      if (run.taskId !== taskId) throw new Error("工作流不属于该任务");
    }
    return [...this.evidence.values()]
      .filter((item) => {
        if (item.taskId !== taskId) return false;
        if (!runId) return true;
        const source = this.sources.get(item.sourceId);
        return source?.runId === runId;
      })
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((item) => structuredClone(item));
  }

  async completeWorkflow(input: CompleteWorkflowInput): Promise<ResearchReport> {
    const task = this.requireTask(input.taskId);
    const run = this.requireRun(input.runId);
    const step = this.requireStep(input.stepId);
    if (run.status !== "running" || step.status !== "running") {
      throw new Error("工作流或步骤不处于运行状态");
    }
    const now = new Date().toISOString();
    const revision = [...this.reports.values()].filter(
      (report) => report.taskId === input.taskId,
    ).length + 1;
    const report: ResearchReport = {
      id: randomUUID(),
      taskId: input.taskId,
      runId: input.runId,
      title: input.draft.title,
      content: input.markdown,
      structuredContent: structuredClone(input.draft),
      reviewStatus: input.reviewStatus ?? "not_reviewed",
      revision,
      createdAt: now,
    };
    this.reports.set(report.id, report);
    step.status = "completed";
    step.output = structuredClone(input.finalStepOutput ?? input.draft);
    step.error = null;
    step.finishedAt = now;
    run.status = "completed";
    run.finishedAt = now;
    task.status = "completed";
    task.currentStep = null;
    task.error = null;
    task.updatedAt = now;
    return structuredClone(report);
  }

  async failWorkflow(input: FailWorkflowInput): Promise<void> {
    const task = this.requireTask(input.taskId);
    const run = this.requireRun(input.runId);
    const now = new Date().toISOString();
    if (input.stepId) {
      const step = this.requireStep(input.stepId);
      step.status = "failed";
      step.error = input.error;
      step.finishedAt = now;
    }
    run.status = "failed";
    run.finishedAt = now;
    task.status = "failed";
    task.error = input.error;
    task.updatedAt = now;
  }

  private async createRun(taskId: string): Promise<WorkflowRun> {
    const now = new Date().toISOString();
    const run: WorkflowRun = {
      id: randomUUID(),
      taskId,
      status: "queued",
      attemptCount: 0,
      workerId: null,
      startedAt: null,
      finishedAt: null,
      createdAt: now,
    };
    this.runs.set(run.id, run);
    return structuredClone(run);
  }

  private requireTask(taskId: string): ResearchTask {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error("调研任务不存在");
    return task;
  }

  private requireRun(runId: string): WorkflowRun {
    const run = this.runs.get(runId);
    if (!run) throw new Error("工作流执行不存在");
    return run;
  }

  private requireStep(stepId: string): ResearchStep {
    const step = this.steps.get(stepId);
    if (!step) throw new Error("工作流步骤不存在");
    return step;
  }
}
