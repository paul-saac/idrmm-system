"use client";
import { createClient } from "@/lib/supabase/client";
import { LOG_PHOTO_TYPES, MAX_LOG_PHOTO_BYTES, type ProgressPhoto } from "./evidence";

export async function uploadProgressPhotos(projectId: number, files: File[]) {
 const client = createClient();
 const {data:{user},error} = await client.auth.getUser();
 if (error || !user) throw new Error("Sign in again before uploading photos.");
 const uploaded: ProgressPhoto[] = [];
 try {
  for (const file of files) {
   if (!LOG_PHOTO_TYPES.includes(file.type) || file.size<=0 || file.size>MAX_LOG_PHOTO_BYTES) throw new Error("Choose JPG, PNG, or WebP photos up to 5 MB each.");
   const header = new Uint8Array(await file.slice(0,12).arrayBuffer());
   const valid = file.type === "image/jpeg" ? header[0]===255 && header[1]===216 && header[2]===255
    : file.type === "image/png" ? [137,80,78,71,13,10,26,10].every((n,i)=>header[i]===n)
    : String.fromCharCode(...header.slice(0,4))==="RIFF" && String.fromCharCode(...header.slice(8,12))==="WEBP";
   if (!valid) throw new Error("One photo is not a valid JPG, PNG, or WebP image.");
   const path = `${projectId}/${user.id}/${crypto.randomUUID()}`;
   const {error} = await client.storage.from("progress-photos").upload(path,file,{contentType:file.type,upsert:false});
   if (error) throw new Error("Could not upload the photo. Please retry; check migration 0146 if this continues.");
   uploaded.push({path,name:file.name.slice(0,200),type:file.type,size:file.size});
  }
  return uploaded;
 } catch(error) {
  if (uploaded.length) await client.storage.from("progress-photos").remove(uploaded.map(photo=>photo.path));
  throw error;
 }
}
export async function discardUnattachedPhotos(photos: ProgressPhoto[]) {
 if (photos.length) await createClient().storage.from("progress-photos").remove(photos.map(photo=>photo.path));
}
