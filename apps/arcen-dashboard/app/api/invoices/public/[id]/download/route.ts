import { NextRequest, NextResponse } from "next/server";
import { readSignedInvoicePdf } from "@/lib/invoice-documents";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Params) {
  const { id } = await context.params;
  const key = request.nextUrl.searchParams.get("key") || "";
  const exp = request.nextUrl.searchParams.get("exp") || "";
  const sig = request.nextUrl.searchParams.get("sig") || "";

  if (!key || !exp || !sig) {
    return NextResponse.json({ error: "Missing download token" }, { status: 400 });
  }

  const result = await readSignedInvoicePdf({
    invoiceId: id,
    objectKey: key,
    expRaw: exp,
    signature: sig,
  });

  if (!result) {
    return NextResponse.json({ error: "Invalid or expired download token" }, { status: 401 });
  }

  return new NextResponse(new Uint8Array(result.bytes), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "cache-control": "private, max-age=60",
      "content-disposition": `attachment; filename="${result.filename}"`,
    },
  });
}
