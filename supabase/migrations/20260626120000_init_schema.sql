-- SwingSight — core schema (Phase 2)
-- Mirrors the domain contract in app/src/domain/types.ts 1:1. The cloud worker
-- writes JSON that conforms to these shapes; the report UI reads them.
--
-- Governing law: CV measures, the AI explains, the fault library localises.
-- Nothing the LLM returns is allowed to set joints, frames, or the score — so the
-- score / coaching live in jsonb the worker fills, never client-writable past insert.

-- ---------------------------------------------------------------------------
-- Enums (each mirrors a union in domain/types.ts)
-- ---------------------------------------------------------------------------

create type public.handedness as enum ('RH', 'LH');

create type public.swing_view as enum ('face_on', 'dtl');

create type public.analysis_status as enum (
  'uploading', 'queued', 'processing', 'complete', 'failed', 'unreadable'
);

create type public.swing_event_name as enum (
  'address', 'toe_up', 'mid_backswing', 'top',
  'mid_downswing', 'impact', 'mid_follow_through', 'finish'
);

create type public.reliability as enum ('reliable', 'approximate', 'excluded');

create type public.metric_status as enum (
  'ok', 'unmeasurable_view', 'low_confidence', 'implausible'
);

create type public.metric_unit as enum (
  'deg', 'cm', 'ratio', 'fraction', 'seconds', 'count'
);

create type public.improvement_direction as enum ('increase', 'decrease');

-- ---------------------------------------------------------------------------
-- updated_at touch trigger (shared)
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles — one row per anonymous-auth user. PK = auth.uid() (the device user).
-- UserProfile in types.ts. completeOnboarding() makes profile.id = auth.uid().
-- ---------------------------------------------------------------------------

create table public.profiles (
  id                            uuid primary key references auth.users (id) on delete cascade,
  handedness                    public.handedness not null,
  -- The view the user most recently chose; remembered as the capture default.
  preferred_view                public.swing_view not null,
  -- Analysis is blocked until consent is recorded (nullable mirrors `string | null`).
  consent_accepted_at           timestamptz,
  -- Separate, opt-in consent for training use of swings (spec §13/§21).
  training_consent_accepted_at  timestamptz,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- fault_library — versioned reference data (spec §14.2 / domain/faultLibrary.ts).
-- Read by everyone (authenticated); only the service role writes it. Composite PK
-- (id, version) keeps prior versions for audit/validation regression.
-- ---------------------------------------------------------------------------

create table public.fault_library (
  id                text not null,
  version           text not null,
  name              text not null,
  views             public.swing_view[] not null,
  severity_weight   double precision not null,
  -- FaultGate { metricKey, operator, threshold, requires3d, minKeypointConfidence }
  gate              jsonb not null,
  -- HighlightRule { joints[], phaseWindow{ start, end } }
  highlight         jsonb not null,
  explanation_hook  text not null,
  ball_flight_hook  text,
  headline_template text not null,
  why_template      text not null,
  drill_ids         text[] not null default '{}',
  created_at        timestamptz not null default now(),
  primary key (id, version)
);

-- ---------------------------------------------------------------------------
-- drills — vetted drill catalogue (Drill in types.ts). Reference data.
-- ---------------------------------------------------------------------------

create table public.drills (
  id                    text primary key,
  title                 text not null,
  steps                 text[] not null,
  target_metric_key     text not null,
  improvement_direction public.improvement_direction not null,
  created_at            timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- swing_analyses — the analysis aggregate root (SwingAnalysis in types.ts).
-- Heavy per-frame/per-metric data lives in child tables; the worker-computed
-- sub-objects that have no child table (score, coaching, quality, faults,
-- keypoints meta) are jsonb the worker fills before flipping status to a
-- terminal state. They are null/absent until measured — never fabricated.
-- ---------------------------------------------------------------------------

create table public.swing_analyses (
  id                    uuid primary key default gen_random_uuid(),
  profile_id            uuid not null references public.profiles (id) on delete cascade,
  view                  public.swing_view not null,
  -- Snapshot of handedness at capture time.
  handedness            public.handedness not null,
  status                public.analysis_status not null default 'uploading',
  -- R2 object key of the uploaded raw clip (set by the app on insert).
  raw_object_key        text,
  -- The worker's H.264 playback clip in R2 (set once complete).
  playback_video_url    text,
  -- KeypointSeries meta (topology/videoWidth/videoHeight/fps); per-frame landmarks
  -- live in swing_keypoints. Null until pose runs.
  keypoints_meta        jsonb,
  -- FaultEvaluation[] — the open/closed gates. (No child table per spec §16.1.)
  faults                jsonb not null default '[]'::jsonb,
  primary_fault_id      text,
  -- SwingScore { value, confidence, withheld, contributions[] }. Null until scored.
  score                 jsonb,
  -- CoachingResult { source, chosenFaultId, headline, why, ... }. Null until Phase 5.
  coaching              jsonb,
  -- QualityReport { ok, reason?, meanKeypointConfidence, guidance? }. Null until measured.
  quality               jsonb,
  fault_library_version text not null default '2026.06.0',
  -- Present when status = 'failed'.
  error_reason          text,
  -- For the drill-recheck comparison (links to a prior same-view analysis).
  previous_analysis_id  uuid references public.swing_analyses (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index swing_analyses_profile_idx
  on public.swing_analyses (profile_id, created_at desc);
create index swing_analyses_status_idx
  on public.swing_analyses (status);

create trigger swing_analyses_set_updated_at
  before update on public.swing_analyses
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- swing_metrics — one row per measured metric (Metric in types.ts).
-- Lightweight, retained long for trend/progress (spec §21).
-- ---------------------------------------------------------------------------

create table public.swing_metrics (
  id              bigint generated always as identity primary key,
  analysis_id     uuid not null references public.swing_analyses (id) on delete cascade,
  metric_key      text not null,
  label           text not null,
  value           double precision not null,
  unit            public.metric_unit not null,
  status          public.metric_status not null,
  reliability_tag public.reliability not null,
  confidence      double precision not null,
  ideal           double precision not null,
  friendly_min    double precision not null,
  friendly_max    double precision not null,
  in_range        boolean not null,
  unique (analysis_id, metric_key)
);

create index swing_metrics_analysis_idx on public.swing_metrics (analysis_id);

-- ---------------------------------------------------------------------------
-- swing_keyframes — detected events + their key-frame JPEGs (SwingEvent in
-- types.ts; spec §16.1 swing_keyframes). One row per event.
-- ---------------------------------------------------------------------------

create table public.swing_keyframes (
  id               bigint generated always as identity primary key,
  analysis_id      uuid not null references public.swing_analyses (id) on delete cascade,
  event_name       public.swing_event_name not null,
  frame_index      integer not null,
  -- Seconds from clip start (SwingEvent.t).
  t                double precision not null,
  -- Event-localisation confidence in [0,1] (SwingEvent.confidence).
  confidence       double precision not null,
  -- R2 key of the downsized key-frame JPEG (set at output assembly; null until then).
  frame_object_key text,
  unique (analysis_id, event_name)
);

create index swing_keyframes_analysis_idx on public.swing_keyframes (analysis_id);

-- ---------------------------------------------------------------------------
-- swing_keypoints — per-frame pose for the skeleton overlay (KeypointFrame in
-- types.ts). One row PER FRAME with the 33 landmarks as jsonb (compact; the
-- overlay consumes the whole KeypointSeries.frames at once). This deviates from
-- the spec's illustrative one-row-per-joint shape (§16.1 notes the fields are
-- "illustrative, to be refined at build") — per-frame jsonb is ~33x fewer rows
-- and maps straight onto KeypointFrame { t, landmarks: Keypoint[] }.
-- ---------------------------------------------------------------------------

create table public.swing_keypoints (
  id          bigint generated always as identity primary key,
  analysis_id uuid not null references public.swing_analyses (id) on delete cascade,
  frame_index integer not null,
  -- Seconds from clip start (KeypointFrame.t).
  t           double precision not null,
  -- Keypoint[] length 33, each { x, y, visibility } in BlazePose image space [0,1].
  landmarks   jsonb not null,
  unique (analysis_id, frame_index)
);

create index swing_keypoints_analysis_idx on public.swing_keypoints (analysis_id, frame_index);

-- ---------------------------------------------------------------------------
-- drill_recheck — links a prior fault/metric to a follow-up swing's value
-- (DrillRecheck in types.ts; spec §16.1). Powers the drill-then-recheck loop.
-- ---------------------------------------------------------------------------

create table public.drill_recheck (
  id                   bigint generated always as identity primary key,
  profile_id           uuid not null references public.profiles (id) on delete cascade,
  drill_id             text not null references public.drills (id),
  target_metric_key    text not null,
  previous_analysis_id uuid not null references public.swing_analyses (id) on delete cascade,
  current_analysis_id  uuid not null references public.swing_analyses (id) on delete cascade,
  previous_value       double precision not null,
  current_value        double precision not null,
  delta                double precision not null,
  improved             boolean not null,
  created_at           timestamptz not null default now()
);

create index drill_recheck_profile_idx on public.drill_recheck (profile_id, created_at desc);

-- ---------------------------------------------------------------------------
-- validation_set — golden swings + coach labels for per-fault regression
-- (spec §13.1 / §16.1). Service-role only; never client-accessible.
-- ---------------------------------------------------------------------------

create table public.validation_set (
  id                       bigint generated always as identity primary key,
  label                    text not null,
  description              text,
  view                     public.swing_view not null,
  handedness               public.handedness not null,
  raw_object_key           text,
  expected_primary_fault_id text,
  coach_labels             jsonb,
  created_at               timestamptz not null default now()
);
