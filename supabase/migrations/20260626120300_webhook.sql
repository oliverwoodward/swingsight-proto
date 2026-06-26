-- SwingSight — DB webhook → worker orchestration (Phase 2)
--
-- Flow (spec §7.2): app uploads the raw clip to R2, then writes/advances a
-- swing_analyses row to `queued` with its raw_object_key. THIS trigger fires the
-- `on-swing-insert` Edge Function (pg_net), which builds the AnalyzeRequest and
-- POSTs the Cloud Run worker /analyze. The function URL + shared webhook secret
-- live in Vault (set at provisioning), so nothing here is hardcoded and the
-- migration applies cleanly before any secret exists (it then no-ops).

create extension if not exists pg_net;
create extension if not exists supabase_vault;

-- Private schema for server-only plumbing; never exposed to anon/authenticated.
create schema if not exists private;
revoke all on schema private from anon, authenticated;

-- Fires the Edge Function for a freshly-queued, clip-attached swing.
create or replace function private.notify_worker_on_queued()
returns trigger
language plpgsql
security definer
set search_path = public, private, vault, net
as $$
declare
  base_url text;
  secret   text;
begin
  -- Only when the clip is uploaded AND the row has just entered `queued`.
  if new.status <> 'queued' or new.raw_object_key is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'queued' then
    return new;  -- already queued earlier; don't double-fire
  end if;

  -- Resolve the Edge Function base URL + webhook secret from Vault. Absent in
  -- local/un-provisioned environments => skip the call so inserts still succeed.
  select decrypted_secret into base_url
    from vault.decrypted_secrets where name = 'edge_function_base_url';
  if base_url is null then
    raise log 'notify_worker_on_queued: edge_function_base_url not set; skipping for analysis %', new.id;
    return new;
  end if;
  select decrypted_secret into secret
    from vault.decrypted_secrets where name = 'on_swing_insert_secret';

  perform net.http_post(
    url := base_url || '/functions/v1/on-swing-insert',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      -- Shared secret the Edge Function checks (it runs with verify_jwt = false).
      'x-webhook-secret', coalesce(secret, '')
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'swing_analyses',
      'schema', 'public',
      'record', to_jsonb(new)
    ),
    timeout_milliseconds := 5000
  );

  raise log 'notify_worker_on_queued: dispatched analysis %', new.id;
  return new;
end;
$$;

create trigger swing_analyses_notify_worker
  after insert or update on public.swing_analyses
  for each row execute function private.notify_worker_on_queued();
