import { requireProjectAccess } from "@/lib/auth/project-access";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
 const url = new URL(request.url);
 const projectId = Number(url.searchParams.get("projectId"));
 const path = url.searchParams.get("path") ?? "";
 if (!Number.isSafeInteger(projectId) || projectId<=0 || !path.startsWith(`${projectId}/`) || path.includes("..")) return new Response("Not found",{status:404});
 if (!await requireProjectAccess(projectId,"view")) return new Response("Access denied",{status:403});
 const client=await createClient();
 const {data,error}=await client.storage.from("progress-photos").download(path);
 if (error || !data) return new Response("Photo unavailable",{status:404});
 return new Response(data,{headers:{"Content-Type":data.type,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
}
