-- Intent: two-state incident closeout, verified by project managers or administrators.
-- Existing reports stay Open. Preserve original incident details and evidence.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.project_safety_incidents ADD COLUMN closeout jsonb;
ALTER TABLE public.project_safety_incidents ADD CONSTRAINT incident_closeout_object
  CHECK (closeout IS NULL OR (jsonb_typeof(closeout) = 'object'
    AND closeout ?& ARRAY['findings','actionTaken','attachments','closedBy','closedByName','closedAt']));
-- Incident records remain immutable to direct client updates; closure is an atomic RPC.
REVOKE UPDATE ON public.project_safety_incidents FROM authenticated, anon;
CREATE FUNCTION public.guard_incident_closeout_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
 IF NEW.closeout IS NOT NULL THEN RAISE EXCEPTION 'Submit the incident before closing it'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER guard_incident_closeout_insert BEFORE INSERT ON public.project_safety_incidents
 FOR EACH ROW EXECUTE FUNCTION public.guard_incident_closeout_insert();

CREATE FUNCTION public.close_safety_incident(p_project_id bigint, p_incident_id bigint,
 p_findings text, p_action_taken text, p_attachments jsonb DEFAULT '[]'::jsonb)
RETURNS public.project_safety_incidents LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_incident public.project_safety_incidents; v_file jsonb; v_name text; v_path text; v_total bigint := 0; v_files jsonb := '[]'::jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.app_session_is_active() OR COALESCE(public.get_my_role()::text,'') NOT IN ('project_manager','admin','super_admin')
   OR COALESCE(public.project_access_level(p_project_id),'none') <> 'edit'
   OR NOT public.can_access_safety_incidents(p_project_id)
 THEN RAISE EXCEPTION 'Only the Project Manager or Administrator with project edit access can close this incident'; END IF;
 IF public.system_backup_maintenance() THEN RAISE EXCEPTION 'Saving is temporarily paused during backup or recovery'; END IF;
 IF length(btrim(COALESCE(p_findings,''))) NOT BETWEEN 1 AND 5000 OR length(btrim(COALESCE(p_action_taken,''))) NOT BETWEEN 1 AND 5000
 THEN RAISE EXCEPTION 'Investigation findings and action taken are required (up to 5,000 characters each)'; END IF;
 SELECT * INTO v_incident FROM public.project_safety_incidents WHERE id=p_incident_id AND project_id=p_project_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Incident not found'; END IF;
 IF v_incident.closeout IS NOT NULL THEN RAISE EXCEPTION 'This incident has already been closed'; END IF;
 IF p_attachments IS NULL OR jsonb_typeof(p_attachments) <> 'array' OR jsonb_array_length(p_attachments)>5
 THEN RAISE EXCEPTION 'Include up to 5 supporting attachments'; END IF;
 FOR v_file IN SELECT value FROM jsonb_array_elements(p_attachments) LOOP
   v_path := v_file->>'path';
   IF v_path IS NULL OR left(v_path,length(p_project_id::text || '/' || auth.uid()::text || '/')) <> p_project_id::text || '/' || auth.uid()::text || '/'
     OR COALESCE(v_file->>'type','') NOT IN ('image/jpeg','image/png','application/pdf')
     OR length(COALESCE(v_file->>'name','')) NOT BETWEEN 1 AND 200
     OR COALESCE(v_file->>'size','') !~ '^[0-9]{1,8}$'
   THEN RAISE EXCEPTION 'Invalid supporting attachment'; END IF;
   IF (v_file->>'size')::bigint NOT BETWEEN 1 AND 10485760 THEN RAISE EXCEPTION 'Supporting attachment exceeds the size limit'; END IF;
   v_total := v_total + (v_file->>'size')::bigint;
   v_files := v_files || jsonb_build_array(jsonb_build_object('path',v_path,'name',v_file->>'name','type',v_file->>'type','size',(v_file->>'size')::bigint));
   IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='incident-evidence' AND name=v_path)
   THEN RAISE EXCEPTION 'Supporting attachment upload not found'; END IF;
 END LOOP;
 IF v_total>15728640 THEN RAISE EXCEPTION 'Attachments must total 15 MB or less'; END IF;
 SELECT trim(concat_ws(' ',first_name,last_name)) INTO v_name FROM public.profiles WHERE id=auth.uid();
 UPDATE public.project_safety_incidents SET closeout=jsonb_build_object(
  'findings',btrim(p_findings),'actionTaken',btrim(p_action_taken),'attachments',v_files,
  'closedBy',auth.uid(),'closedByName',v_name,'closedAt',now())
 WHERE id=p_incident_id AND project_id=p_project_id RETURNING * INTO v_incident;
 RETURN v_incident;
END;
$$;
REVOKE ALL ON FUNCTION public.close_safety_incident(bigint,bigint,text,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_safety_incident(bigint,bigint,text,text,jsonb) TO authenticated;
-- The original delete policies also need to protect attached closeout evidence.
CREATE POLICY "Keep attached incident closeout evidence" ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated USING (
 bucket_id <> 'incident-evidence' OR NOT EXISTS (
  SELECT 1 FROM public.project_safety_incidents i
  WHERE i.closeout->'attachments' @> jsonb_build_array(jsonb_build_object('path',storage.objects.name))
 )
);
NOTIFY pgrst, 'reload schema';
COMMIT;
