import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdminSession } from "@/lib/admin";
import { recordAdminAuditEvent } from "@/lib/admin-audit";
import { setAdminCardNote } from "@/lib/admin-notes";
import { getManualCardStatus, getServerBillingMode } from "@/lib/billing";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  req: NextRequest,
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

  const body = await req.json();
  const note =
    typeof body?.note === "string" || body?.note === null ? body.note : null;

  const existingCard = await prisma.card.findUnique({
    where: { id },
  });

  if (!existingCard) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  await setAdminCardNote({
    cardId: id,
    note,
    updatedByUserId: session.user.id,
  });

  await recordAdminAuditEvent({
    action: "card_note_saved",
    entityType: "card",
    actorUserId: session.user.id,
    targetUserId: existingCard.userId,
    targetCardId: id,
    note,
  });

  const card = await prisma.card.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      subscription: true,
      _count: {
        select: {
          leads: true,
          views: true,
        },
      },
    },
  });

  return NextResponse.json({
    card: {
      ...card,
      manualStatus: getManualCardStatus(card!),
      adminNote: typeof note === "string" ? note.trim() || null : null,
    },
  });
}
