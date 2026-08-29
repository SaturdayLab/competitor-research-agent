alter table public.research_tasks
  drop constraint if exists research_tasks_current_step_check;

alter table public.research_tasks
  add constraint research_tasks_current_step_check
  check (
    current_step is null or current_step in (
      'planning', 'researching', 'extracting', 'gap_filling',
      'analyzing', 'generating', 'writing', 'reviewing'
    )
  );

alter table public.research_steps
  drop constraint if exists research_steps_step_type_check;

alter table public.research_steps
  add constraint research_steps_step_type_check
  check (
    step_type in (
      'planning', 'researching', 'extracting', 'gap_filling',
      'analyzing', 'generating', 'writing', 'reviewing'
    )
  );
