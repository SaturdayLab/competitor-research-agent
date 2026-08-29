alter table public.research_tasks
  drop constraint if exists research_tasks_competitors_check;

alter table public.research_tasks
  add constraint research_tasks_competitors_check check (
    jsonb_typeof(competitors) = 'array'
    and jsonb_array_length(competitors) between 2 and 6
  );
