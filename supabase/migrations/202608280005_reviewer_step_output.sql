create or replace function public.complete_research_workflow(
  task_public_id uuid,
  run_public_id uuid,
  step_public_id uuid,
  report_title text,
  report_content text,
  report_structured_content jsonb,
  final_step_output jsonb
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
  set status = 'completed', output = final_step_output, finished_at = now(), error = null
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

revoke all on function public.complete_research_workflow(uuid, uuid, uuid, text, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.complete_research_workflow(uuid, uuid, uuid, text, text, jsonb, jsonb)
  to service_role;
