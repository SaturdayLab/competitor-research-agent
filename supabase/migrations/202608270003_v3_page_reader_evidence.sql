alter table public.research_sources
  add column if not exists extracted_text text;

alter table public.research_sources
  add column if not exists fetch_status text not null default 'pending';

alter table public.research_sources
  add column if not exists fetch_error text;

alter table public.research_sources
  drop constraint if exists research_sources_fetch_status_check;

alter table public.research_sources
  add constraint research_sources_fetch_status_check
  check (fetch_status in ('pending', 'ok', 'skipped'));
