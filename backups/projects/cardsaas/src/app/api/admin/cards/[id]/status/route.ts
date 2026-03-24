import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdminSession } from "@/lib/admin";
import { recordAdminAuditEvent } from "@/lib/admin-audit";
import { setAdminCardNote } from "@/lib/admin-notes";
import {
  getManualCardStatus,
  getServerBillingMode,
  isManualCardAccessible,
  type ManualCardStatus,
} from "@/lib/billing";
import { prisma } from "@/lib/prisma";

const ALLOWED_STATUSES = new Set<ManualCardStatus>([
  "pending",
  "active",
  "paused",
]);

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
  const status = body?.status as ManualCardStatus | undefined;
  const note =
    typeof body?.note === "string" || body?.note === null ? body.note : null;
  const hasNoteField = Object.prototype.hasOwnProperty.call(body ?? {}, "note");

  if (!status || !ALLOWED_STATUSES.has(status)) {
    return NextResponse.json(
      { error: "Invalid status" },
      { status: 400 }
    );
  }

  const existingCard = await prisma.card.findUnique({
    where: { id },
    include: { subscription: true },
  });

  if (!existingCard) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  const now = new Date();

  const card = await prisma.$transaction(async (tx) => {
    await tx.card.update({
      where: { id },
      data: {
        active: isManualCardAccessible(status),
      },
    });

    await tx.subscription.upsert({
      where: { cardId: id },
      update: {
        userId: existingCard.userId,
        status,
        currentPeriodStart: status === "active" ? now : null,
        currentPeriodEnd: status === "paused" ? now : null,
        cancelAtPeriodEnd: status === "paused",
      },
      create: {
        cardId: id,
        userId: existingCard.userId,
        status,
        currentPeriodStart: status === "active" ? now : null,
        currentPeriodEnd: status === "paused" ? now : null,
        cancelAtPeriodEnd: status === "paused",
      },
    });

    return tx.card.findUnique({
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
  });

  if (!card) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  if (hasNoteField) {
    await setAdminCardNote({
      cardId: id,
      note,
      updatedByUserId: session.user.id,
    });
  }

  await recordAdminAuditEvent({
    action: "card_status_updated",
    entityType: "card",
    actorUserId: session.user.id,
    targetUserId: existingCard.userId,
    targetCardId: id,
    status,
    note: hasNoteField ? note : null,
    details: {
      appliedNote: hasNoteField,
    },
  });

  return NextResponse.json({
    card: {
      ...card,
      manualStatus: getManualCardStatus(card),
      adminNote: hasNoteField
        ? typeof note === "string"
          ? note.trim() || null
          : null
        : null,
    },
  });
}
