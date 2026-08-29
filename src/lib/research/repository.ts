import type {
  CreateResearchInput,
  FetchStatus,
  ResearchDraft,
  ResearchEvidence,
  ResearchReport,
  ResearchSource,
  ResearchStep,
  ResearchTask,
  ResearchTaskDetail,
  StepType,
  WorkflowRun,
} from "@/lib/domain/research";

export type SaveResearchSourceInput = Omit<
  ResearchSource,
  "id" | "taskId" | "runId" | "retrievedAt" | "extractedText" | "fetchStatus" | "fetchError"
>;

export interface UpdateSourceFetchInput {
  fetchStatus: FetchStatus;
  extractedText?: string | null;
  fetchError?: string | null;
  contentHash?: string | null;
}

export interface SaveResearchEvidenceInput {
  sourceId: string;
  product: string;
  dimension: string;
  value: unknown;
  evidenceText: string;
  confidence?: number | null;
}

export interface CompleteWorkflowInput {
  taskId: string;
  runId: string;
  stepId: string;
  draft: ResearchDraft;
  markdown: string;
  reviewStatus?: ResearchReport["reviewStatus"];
  finalStepOutput?: unknown;
}

export interface FailWorkflowInput {
  taskId: string;
  runId: string;
  stepId: string | null;
  error: string;
}

export type ResearchRunBundle = {
  task: ResearchTask;
  run: WorkflowRun;
  steps: ResearchStep[];
  report: ResearchReport | null;
  sources: ResearchSource[];
  evidence: ResearchEvidence[];
};

export interface ResearchRepository {
  getRunBundle(runId: string): Promise<ResearchRunBundle | null>;
  createTask(input: CreateResearchInput, userId?: string | null): Promise<ResearchTask>;
  enqueueTask(taskId: string): Promise<WorkflowRun>;
  claimNextRun(workerId: string): Promise<WorkflowRun | null>;
  getTask(taskId: string): Promise<ResearchTask | null>;
  getTaskDetail(taskId: string): Promise<ResearchTaskDetail | null>;
  getReport(taskId: string): Promise<ResearchReport | null>;
  listTasks(limit?: number): Promise<ResearchTask[]>;
  beginStep(
    runId: string,
    taskId: string,
    stepType: StepType,
    input: unknown,
  ): Promise<ResearchStep>;
  completeStep(stepId: string, output: unknown): Promise<void>;
  saveSources(
    taskId: string,
    runId: string,
    sources: SaveResearchSourceInput[],
  ): Promise<ResearchSource[]>;
  listSources(taskId: string, runId?: string): Promise<ResearchSource[]>;
  updateSourceFetch(sourceId: string, patch: UpdateSourceFetchInput): Promise<ResearchSource>;
  saveEvidence(taskId: string, items: SaveResearchEvidenceInput[]): Promise<ResearchEvidence[]>;
  listEvidence(taskId: string, runId?: string): Promise<ResearchEvidence[]>;
  completeWorkflow(input: CompleteWorkflowInput): Promise<ResearchReport>;
  failWorkflow(input: FailWorkflowInput): Promise<void>;
}
