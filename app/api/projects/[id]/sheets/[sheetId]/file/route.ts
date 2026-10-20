import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth/session";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; sheetId: string }> }) {
  if (!(await getSessionProfile())) return new Response("Not authenticated", { status: 401 });
  const { id, sheetId } = await params;
  if (!/^\d+$/.test(id) || !/^\d+$/.test(sheetId) || !Number.isSafeInteger(Number(id)) || !Number.isSafeInteger(Number(sheetId))) return new Response("Invalid document", { status: 400 });
  const client = await createClient();
  // Session-client RLS checks project membership on both record and private file.
  const { data: sheet, error } = await client.from("project_sheets").select("file_path,file_name").eq("id", Number(sheetId)).eq("project_id", Number(id)).maybeSingle();
  if (error || !sheet) return new Response("Document not found", { status: 404 });
  const { data: file, error: fileError } = await client.storage.from("project-sheets").download(sheet.file_path);
  if (fileError || !file) return new Response("File unavailable", { status: 404 });
  const contentType = sheet.file_path.endsWith(".pdf") ? "application/pdf" : sheet.file_path.endsWith(".png") ? "image/png" : "image/jpeg";
  const disposition = new URL(request.url).searchParams.has("download") ? "attachment" : "inline";
  return new Response(file, { headers: {
    "Content-Type": contentType,
    "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(sheet.file_name).replace(/'/g, "%27")}`,
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
  } });
}
