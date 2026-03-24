import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";

export interface AdminAuditEntry {
  id: string;
  action: string;
  entityType: "card" | "owner";
  status: string | null;
  note: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
  actorUser: {
    id: string | null;
    name: string | null;
    email: string | null;
  };
  targetUser: {
    id: string | null;
    name: string | null;
    email: string | null;
  };
  targetCard: {
    id: string | null;
    slug: string | null;
    fullName: string | null;
  };
}

type AdminAuditRow = {
  id: string;
  action: string;
  entityType: "card" | "owner";
  status: string | null;
  note: string | null;
  details: string | null;
  createdAt: Date;
  actorUserId: string | null;
  actorUserName: string | null;
  actorUserEmail: string | null;
  targetUserId: string | null;
  targetUserName: string | null;
  targetUserEmail: string | null;
  targetCardId: string | null;
  targetCardSlug: string | null;
  targetCardFullName: string | null;
};

let adminAuditTablePromise: Promise<void> | null = null;

function normalizeText(value?: string | null): string | null {
  if (typeof value !== "string") return null;

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export async function ensureAdminAuditTable(): Promise<void> {
  if (adminAuditTablePromise) {
    return adminAuditTablePromise;
  }

  adminAuditTablePromise = prisma
    .$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "AdminAuditLog" (
        "id" TEXT PRIMARY KEY,
        "action" TEXT NOT NULL,
        "entityType" TEXT NOT NULL,
        "actorUserId" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
        "targetUserId" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
        "targetCardId" TEXT REFERENCES "Card"("id") ON DELETE SET NULL,
        "status" TEXT,
        "note" TEXT,
        "details" JSONB,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    .then(() => undefined)
    .catch((error) => {
      adminAuditTablePromise = null;
      throw error;
    });

  return adminAuditTablePromise;
}

export async function recordAdminAuditEvent(input: {
  action: string;
  entityType: "card" | "owner";
  actorUserId: string;
  targetUserId?: string | null;
  targetCardId?: string | null;
  status?: string | null;
  note?: string | null;
  details?: Record<string, unknown> | null;
}): Promise<void> {
  await ensureAdminAuditTable();

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO "AdminAuditLog" (
        "id",
        "action",
        "entityType",
        "actorUserId",
        "targetUserId",
        "targetCardId",
        "status",
        "note",
        "details"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
    `,
    randomUUID(),
    input.action,
    input.entityType,
    input.actorUserId,
    input.targetUserId ?? null,
    input.targetCardId ?? null,
    normalizeText(input.status),
    normalizeText(input.note),
    JSON.stringify(input.details ?? null)
  );
}

export async function listAdminAuditEvents(options?: {
  limit?: number;
  targetUserId?: string;
  targetCardId?: string;
}): Promise<AdminAuditEntry[]> {
  await ensureAdminAuditTable();

  const limit = Math.min(Math.max(options?.limit ?? 20, 1), 100);
  const values: Array<string | number> = [];
  const conditions: string[] = [];

  if (options?.targetUserId) {
    values.push(options.targetUserId);
    conditions.push(`log."targetUserId" = $${values.length}`);
  }

  if (options?.targetCardId) {
    values.push(options.targetCardId);
    conditions.push(`log."targetCardId" = $${values.length}`);
  }

  values.push(limit);
  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = await prisma.$queryRawUnsafe<AdminAuditRow[]>(
    `
      SELECT
        log."id",
        log."action",
        log."entityType",
        log."status",
        log."note",
        log."details"::text AS "details",
        log."createdAt",
        actor."id" AS "actorUserId",
        actor."name" AS "actorUserName",
        actor."email" AS "actorUserEmail",
        target."id" AS "targetUserId",
        target."name" AS "targetUserName",
        target."email" AS "targetUserEmail",
        card."id" AS "targetCardId",
        card."slug" AS "targetCardSlug",
        card."fullName" AS "targetCardFullName"
      FROM "AdminAuditLog" log
      LEFT JOIN "User" actor ON actor."id" = log."actorUserId"
      LEFT JOIN "User" target ON target."id" = log."targetUserId"
      LEFT JOIN "Card" card ON card."id" = log."targetCardId"
      ${whereClause}
      ORDER BY log."createdAt" DESC
      LIMIT $${values.length}
    `,
    ...values
  );

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    status: row.status,
    note: row.note,
    details: row.details ? JSON.parse(row.details) : null,
    createdAt: row.createdAt.toISOString(),
    actorUser: {
      id: row.actorUserId,
      name: row.actorUserName,
      email: row.actorUserEmail,
    },
    targetUser: {
      id: row.targetUserId,
      name: row.targetUserName,
      email: row.targetUserEmail,
    },
    targetCard: {
      id: row.targetCardId,
      slug: row.targetCardSlug,
      fullName: row.targetCardFullName,
    },
  }));
}
