import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdminSession } from "@/lib/admin";
import { listAdminAuditEvents } from "@/lib/admin-audit";
import { getServerBillingMode } from "@/lib/billing";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAdminSession(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (getServerBillingMode() !== "manual") {
    return NextResponse.json(
      { error: "Admin activation is only available in manual billing mode" },
      { status: 400 }
    );
  }

  const searchParams = req.nextUrl.searchParams;
  const limit = Number(searchParams.get("limit") ?? "20");
  const targetUserId = searchParams.get("targetUserId") ?? undefined;
  const targetCardId = searchParams.get("targetCardId") ?? undefined;

  const entries = await listAdminAuditEvents({
    limit: Number.isFinite(limit) ? limit : 20,
    targetUserId,
    targetCardId,
  });

  return NextResponse.json({ entries });
}
