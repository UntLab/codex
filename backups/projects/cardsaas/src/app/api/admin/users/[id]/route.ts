import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdminSession } from "@/lib/admin";
import { listAdminAuditEvents } from "@/lib/admin-audit";
import { listAdminCards } from "@/lib/admin-cards";
import { getServerBillingMode } from "@/lib/billing";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
      _count: {
        select: {
          cards: true,
          leads: true,
        },
      },
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const [cards, audit] = await Promise.all([
    listAdminCards({ userId: id }),
    listAdminAuditEvents({ targetUserId: id, limit: 25 }),
  ]);

  const summary = {
    total: cards.length,
    pending: cards.filter((card) => card.manualStatus === "pending").length,
    active: cards.filter((card) => card.manualStatus === "active").length,
    paused: cards.filter((card) => card.manualStatus === "paused").length,
  };

  return NextResponse.json({
    user: {
      ...user,
      createdAt: user.createdAt.toISOString(),
    },
    summary,
    cards,
    audit,
  });
}
