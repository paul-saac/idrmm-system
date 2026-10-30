export type BackupSnapshot = {
  id: string;
  created_at: string;
  created_by_name: string;
  purpose: "manual" | "scheduled" | "safety";
  size_bytes: number;
  table_count: number;
  file_count: number;
  key_id: string;
  recovery_admin_ids: string[];
};
export type BackupJob = {
  id: string;
  kind: "backup" | "restore";
  status: "queued" | "running" | "completed" | "failed";
  phase: string;
  requested_at: string;
  finished_at: string | null;
  error: string | null;
  snapshot_id: string | null;
  safety_snapshot_id: string | null;
};
export type BackupStatus = {
  state: {
    maintenance: boolean;
    recovery_required: boolean;
    worker_ready: boolean;
    worker_heartbeat: string | null;
    worker_message: string;
    schedule_description: string;
  };
  snapshots: BackupSnapshot[];
  jobs: BackupJob[];
  workerOnline: boolean;
  configurationError: string | null;
  actorId: string;
  keyId: string | null;
  error?: string;
};
