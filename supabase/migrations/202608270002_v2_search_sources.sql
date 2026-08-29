alter table public.research_sources
  add column if not exists run_id bigint references public.workflow_runs(id) on delete cascade;

alter table public.research_sources
  add column if not exists snippet text not null default '';

create index if not exists research_sources_run_id_idx
  on public.research_sources (run_id, id);

create unique index if not exists research_sources_run_canonical_url_idx
  on public.research_sources (run_id, canonical_url);

create or replace function public.complete_research_step(
  step_public_id uuid,
  step_output jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_step_id bigint;
begin
  update public.research_steps s
  set status = 'completed',
      output = step_output,
      error = null,
      finished_at = now()
  from public.workflow_runs r
  where s.public_id = step_public_id
    and s.run_id = r.id
    and s.status = 'running'
    and r.status = 'running'
  returning s.id into updated_step_id;

  if updated_step_id is null then
    raise exception 'Active research step not found';
  end if;
end;
$$;

revoke all on function public.complete_research_step(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.complete_research_step(uuid, jsonb)
  to service_role;

