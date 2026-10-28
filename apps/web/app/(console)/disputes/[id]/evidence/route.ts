import { disputeEvidencePdf, requireConsole } from "@/lib/operator";
import { isDisputeId } from "@/lib/disputes-view";

// The evidence PDF, streamed from the API with the operator key (never exposed to the browser).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireConsole();
  const { id } = await params;
  if (!isDisputeId(id)) return new Response("Not found", { status: 404 });
  const pdf = await disputeEvidencePdf(id);
  if (!pdf) return new Response("Not found", { status: 404 });
  return new Response(pdf, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="keel-evidence-${id}.pdf"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
