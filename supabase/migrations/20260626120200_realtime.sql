-- SwingSight — Realtime (Phase 2)
-- The app subscribes to its swing_analyses row and watches the status state
-- machine (uploading -> queued -> processing -> complete|failed|unreadable)
-- plus the result payload land live. RLS still applies to Realtime, so a user
-- only ever receives changes to their own rows.

-- REPLICA IDENTITY FULL so UPDATE events carry the whole row (not just the PK),
-- letting the client read the full analysis on the terminal status change.
alter table public.swing_analyses replica identity full;

-- Add the table to Supabase's Realtime publication (created by the platform).
alter publication supabase_realtime add table public.swing_analyses;
