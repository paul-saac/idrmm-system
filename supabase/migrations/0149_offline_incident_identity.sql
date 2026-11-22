-- Intent: make retries of offline incident submissions idempotent without changing online reports.
ALTER TABLE public.project_safety_incidents ADD COLUMN IF NOT EXISTS offline_submission_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS project_safety_incidents_offline_submission_unique ON public.project_safety_incidents (reported_by, offline_submission_id) WHERE offline_submission_id IS NOT NULL;
