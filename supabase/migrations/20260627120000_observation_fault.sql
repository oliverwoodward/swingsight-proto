-- ---------------------------------------------------------------------------
-- Tentative observation fault (spec §13.1; mirrors app/src/domain/types.ts
-- SwingAnalysis.observationFaultId + the worker MeasurementResult).
--
-- When no claim-eligible fault clears the bar, the worker surfaces the top fired
-- `soft_only` fault as a TENTATIVE observation (a separate channel from the verdict
-- in `primary_fault_id`, so the hard-vs-soft distinction stays explicit). The coaching
-- layer may hedge on it; it is never the primary claim. Worker-owned like the other
-- measured columns, so it is added to the column-guard freeze below.
-- ---------------------------------------------------------------------------

alter table public.swing_analyses
  add column if not exists observation_fault_id text;

-- Re-emit the column guard with observation_fault_id frozen from client writes
-- (mirror of guard_swing_analyses_update in 20260626120100_rls.sql; only the new
-- column is added — keep the rest in lockstep with that file).
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

  if new.playback_video_url    is distinct from old.playback_video_url
     or new.keypoints_meta     is distinct from old.keypoints_meta
     or new.faults             is distinct from old.faults
     or new.primary_fault_id   is distinct from old.primary_fault_id
     or new.observation_fault_id is distinct from old.observation_fault_id
     or new.score              is distinct from old.score
     or new.coaching           is distinct from old.coaching
     or new.quality            is distinct from old.quality
     or new.error_reason       is distinct from old.error_reason
     or new.view               is distinct from old.view
     or new.handedness         is distinct from old.handedness
     or new.profile_id         is distinct from old.profile_id then
    raise exception 'clients may not write worker-owned analysis fields'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;
