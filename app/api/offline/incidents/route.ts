import { getSessionProfile } from "@/lib/auth/session";
import { reportIncident } from "@/lib/incidents/actions";
import { sameOfflineOrigin, offlineHeaders as headers } from "@/lib/offline/http";
import type { NextRequest } from "next/server";
export async function POST(request: NextRequest) {
  if (!sameOfflineOrigin(request)) return Response.json({error:"Invalid request."},{status:403,headers});
  const profile=await getSessionProfile();
  if (!profile) return Response.json({error:"Sign in again to synchronize."},{status:401,headers});
  if (Number(request.headers.get("content-length")) > 16*1024*1024) return Response.json({error:"Attachments are too large."},{status:413,headers});
  try {
    const reader=request.body?.getReader();
    if(!reader) return Response.json({error:"Missing incident report."},{status:400,headers});
    const chunks: Uint8Array[]=[];let size=0;
    while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;
      if(size>16*1024*1024){await reader.cancel();return Response.json({error:"Attachments are too large."},{status:413,headers});}chunks.push(chunk.value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    const form=await new Response(bytes,{headers:{"content-type":request.headers.get("content-type")??""}}).formData();
    if(form.get("ownerId")!==profile.id || !form.get("offlineSubmissionId")) return Response.json({error:"Sign in with the original account."},{status:403,headers});
    const result=await reportIncident(Number(form.get("projectId")),form);
    return Response.json(result,{status:result.error?422:200,headers});
  } catch {return Response.json({error:"Could not synchronize. The report remains saved on this device."},{status:503,headers});}
}
