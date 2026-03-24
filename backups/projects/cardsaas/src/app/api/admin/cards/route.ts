import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdminSession } from "@/lib/admin";
import { listAdminAuditEvents } from "@/lib/admin-audit";
import { listAdminCards } from "@/lib/admin-cards";
import { getServerBillingMode } from "@/lib/billing";

export async function GET() {
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

  const [cards, recentAudit] = await Promise.all([
    listAdminCards(),
    listAdminAuditEvents({ limit: 12 }),
  ]);

  return NextResponse.json({ cards, recentAudit });
}
