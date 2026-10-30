"use server";

import { getSessionProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { backupConfig, UUID } from "./package.mjs";
import type { BackupStatus } from "./types";

async function recoveryClient() {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== "super_admin") throw new Error("Only Super Administrators can access backup and restore.");
  return { profile, client: await createClient() };
}

export async function getBackupStatus(): Promise<BackupStatus> {
  const { profile, client } = await recoveryClient();
  let configurationError: string | null = null, keyId: string | null = null;
  try { keyId = backupConfig().keyId; } catch (error) {
    configurationError = error instanceof Error ? error.message : "The backup worker needs configuration.";
  }
  const { data, error } = await client.rpc("system_backup_status");
  if (error || !data) {
    return {
      state: { maintenance: false, recovery_required: false, worker_ready: false, worker_heartbeat: null, worker_message: "Backup and restore is not available.", schedule_description: "" },
      snapshots: [], jobs: [], workerOnline: false, configurationError, actorId: profile.id, keyId,
      error: error && ["PGRST202", "42883"].includes(error.code) ? "Apply migration 0105 to enable backup and restore." : "Could not load backup status. Please try again.",
    };
  }
  const status = data as unknown as Pick<BackupStatus, "state" | "snapshots" | "jobs">;
  const heartbeat = status.state.worker_heartbeat;
  return { ...status, workerOnline: Boolean(status.state.worker_ready && heartbeat && Date.now() - Date.parse(heartbeat) < 60000), configurationError, actorId: profile.id, keyId };
}

export async function requestBackup(): Promise<{ error?: string; success?: boolean }> {
  try {
    const { client } = await recoveryClient();
    backupConfig();
    const { error } = await client.rpc("system_backup_request", { p_kind: "backup" });
    if (error) return { error: ["P0001", "42501"].includes(error.code) ? error.message : "Could not queue the backup. Check migration 0105 and the worker status." };
    return { success: true };
  } catch (error) { return { error: error instanceof Error ? error.message : "Could not queue the backup." }; }
}

export async function requestRestore(id: string, confirmation: string): Promise<{ error?: string; success?: boolean }> {
  try {
    const { profile, client } = await recoveryClient();
    if (!UUID.test(id) || confirmation !== `RESTORE ${id.slice(0, 8)}`) return { error: "Enter the restore confirmation exactly as shown." };
    const config = backupConfig();
    const { data, error: readError } = await client.rpc("system_backup_status");
    const status = data as unknown as BackupStatus | null;
    const snapshot = status?.snapshots.find(item => item.id === id);
    if (readError || !snapshot || snapshot.key_id !== config.keyId || !snapshot.recovery_admin_ids.includes(profile.id)) return { error: "Choose a backup containing your active Super Administrator account and matching the configured encryption key." };
    const { error } = await client.rpc("system_backup_request", { p_kind: "restore", p_snapshot_id: id, p_confirmation: confirmation });
    if (error) return { error: ["P0001", "42501"].includes(error.code) ? error.message : "Could not queue the restore. Please try again." };
    return { success: true };
  } catch (error) { return { error: error instanceof Error ? error.message : "Could not queue the restore." }; }
}
