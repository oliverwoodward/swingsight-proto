-- SwingSight — Row Level Security (Phase 2)
-- Every device is its own anonymous-auth user; RLS partitions all data by
-- auth.uid(). The service role (worker + Edge Functions) bypasses RLS to write
-- measured results. Reference data (fault_library, drills) is world-readable;
-- validation_set is service-role-only.

-- ---------------------------------------------------------------------------
-- profiles — owner-only, keyed on the PK = auth.uid()
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "profiles_delete_own" on public.profiles
  for delete to authenticated using (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- swing_analyses — owner-only. The owner inserts (uploading) and advances to
-- queued; the worker (service role, RLS-bypass) writes every measured field.
-- A BEFORE UPDATE guard (below) stops the owner forging worker-owned columns.
-- ---------------------------------------------------------------------------
alter table public.swing_analyses enable row level security;

create policy "swing_analyses_select_own" on public.swing_analyses
  for select to authenticated using (profile_id = (select auth.uid()));
create policy "swing_analyses_insert_own" on public.swing_analyses
  for insert to authenticated with check (profile_id = (select auth.uid()));
create policy "swing_analyses_update_own" on public.swing_analyses
  for update to authenticated
  using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));
create policy "swing_analyses_delete_own" on public.swing_analyses
  for delete to authenticated using (profile_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Child tables (metrics / keyframes / keypoints) — readable by the analysis
-- owner; only the worker (service role) writes them. No insert/update/delete
-- policy for users => those commands are denied for non-bypass roles.
-- ---------------------------------------------------------------------------
alter table public.swing_metrics enable row level security;
create policy "swing_metrics_select_own" on public.swing_metrics
  for select to authenticated using (
    exists (
      select 1 from public.swing_analyses a
      where a.id = analysis_id and a.profile_id = (select auth.uid())
    )
  );

alter table public.swing_keyframes enable row level security;
create policy "swing_keyframes_select_own" on public.swing_keyframes
  for select to authenticated using (
    exists (
      select 1 from public.swing_analyses a
      where a.id = analysis_id and a.profile_id = (select auth.uid())
    )
  );

alter table public.swing_keypoints enable row level security;
create policy "swing_keypoints_select_own" on public.swing_keypoints
  for select to authenticated using (
    exists (
      select 1 from public.swing_analyses a
      where a.id = analysis_id and a.profile_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- drill_recheck — owner-readable; written by the worker (service role).
-- ---------------------------------------------------------------------------
alter table public.drill_recheck enable row level security;
create policy "drill_recheck_select_own" on public.drill_recheck
  for select to authenticated using (profile_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Reference data — world-readable, never client-writable.
-- ---------------------------------------------------------------------------
alter table public.fault_library enable row level security;
create policy "fault_library_read" on public.fault_library
  for select to anon, authenticated using (true);

alter table public.drills enable row level security;
create policy "drills_read" on public.drills
  for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- validation_set — service-role only. RLS on with NO policy => denied to
-- anon/authenticated; the service role bypasses RLS.
-- ---------------------------------------------------------------------------
alter table public.validation_set enable row level security;

-- ---------------------------------------------------------------------------
-- Column guard: an authenticated owner may only insert a swing and advance it
-- uploading -> queued (and set its raw_object_key). All measured/worker-owned
-- columns are frozen from client updates so no fabricated analysis can be
-- written from the device. The service role (worker) is exempt.
-- ---------------------------------------------------------------------------
create or replace function public.guard_swing_analyses_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  jwt_role text := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
begin
  -- Trusted writers (service role via key, or direct SQL with no JWT context).
  if jwt_role is null or jwt_role = 'service_role' then
    return new;
  end if;

  -- End-user (authenticated) update: only the pre-processing handoff is allowed.
  if new.status is distinct from old.status
     and new.status not in ('uploading', 'queued') then
    raise exception 'clients may only advance status to queued (got %)', new.status
      using errcode = 'check_violation';
  end if;

  if new.playback_video_url   is distinct from old.playback_video_url
     or new.keypoints_meta    is distinct from old.keypoints_meta
     or new.faults            is distinct from old.faults
     or new.primary_fault_id  is distinct from old.primary_fault_id
     or new.score             is distinct from old.score
     or new.coaching          is distinct from old.coaching
     or new.quality           is distinct from old.quality
     or new.error_reason      is distinct from old.error_reason
     or new.view              is distinct from old.view
     or new.handedness        is distinct from old.handedness
     or new.profile_id        is distinct from old.profile_id then
    raise exception 'clients may not write worker-owned analysis fields'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger swing_analyses_guard_update
  before update on public.swing_analyses
  for each row execute function public.guard_swing_analyses_update();
