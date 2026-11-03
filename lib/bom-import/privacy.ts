/** Updated when the AI upload notice or acknowledgment materially changes. */
export const AI_IMPORT_NOTICE_VERSION = "2026-11-03";

export function hasAiImportAcknowledgment(formData: FormData): boolean {
  return formData.get("aiPrivacyAcknowledgment") === AI_IMPORT_NOTICE_VERSION;
}
