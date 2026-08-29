import { z } from "zod";

import {
  FetchStatusSchema,
  ResearchDraftSchema,
  RunStatusSchema,
  StepStatusSchema,
  StepTypeSchema,
  TaskStatusSchema,
  type CreateResearchInput,
  type ResearchEvidence,
  type ResearchReport,
  type ResearchSource,
  type ResearchStep,
  type ResearchTask,
  type ResearchTaskDetail,
  type StepType,
  type WorkflowRun,
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
import { makePostgresJsonSafe, stripPostgresNulls } from "@/lib/research/postgres-safe";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type Row = Record<string, unknown>;

function asString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`数据库字段 ${field} 无效`);
  return value;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function mapTask(row: Row): ResearchTask {
  return {
    id: asString(row.public_id, "research_tasks.public_id"),
    userId: asNullableString(row.user_id),
    topic: asString(row.topic, "research_tasks.topic"),
    competitors: z.array(z.string()).parse(row.competitors),
    focus: asNullableString(row.focus),
    status: TaskStatusSchema.parse(row.status),
    currentStep: row.current_step ? StepTypeSchema.parse(row.current_step) : null,
    error: asNullableString(row.error),
    createdAt: asString(row.created_at, "research_tasks.created_at"),
    updatedAt: asString(row.updated_at, "research_tasks.updated_at"),
  };
}

function mapRun(row: Row): WorkflowRun {
  return {
    id: asString(row.public_id ?? row.run_public_id, "workflow_runs.public_id"),
    taskId: asString(row.task_public_id, "workflow_runs.task_public_id"),
    status: RunStatusSchema.parse(row.status ?? row.run_status),
    attemptCount: z.number().int().nonnegative().parse(row.attempt_count ?? row.run_attempt_count),
    workerId: asNullableString(row.worker_id ?? row.run_worker_id),
    startedAt: asNullableString(row.started_at ?? row.run_started_at),
    finishedAt: asNullableString(row.finished_at ?? row.run_finished_at),
    createdAt: asString(row.created_at ?? row.run_created_at, "workflow_runs.created_at"),
  };
}

function mapStep(row: Row, taskPublicId: string, runPublicId: string): ResearchStep {
  return {
    id: asString(row.public_id, "research_steps.public_id"),
    runId: runPublicId,
    taskId: taskPublicId,
    stepType: StepTypeSchema.parse(row.step_type),
    status: StepStatusSchema.parse(row.status),
    input: row.input ?? null,
    output: row.output ?? null,
    error: asNullableString(row.error),
    attempt: z.number().int().positive().parse(row.attempt),
    startedAt: asNullableString(row.started_at),
    finishedAt: asNullableString(row.finished_at),
    createdAt: asString(row.created_at, "research_steps.created_at"),
  };
}

function mapReport(row: Row, taskPublicId: string, runPublicId: string): ResearchReport {
  return {
    id: asString(row.public_id, "research_reports.public_id"),
    taskId: taskPublicId,
    runId: runPublicId,
    title: asString(row.title, "research_reports.title"),
    content: asString(row.content, "research_reports.content"),
    structuredContent: ResearchDraftSchema.parse(row.structured_content),
    reviewStatus: z
      .enum(["not_reviewed", "passed", "revision_requested"])
      .parse(row.review_status),
    revision: z.number().int().positive().parse(row.revision),
    createdAt: asString(row.created_at, "research_reports.created_at"),
  };
}

function mapSource(row: Row, taskPublicId: string, runPublicId: string): ResearchSource {
  return {
    id: asString(row.public_id, "research_sources.public_id"),
    taskId: taskPublicId,
    runId: runPublicId,
    product: asString(row.product, "research_sources.product"),
    title: asString(row.title, "research_sources.title"),
    url: asString(row.url, "research_sources.url"),
    canonicalUrl: asString(row.canonical_url, "research_sources.canonical_url"),
    snippet: asString(row.snippet, "research_sources.snippet"),
    sourceType: z.enum(["search_result", "web_page"]).parse(row.source_type),
    isOfficial: z.boolean().parse(row.is_official),
    retrievedAt: asString(row.retrieved_at, "research_sources.retrieved_at"),
    metadata: z.record(z.string(), z.unknown()).parse(row.metadata),
    extractedText: asNullableString(row.extracted_text),
    fetchStatus: FetchStatusSchema.parse(row.fetch_status ?? "pending"),
    fetchError: asNullableString(row.fetch_error),
  };
}

function mapEvidence(row: Row, taskPublicId: string, sourcePublicId: string): ResearchEvidence {
  return {
    id: asString(row.public_id, "research_evidence.public_id"),
    taskId: taskPublicId,
    sourceId: sourcePublicId,
    product: asString(row.product, "research_evidence.product"),
    dimension: asString(row.dimension, "research_evidence.dimension"),
    value: row.value,
    evidenceText: asString(row.evidence_text, "research_evidence.evidence_text"),
    confidence:
      row.confidence === null || row.confidence === undefined ? null : z.number().min(0).max(1).parse(Number(row.confidence)),
    createdAt: asString(row.created_at, "research_evidence.created_at"),
  };
}

function ensureNoError(error: { message: string } | null, action: string): void {
  if (error) throw new Error(`${action}失败：${error.message}`);
}

export class SupabaseResearchRepository implements ResearchRepository {
  private readonly client = getSupabaseServerClient();

  async getRunBundle(runId: string): Promise<ResearchRunBundle | null> {
    const { data: runData, error: runError } = await this.client
      .from("workflow_runs")
      .select("*, research_tasks!inner(*)")
      .eq("public_id", runId)
      .maybeSingle();
    ensureNoError(runError, "读取评测工作流");
    if (!runData) return null;

    const runRow = runData as Row;
    const taskRow = runRow.research_tasks as Row;
    const task = mapTask(taskRow);
    const run = mapRun({ ...runRow, task_public_id: task.id });
    const internalRunId = z.number().int().positive().parse(runRow.id);
    const [{ data: stepRows, error: stepError }, { data: reportRow, error: reportError }, sources, evidence] =
      await Promise.all([
        this.client
          .from("research_steps")
          .select("*")
          .eq("run_id", internalRunId)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true }),
        this.client
          .from("research_reports")
          .select("*")
          .eq("run_id", internalRunId)
          .order("revision", { ascending: false })
          .limit(1)
          .maybeSingle(),
        this.listSources(task.id, runId),
        this.listEvidence(task.id, runId),
      ]);
    ensureNoError(stepError, "读取评测步骤");
    ensureNoError(reportError, "读取评测报告");
    return {
      task,
      run,
      steps: ((stepRows ?? []) as Row[]).map((row) => mapStep(row, task.id, runId)),
      report: reportRow ? mapReport(reportRow as Row, task.id, runId) : null,
      sources,
      evidence,
    };
  }

  async createTask(input: CreateResearchInput, userId: string | null = null): Promise<ResearchTask> {
    const { data, error } = await this.client.rpc("create_research_task", {
      task_topic: input.topic,
      task_competitors: input.competitors,
      task_focus: input.focus ?? null,
      task_user_id: userId,
    });
    ensureNoError(error, "创建调研任务");
    const result = Array.isArray(data) ? data[0] : data;
    const taskId = asString((result as Row | null)?.task_public_id, "task_public_id");
    const task = await this.getTask(taskId);
    if (!task) throw new Error("调研任务已创建，但无法重新读取");
    return task;
  }

  async enqueueTask(taskId: string): Promise<WorkflowRun> {
    const { data, error } = await this.client.rpc("enqueue_research_task", {
      task_public_id: taskId,
    });
    ensureNoError(error, "重新加入执行队列");
    return this.getRun(asString(data, "run_public_id"));
  }

  async claimNextRun(workerId: string): Promise<WorkflowRun | null> {
    const { data, error } = await this.client.rpc("claim_next_workflow_run", {
      worker_identity: workerId,
    });
    ensureNoError(error, "领取工作流任务");
    const result = Array.isArray(data) ? data[0] : data;
    return result ? mapRun(result as Row) : null;
  }

  async getTask(taskId: string): Promise<ResearchTask | null> {
    const result = await this.getTaskRow(taskId);
    return result ? mapTask(result) : null;
  }

  async getTaskDetail(taskId: string): Promise<ResearchTaskDetail | null> {
    const taskRow = await this.getTaskRow(taskId);
    if (!taskRow) return null;
    const task = mapTask(taskRow);
    const internalTaskId = z.number().int().positive().parse(taskRow.id);

    const [{ data: stepRows, error: stepError }, report, sourceResult] = await Promise.all([
      this.client
        .from("research_steps")
        .select("*, workflow_runs!inner(public_id)")
        .eq("task_id", internalTaskId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true }),
      this.getReport(taskId),
      this.client
        .from("research_sources")
        .select("id", { count: "exact", head: true })
        .eq("task_id", internalTaskId),
    ]);
    ensureNoError(stepError, "读取工作流步骤");
    ensureNoError(sourceResult.error, "读取来源数量");

    const steps = ((stepRows ?? []) as Row[]).map((row) => {
      const runRelation = row.workflow_runs as Row;
      return mapStep(row, taskId, asString(runRelation.public_id, "workflow_runs.public_id"));
    });
    return { task, steps, report, sourceCount: sourceResult.count ?? 0 };
  }

  async getReport(taskId: string): Promise<ResearchReport | null> {
    const taskRow = await this.getTaskRow(taskId);
    if (!taskRow) return null;
    const internalTaskId = z.number().int().positive().parse(taskRow.id);
    const { data, error } = await this.client
      .from("research_reports")
      .select("*, workflow_runs!inner(public_id)")
      .eq("task_id", internalTaskId)
      .order("revision", { ascending: false })
      .limit(1)
      .maybeSingle();
    ensureNoError(error, "读取调研报告");
    if (!data) return null;
    const row = data as Row;
    const runRelation = row.workflow_runs as Row;
    return mapReport(row, taskId, asString(runRelation.public_id, "workflow_runs.public_id"));
  }

  async listTasks(limit = 20): Promise<ResearchTask[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const { data, error } = await this.client
      .from("research_tasks")
      .select("*")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(safeLimit);
    ensureNoError(error, "读取历史任务");
    return ((data ?? []) as Row[]).map(mapTask);
  }

  async beginStep(
    runId: string,
    taskId: string,
    stepType: StepType,
    input: unknown,
  ): Promise<ResearchStep> {
    const { data, error } = await this.client.rpc("begin_research_step", {
      run_public_id: runId,
      task_public_id: taskId,
      requested_step_type: stepType,
      step_input: makePostgresJsonSafe(input),
    });
    ensureNoError(error, "启动工作流步骤");
    return this.getStep(asString(data, "step_public_id"), taskId, runId);
  }

  async completeStep(stepId: string, output: unknown): Promise<void> {
    const { error } = await this.client.rpc("complete_research_step", {
      step_public_id: stepId,
      step_output: makePostgresJsonSafe(output),
    });
    ensureNoError(error, "完成工作流步骤");
  }

  async saveSources(
    taskId: string,
    runId: string,
    sources: SaveResearchSourceInput[],
  ): Promise<ResearchSource[]> {
    const taskRow = await this.getTaskRow(taskId);
    if (!taskRow) throw new Error("调研任务不存在");
    const internalTaskId = z.number().int().positive().parse(taskRow.id);
    const runRow = await this.getRunRow(runId, internalTaskId);
    const internalRunId = z.number().int().positive().parse(runRow.id);

    if (sources.length > 0) {
      const rows = sources.map((source) => ({
        task_id: internalTaskId,
        run_id: internalRunId,
        product: stripPostgresNulls(source.product),
        title: stripPostgresNulls(source.title),
        url: stripPostgresNulls(source.url),
        canonical_url: stripPostgresNulls(source.canonicalUrl),
        snippet: stripPostgresNulls(source.snippet),
        source_type: stripPostgresNulls(source.sourceType),
        is_official: source.isOfficial,
        metadata: makePostgresJsonSafe(source.metadata),
      }));
      const { error } = await this.client.from("research_sources").upsert(rows, {
        onConflict: "run_id,canonical_url",
        ignoreDuplicates: true,
      });
      ensureNoError(error, "保存调研来源");
    }

    return this.listSources(taskId, runId);
  }

  async updateSourceFetch(sourceId: string, patch: UpdateSourceFetchInput): Promise<ResearchSource> {
    const { data, error } = await this.client
      .from("research_sources")
      .update({
        fetch_status: patch.fetchStatus,
        extracted_text: patch.extractedText ? stripPostgresNulls(patch.extractedText) : null,
        fetch_error: patch.fetchError ? stripPostgresNulls(patch.fetchError) : null,
        content_hash: patch.contentHash ? stripPostgresNulls(patch.contentHash) : null,
      })
      .eq("public_id", sourceId)
      .select("*, workflow_runs!inner(public_id), research_tasks!inner(public_id)")
      .single();
    ensureNoError(error, "更新来源抓取状态");
    const row = data as Row;
    const runRelation = row.workflow_runs as Row;
    const taskRelation = row.research_tasks as Row;
    return mapSource(
      row,
      asString(taskRelation.public_id, "research_tasks.public_id"),
      asString(runRelation.public_id, "workflow_runs.public_id"),
    );
  }

  async saveEvidence(taskId: string, items: SaveResearchEvidenceInput[]): Promise<ResearchEvidence[]> {
    if (items.length === 0) return this.listEvidence(taskId);
    const taskRow = await this.getTaskRow(taskId);
    if (!taskRow) throw new Error("调研任务不存在");
    const internalTaskId = z.number().int().positive().parse(taskRow.id);
    const sourceIds = [...new Set(items.map((item) => item.sourceId))];
    const { data: sourceRows, error: sourceError } = await this.client
      .from("research_sources")
      .select("id, public_id, task_id")
      .in("public_id", sourceIds);
    ensureNoError(sourceError, "读取证据来源");
    const sources = (sourceRows ?? []) as Row[];
    const byPublicId = new Map(sources.map((row) => [asString(row.public_id, "research_sources.public_id"), row]));
    const rows = items.map((item) => {
      const source = byPublicId.get(item.sourceId);
      if (!source || z.number().int().positive().parse(source.task_id) !== internalTaskId) {
        throw new Error("来源不属于该任务");
      }
      return {
        task_id: internalTaskId,
        source_id: z.number().int().positive().parse(source.id),
        product: stripPostgresNulls(item.product),
        dimension: stripPostgresNulls(item.dimension),
        value: makePostgresJsonSafe(item.value),
        evidence_text: stripPostgresNulls(item.evidenceText),
        confidence: item.confidence ?? null,
      };
    });
    const { error } = await this.client.from("research_evidence").insert(rows);
    ensureNoError(error, "保存调研证据");
    return this.listEvidence(taskId);
  }

  async listEvidence(taskId: string, runId?: string): Promise<ResearchEvidence[]> {
    const taskRow = await this.getTaskRow(taskId);
    if (!taskRow) return [];
    const internalTaskId = z.number().int().positive().parse(taskRow.id);
    let query = this.client
      .from("research_evidence")
      .select("*, research_sources!inner(public_id, run_id)")
      .eq("task_id", internalTaskId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (runId) {
      const runRow = await this.getRunRow(runId, internalTaskId);
      query = query.eq("research_sources.run_id", z.number().int().positive().parse(runRow.id));
    }
    const { data, error } = await query;
    ensureNoError(error, "读取调研证据");
    return ((data ?? []) as Row[]).map((row) => {
      const sourceRelation = row.research_sources as Row;
      return mapEvidence(row, taskId, asString(sourceRelation.public_id, "research_sources.public_id"));
    });
  }

  async listSources(taskId: string, runId?: string): Promise<ResearchSource[]> {
    const taskRow = await this.getTaskRow(taskId);
    if (!taskRow) return [];
    const internalTaskId = z.number().int().positive().parse(taskRow.id);
    let internalRunId: number | null = null;
    if (runId) {
      const runRow = await this.getRunRow(runId, internalTaskId);
      internalRunId = z.number().int().positive().parse(runRow.id);
    }

    let query = this.client
      .from("research_sources")
      .select("*, workflow_runs!inner(public_id)")
      .eq("task_id", internalTaskId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (internalRunId) query = query.eq("run_id", internalRunId);
    const { data, error } = await query;
    ensureNoError(error, "读取调研来源");
    return ((data ?? []) as Row[]).map((row) => {
      const runRelation = row.workflow_runs as Row;
      return mapSource(row, taskId, asString(runRelation.public_id, "workflow_runs.public_id"));
    });
  }

  async completeWorkflow(input: CompleteWorkflowInput): Promise<ResearchReport> {
    const { data, error } = await this.client.rpc("complete_research_workflow", {
      task_public_id: input.taskId,
      run_public_id: input.runId,
      step_public_id: input.stepId,
      report_title: stripPostgresNulls(input.draft.title),
      report_content: stripPostgresNulls(input.markdown),
      report_structured_content: makePostgresJsonSafe(input.draft),
      final_step_output: makePostgresJsonSafe(input.finalStepOutput ?? input.draft),
    });
    ensureNoError(error, "完成调研工作流");
    const report = await this.getReportById(asString(data, "report_public_id"), input.taskId, input.runId);
    const reviewStatus = input.reviewStatus ?? "not_reviewed";
    if (reviewStatus === "not_reviewed") return report;
    const { error: reviewError } = await this.client
      .from("research_reports")
      .update({ review_status: reviewStatus })
      .eq("public_id", report.id);
    ensureNoError(reviewError, "更新报告审核状态");
    return { ...report, reviewStatus };
  }

  async failWorkflow(input: FailWorkflowInput): Promise<void> {
    const { error } = await this.client.rpc("fail_research_workflow", {
      task_public_id: input.taskId,
      run_public_id: input.runId,
      failure_message: input.error,
      step_public_id: input.stepId,
    });
    ensureNoError(error, "记录工作流失败状态");
  }

  private async getTaskRow(taskId: string): Promise<Row | null> {
    const { data, error } = await this.client
      .from("research_tasks")
      .select("*")
      .eq("public_id", taskId)
      .maybeSingle();
    ensureNoError(error, "读取调研任务");
    return data as Row | null;
  }

  private async getRun(runId: string): Promise<WorkflowRun> {
    const { data, error } = await this.client
      .from("workflow_runs")
      .select("*, research_tasks!inner(public_id)")
      .eq("public_id", runId)
      .single();
    ensureNoError(error, "读取工作流执行");
    const row = data as Row;
    const taskRelation = row.research_tasks as Row;
    return mapRun({ ...row, task_public_id: taskRelation.public_id });
  }

  private async getRunRow(runId: string, internalTaskId: number): Promise<Row> {
    const { data, error } = await this.client
      .from("workflow_runs")
      .select("*")
      .eq("public_id", runId)
      .eq("task_id", internalTaskId)
      .single();
    ensureNoError(error, "读取工作流执行");
    return data as Row;
  }

  private async getStep(stepId: string, taskId: string, runId: string): Promise<ResearchStep> {
    const { data, error } = await this.client
      .from("research_steps")
      .select("*")
      .eq("public_id", stepId)
      .single();
    ensureNoError(error, "读取工作流步骤");
    return mapStep(data as Row, taskId, runId);
  }

  private async getReportById(
    reportId: string,
    taskId: string,
    runId: string,
  ): Promise<ResearchReport> {
    const { data, error } = await this.client
      .from("research_reports")
      .select("*")
      .eq("public_id", reportId)
      .single();
    ensureNoError(error, "读取新生成的调研报告");
    return mapReport(data as Row, taskId, runId);
  }
}
