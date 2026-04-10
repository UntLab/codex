-- ============================================================
-- MIGRATION SCRIPT: FormagBaku CRM - Phase 7 Staff Capabilities
-- Adds DB-backed extra access domains for shared Sales/Operations users.
-- ============================================================

create extension if not exists pgcrypto;

create table if not exists public.staff_capability_overrides (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  capability text not null check (capability in ('Admin', 'HR', 'Sales', 'Operations')),
  created_at timestamptz not null default timezone('utc', now()),
  unique (staff_id, capability)
);

create index if not exists idx_staff_capability_overrides_staff_id
  on public.staff_capability_overrides (staff_id);

alter table public.staff_capability_overrides enable row level security;

drop policy if exists "staff_capability_overrides_select_own_or_admin" on public.staff_capability_overrides;
create policy "staff_capability_overrides_select_own_or_admin"
on public.staff_capability_overrides
for select
using (
  exists (
    select 1
    from public.staff viewer
    where viewer.auth_user_id = auth.uid()
      and (
        viewer.role in ('Admin', 'HR')
        or viewer.id = staff_capability_overrides.staff_id
      )
  )
);

drop policy if exists "staff_capability_overrides_manage_admin" on public.staff_capability_overrides;
create policy "staff_capability_overrides_manage_admin"
on public.staff_capability_overrides
for all
using (
  exists (
    select 1
    from public.staff viewer
    where viewer.auth_user_id = auth.uid()
      and viewer.role in ('Admin', 'HR')
  )
)
with check (
  exists (
    select 1
    from public.staff viewer
    where viewer.auth_user_id = auth.uid()
      and viewer.role in ('Admin', 'HR')
  )
);

insert into public.staff_capability_overrides (staff_id, capability)
select s.id, v.capability
from public.staff s
join (
  values
    ('sshakirova@formag.com', 'Operations'),
    ('irustamli@formag.com', 'Operations'),
    ('kaliyev@formag.com', 'Operations'),
    ('uabdullayev@formag.com', 'Operations')
) as v(email, capability)
  on lower(s.email) = v.email
on conflict (staff_id, capability) do nothing;

notify pgrst, 'reload schema';
