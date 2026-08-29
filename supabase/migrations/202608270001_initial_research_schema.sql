create extension if not exists pgcrypto;

create table public.research_tasks (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  user_id uuid references auth.users(id) on delete set null,
  topic text not null check (char_length(topic) between 3 and 160),
  competitors jsonb not null check (
    jsonb_typeof(competitors) = 'array'
    and jsonb_array_length(competitors) between 3 and 6
  ),
  focus text check (focus is null or char_length(focus) <= 500),
  status text not null default 'queued' check (
    status in ('queued', 'running', 'completed', 'failed', 'cancelled')
  ),
  current_step text check (
    current_step is null or current_step in (
      'planning', 'researching', 'extracting', 'analyzing',
      'generating', 'writing', 'reviewing'
    )
  ),
  error text,
  workflow_version text not null default 'v1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index research_tasks_user_created_idx
  on public.research_tasks (user_id, created_at desc, id desc);
create index research_tasks_status_created_idx
  on public.research_tasks (status, created_at, id);

create table public.workflow_runs (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  task_id bigint not null references public.research_tasks(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  worker_id text,
  locked_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);

create index workflow_runs_task_created_idx
  on public.workflow_runs (task_id, created_at desc, id desc);
create index workflow_runs_queue_idx
  on public.workflow_runs (created_at, id)
  where status = 'queued';
create unique index workflow_runs_one_active_per_task_idx
  on public.workflow_runs (task_id)
  where status in ('queued', 'running');

create table public.research_steps (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  run_id bigint not null references public.workflow_runs(id) on delete cascade,
  task_id bigint not null references public.research_tasks(id) on delete cascade,
  step_type text not null check (
    step_type in (
      'planning', 'researching', 'extracting', 'analyzing',
      'generating', 'writing', 'reviewing'
    )
  ),
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed')),
  input jsonb,
  output jsonb,
  error text,
  attempt integer not null default 1 check (attempt > 0),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index research_steps_run_created_idx
  on public.research_steps (run_id, created_at, id);
create index research_steps_task_created_idx
  on public.research_steps (task_id, created_at, id);

create table public.research_sources (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  task_id bigint not null references public.research_tasks(id) on delete cascade,
  product text not null,
  title text not null,
  url text not null,
  canonical_url text,
  source_type text not null default 'web',
  is_official boolean not null default false,
  retrieved_at timestamptz not null default now(),
  content_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index research_sources_task_created_idx
  on public.research_sources (task_id, created_at, id);
create index research_sources_task_product_idx
  on public.research_sources (task_id, product);

create table public.research_evidence (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  task_id bigint not null references public.research_tasks(id) on delete cascade,
  source_id bigint not null references public.research_sources(id) on delete cascade,
  product text not null,
  dimension text not null,
  value jsonb not null,
  evidence_text text not null,
  confidence numeric(4, 3) check (confidence is null or confidence between 0 and 1),
  created_at timestamptz not null default now()
);

create index research_evidence_task_dimension_idx
  on public.research_evidence (task_id, dimension, id);
create index research_evidence_source_idx
  on public.research_evidence (source_id, id);

create table public.research_reports (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  task_id bigint not null references public.research_tasks(id) on delete cascade,
  run_id bigint not null references public.workflow_runs(id) on delete cascade unique,
  revision integer not null default 1 check (revision > 0),
  title text not null,
  content text not null,
  structured_content jsonb not null,
  review_status text not null default 'not_reviewed' check (
    review_status in ('not_reviewed', 'passed', 'revision_requested')
  ),
  created_at timestamptz not null default now(),
  unique (task_id, revision)
);

create index research_reports_task_revision_idx
  on public.research_reports (task_id, revision desc, id desc);

create table public.usage_events (
  id bigint generated always as identity primary key,
  task_id bigint not null references public.research_tasks(id) on delete cascade,
  run_id bigint references public.workflow_runs(id) on delete cascade,
  provider text not null,
  model text,
  event_type text not null,
  input_tokens bigint check (input_tokens is null or input_tokens >= 0),
  output_tokens bigint check (output_tokens is null or output_tokens >= 0),
  estimated_cost numeric(14, 6) check (estimated_cost is null or estimated_cost >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index usage_events_task_created_idx
  on public.usage_events (task_id, created_at, id);
create index usage_events_run_created_idx
  on public.usage_events (run_id, created_at, id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger research_tasks_set_updated_at
before update on public.research_tasks
for each row execute function public.set_updated_at();

create or replace function public.create_research_task(
  task_topic text,
  task_competitors jsonb,
  task_focus text default null,
  task_user_id uuid default null
)
returns table (task_public_id uuid, run_public_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_internal_id bigint;
begin
  insert into public.research_tasks (user_id, topic, competitors, focus)
  values (task_user_id, task_topic, task_competitors, nullif(task_focus, ''))
  returning id, public_id into task_internal_id, task_public_id;

  insert into public.workflow_runs (task_id)
  values (task_internal_id)
  returning public_id into run_public_id;

  return next;
end;
$$;

create or replace function public.enqueue_research_task(task_public_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_internal_id bigint;
  new_run_public_id uuid;
begin
  select id into task_internal_id
  from public.research_tasks
  where public_id = task_public_id
  for update;

  if task_internal_id is null then
    raise exception 'Research task not found';
  end if;

  insert into public.workflow_runs (task_id)
  values (task_internal_id)
  returning public_id into new_run_public_id;

  update public.research_tasks
  set status = 'queued', current_step = null, error = null
  where id = task_internal_id;

  return new_run_public_id;
end;
$$;

create or replace function public.claim_next_workflow_run(worker_identity text)
returns table (
  run_public_id uuid,
  task_public_id uuid,
  run_status text,
  run_attempt_count integer,
  run_worker_id text,
  run_started_at timestamptz,
  run_finished_at timestamptz,
  run_created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate_id bigint;
  claimed_task_id bigint;
begin
  select id into candidate_id
  from public.workflow_runs
  where status = 'queued'
  order by created_at, id
  limit 1
  for update skip locked;

  if candidate_id is null then
    return;
  end if;

  update public.workflow_runs
  set status = 'running',
      attempt_count = attempt_count + 1,
      worker_id = worker_identity,
      locked_at = now(),
      started_at = coalesce(started_at, now()),
      error = null
  where id = candidate_id
  returning task_id, public_id, status, attempt_count, worker_id, started_at, finished_at, created_at
  into claimed_task_id, run_public_id, run_status, run_attempt_count, run_worker_id,
       run_started_at, run_finished_at, run_created_at;

  update public.research_tasks
  set status = 'running', current_step = 'generating', error = null
  where id = claimed_task_id
  returning public_id into task_public_id;

  return next;
end;
$$;

create or replace function public.begin_research_step(
  run_public_id uuid,
  task_public_id uuid,
  requested_step_type text,
  step_input jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_internal_id bigint;
  task_internal_id bigint;
  step_public_id uuid;
  next_attempt integer;
begin
  select r.id, r.task_id into run_internal_id, task_internal_id
  from public.workflow_runs r
  join public.research_tasks t on t.id = r.task_id
  where r.public_id = run_public_id
    and t.public_id = task_public_id
    and r.status = 'running';

  if run_internal_id is null then
    raise exception 'Active workflow run not found';
  end if;

  select coalesce(max(attempt), 0) + 1 into next_attempt
  from public.research_steps
  where run_id = run_internal_id and step_type = requested_step_type;

  insert into public.research_steps (
    run_id, task_id, step_type, status, input, attempt, started_at
  ) values (
    run_internal_id, task_internal_id, requested_step_type, 'running', step_input, next_attempt, now()
  ) returning public_id into step_public_id;

  update public.research_tasks
  set current_step = requested_step_type
  where id = task_internal_id;

  return step_public_id;
end;
$$;

create or replace function public.complete_research_workflow(
  task_public_id uuid,
  run_public_id uuid,
  step_public_id uuid,
  report_title text,
  report_content text,
  report_structured_content jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_internal_id bigint;
  run_internal_id bigint;
  report_public_id uuid;
  next_revision integer;
begin
  select r.task_id, r.id into task_internal_id, run_internal_id
  from public.workflow_runs r
  join public.research_tasks t on t.id = r.task_id
  where r.public_id = run_public_id
    and t.public_id = task_public_id
    and r.status = 'running'
  for update of r;

  if run_internal_id is null then
    raise exception 'Active workflow run not found';
  end if;

  select coalesce(max(revision), 0) + 1 into next_revision
  from public.research_reports
  where task_id = task_internal_id;

  insert into public.research_reports (
    task_id, run_id, revision, title, content, structured_content
  ) values (
    task_internal_id, run_internal_id, next_revision, report_title,
    report_content, report_structured_content
  ) returning public_id into report_public_id;

  update public.research_steps
  set status = 'completed', output = report_structured_content, finished_at = now(), error = null
  where public_id = step_public_id and run_id = run_internal_id;

  update public.workflow_runs
  set status = 'completed', finished_at = now(), locked_at = null, error = null
  where id = run_internal_id;

  update public.research_tasks
  set status = 'completed', current_step = null, error = null
  where id = task_internal_id;

  return report_public_id;
end;
$$;

create or replace function public.fail_research_workflow(
  task_public_id uuid,
  run_public_id uuid,
  failure_message text,
  step_public_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_internal_id bigint;
  run_internal_id bigint;
begin
  select r.task_id, r.id into task_internal_id, run_internal_id
  from public.workflow_runs r
  join public.research_tasks t on t.id = r.task_id
  where r.public_id = run_public_id and t.public_id = task_public_id
  for update of r;

  if run_internal_id is null then
    raise exception 'Workflow run not found';
  end if;

  if step_public_id is not null then
    update public.research_steps
    set status = 'failed', error = failure_message, finished_at = now()
    where public_id = step_public_id and run_id = run_internal_id;
  end if;

  update public.workflow_runs
  set status = 'failed', error = failure_message, finished_at = now(), locked_at = null
  where id = run_internal_id;

  update public.research_tasks
  set status = 'failed', error = failure_message
  where id = task_internal_id;
end;
$$;

alter table public.research_tasks enable row level security;
alter table public.workflow_runs enable row level security;
alter table public.research_steps enable row level security;
alter table public.research_sources enable row level security;
alter table public.research_evidence enable row level security;
alter table public.research_reports enable row level security;
alter table public.usage_events enable row level security;

create policy research_tasks_select_own on public.research_tasks
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy workflow_runs_select_own on public.workflow_runs
  for select to authenticated
  using (exists (
    select 1 from public.research_tasks t
    where t.id = task_id and t.user_id = (select auth.uid())
  ));

create policy research_steps_select_own on public.research_steps
  for select to authenticated
  using (exists (
    select 1 from public.research_tasks t
    where t.id = task_id and t.user_id = (select auth.uid())
  ));

create policy research_sources_select_own on public.research_sources
  for select to authenticated
  using (exists (
    select 1 from public.research_tasks t
    where t.id = task_id and t.user_id = (select auth.uid())
  ));

create policy research_evidence_select_own on public.research_evidence
  for select to authenticated
  using (exists (
    select 1 from public.research_tasks t
    where t.id = task_id and t.user_id = (select auth.uid())
  ));

create policy research_reports_select_own on public.research_reports
  for select to authenticated
  using (exists (
    select 1 from public.research_tasks t
    where t.id = task_id and t.user_id = (select auth.uid())
  ));

create policy usage_events_select_own on public.usage_events
  for select to authenticated
  using (exists (
    select 1 from public.research_tasks t
    where t.id = task_id and t.user_id = (select auth.uid())
  ));

revoke all on function public.create_research_task(text, jsonb, text, uuid) from public, anon, authenticated;
revoke all on function public.enqueue_research_task(uuid) from public, anon, authenticated;
revoke all on function public.claim_next_workflow_run(text) from public, anon, authenticated;
revoke all on function public.begin_research_step(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.complete_research_workflow(uuid, uuid, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.fail_research_workflow(uuid, uuid, text, uuid) from public, anon, authenticated;

grant execute on function public.create_research_task(text, jsonb, text, uuid) to service_role;
grant execute on function public.enqueue_research_task(uuid) to service_role;
grant execute on function public.claim_next_workflow_run(text) to service_role;
grant execute on function public.begin_research_step(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.complete_research_workflow(uuid, uuid, uuid, text, text, jsonb) to service_role;
grant execute on function public.fail_research_workflow(uuid, uuid, text, uuid) to service_role;
