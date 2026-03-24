import { getManualCardStatus, type ManualCardStatus } from "@/lib/billing";
import { getAdminCardNotesMap } from "@/lib/admin-notes";
import { prisma } from "@/lib/prisma";

export interface AdminCardRecord {
  id: string;
  slug: string;
  userId: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  fullName: string;
  jobTitle: string | null;
  company: string | null;
  user: {
    id: string;
    name: string | null;
    email: string;
  };
  subscription: {
    status: string;
    currentPeriodEnd: Date | null;
  } | null;
  _count: {
    leads: number;
    views: number;
  };
  manualStatus: ManualCardStatus;
  adminNote: string | null;
  adminNoteUpdatedAt: string | null;
  adminNoteUpdatedByUserId: string | null;
}

const statusPriority: Record<ManualCardStatus, number> = {
  pending: 0,
  paused: 1,
  active: 2,
};

function sortAdminCards(cards: AdminCardRecord[]): AdminCardRecord[] {
  return [...cards].sort((left, right) => {
    const statusDiff =
      statusPriority[left.manualStatus] - statusPriority[right.manualStatus];

    if (statusDiff !== 0) {
      return statusDiff;
    }

    return (
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    );
  });
}

export async function listAdminCards(options?: {
  userId?: string;
}): Promise<AdminCardRecord[]> {
  const cards = await prisma.card.findMany({
    where: options?.userId ? { userId: options.userId } : undefined,
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
    orderBy: {
      updatedAt: "desc",
    },
  });

  const notesMap = await getAdminCardNotesMap(cards.map((card) => card.id));

  return sortAdminCards(
    cards.map((card) => ({
      ...card,
      manualStatus: getManualCardStatus(card),
      adminNote: notesMap.get(card.id)?.note ?? null,
      adminNoteUpdatedAt: notesMap.get(card.id)?.updatedAt ?? null,
      adminNoteUpdatedByUserId:
        notesMap.get(card.id)?.updatedByUserId ?? null,
    }))
  );
}

export async function getAdminCardById(
  cardId: string
): Promise<AdminCardRecord | null> {
  const cards = await listAdminCards();
  return cards.find((item) => item.id === cardId) ?? null;
}
