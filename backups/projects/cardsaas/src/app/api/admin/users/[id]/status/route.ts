import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdminSession } from "@/lib/admin";
import { recordAdminAuditEvent } from "@/lib/admin-audit";
import { setAdminCardNotes } from "@/lib/admin-notes";
import {
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
  const applyNote = body?.applyNote === true;
  const note =
    typeof body?.note === "string" || body?.note === null ? body.note : null;

  if (!status || !ALLOWED_STATUSES.has(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      cards: {
        select: {
          id: true,
        },
      },
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const cardIds = user.cards.map((card) => card.id);

  if (cardIds.length === 0) {
    return NextResponse.json(
      { error: "This user has no cards to update" },
      { status: 400 }
    );
  }

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.card.updateMany({
      where: { userId: id },
      data: {
        active: isManualCardAccessible(status),
      },
    });

    await Promise.all(
      cardIds.map((cardId) =>
        tx.subscription.upsert({
          where: { cardId },
          update: {
            userId: id,
            status,
            currentPeriodStart: status === "active" ? now : null,
            currentPeriodEnd: status === "paused" ? now : null,
            cancelAtPeriodEnd: status === "paused",
          },
          create: {
            cardId,
            userId: id,
            status,
            currentPeriodStart: status === "active" ? now : null,
            currentPeriodEnd: status === "paused" ? now : null,
            cancelAtPeriodEnd: status === "paused",
          },
        })
      )
    );
  });

  if (applyNote) {
    await setAdminCardNotes({
      cardIds,
      note,
      updatedByUserId: session.user.id,
    });
  }

  await recordAdminAuditEvent({
    action: "owner_bulk_status_updated",
    entityType: "owner",
    actorUserId: session.user.id,
    targetUserId: id,
    status,
    note: applyNote ? note : null,
    details: {
      updatedCount: cardIds.length,
      appliedNote: applyNote,
    },
  });

  return NextResponse.json({
    success: true,
    updatedCount: cardIds.length,
  });
}
