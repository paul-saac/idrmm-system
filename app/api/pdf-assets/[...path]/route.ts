import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  // Only bundled renderer assets; never accept an arbitrary filesystem path.
  if (path.length !== 2 || !["standard_fonts", "cmaps", "wasm"].includes(path[0]) || !/^[a-zA-Z0-9_-]+\.(pfb|ttf|bcmap|wasm|js)$/.test(path[1])) return new Response("Not found", { status: 404 });
  try {
    const data = await readFile(join(process.cwd(), "node_modules", "pdfjs-dist", ...path));
    return new Response(data, { headers: {
      "Content-Type": path[1].endsWith(".wasm") ? "application/wasm" : path[1].endsWith(".js") ? "text/javascript" : "application/octet-stream",
      "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff",
    } });
  } catch { return new Response("Not found", { status: 404 }); }
}
