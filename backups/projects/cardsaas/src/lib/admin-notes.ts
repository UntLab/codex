import { prisma } from "@/lib/prisma";

type AdminCardNoteRow = {
  cardId: string;
  note: string | null;
  updatedAt: Date;
  updatedByUserId: string | null;
};

export interface AdminCardNoteSnapshot {
  note: string | null;
  updatedAt: string | null;
  updatedByUserId: string | null;
}

let adminCardNotesTablePromise: Promise<void> | null = null;

function normalizeAdminNote(note: string | null | undefined): string | null {
  if (typeof note !== "string") return null;

  const normalized = note.trim();
  return normalized.length > 0 ? normalized : null;
}

export async function ensureAdminCardNotesTable(): Promise<void> {
  if (adminCardNotesTablePromise) {
    return adminCardNotesTablePromise;
  }

  adminCardNotesTablePromise = prisma
    .$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "AdminCardNote" (
        "cardId" TEXT PRIMARY KEY REFERENCES "Card"("id") ON DELETE CASCADE,
        "note" TEXT,
        "updatedByUserId" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    .then(() => undefined)
    .catch((error) => {
      adminCardNotesTablePromise = null;
      throw error;
    });

  return adminCardNotesTablePromise;
}

export async function getAdminCardNotesMap(
  cardIds: string[]
): Promise<Map<string, AdminCardNoteSnapshot>> {
  await ensureAdminCardNotesTable();

  if (cardIds.length === 0) {
    return new Map();
  }

  const rows = await prisma.$queryRawUnsafe<AdminCardNoteRow[]>(
    `
      SELECT "cardId", "note", "updatedAt", "updatedByUserId"
      FROM "AdminCardNote"
      WHERE "cardId" = ANY($1::text[])
    `,
    cardIds
  );

  return new Map(
    rows.map((row) => [
      row.cardId,
      {
        note: row.note,
        updatedAt: row.updatedAt?.toISOString() ?? null,
        updatedByUserId: row.updatedByUserId,
      },
    ])
  );
}

export async function setAdminCardNote(input: {
  cardId: string;
  note?: string | null;
  updatedByUserId: string;
}): Promise<void> {
  await ensureAdminCardNotesTable();

  const normalizedNote = normalizeAdminNote(input.note);

  if (!normalizedNote) {
    await prisma.$executeRawUnsafe(
      `
        DELETE FROM "AdminCardNote"
        WHERE "cardId" = $1
      `,
      input.cardId
    );
    return;
  }

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO "AdminCardNote" ("cardId", "note", "updatedByUserId")
      VALUES ($1, $2, $3)
      ON CONFLICT ("cardId")
      DO UPDATE SET
        "note" = EXCLUDED."note",
        "updatedByUserId" = EXCLUDED."updatedByUserId",
        "updatedAt" = CURRENT_TIMESTAMP
    `,
    input.cardId,
    normalizedNote,
    input.updatedByUserId
  );
}

export async function setAdminCardNotes(input: {
  cardIds: string[];
  note?: string | null;
  updatedByUserId: string;
}): Promise<void> {
  if (input.cardIds.length === 0) {
    return;
  }

  await Promise.all(
    input.cardIds.map((cardId) =>
      setAdminCardNote({
        cardId,
        note: input.note,
        updatedByUserId: input.updatedByUserId,
      })
    )
  );
}
