export type BillingMode = "manual" | "stripe";
export type ManualCardStatus = "pending" | "active" | "paused";

export const clientBillingMode: BillingMode =
  process.env.NEXT_PUBLIC_BILLING_MODE === "stripe" ? "stripe" : "manual";

export function getServerBillingMode(): BillingMode {
  const rawMode = process.env.BILLING_MODE ?? process.env.NEXT_PUBLIC_BILLING_MODE;
  return rawMode === "stripe" ? "stripe" : "manual";
}

export function isManualBillingMode(): boolean {
  return getServerBillingMode() === "manual";
}

export const MANUAL_BILLING_MESSAGE =
  "Automatic payments are disabled. Access and plan changes are handled manually for now.";

export const MANUAL_CARD_STATUS_LABELS: Record<ManualCardStatus, string> = {
  pending: "Pending activation",
  active: "Active",
  paused: "Paused",
};

export function getManualCardStatus(input: {
  active: boolean;
  subscription?: { status?: string | null } | null;
}): ManualCardStatus {
  const subscriptionStatus = input.subscription?.status;

  if (subscriptionStatus === "paused") return "paused";
  if (subscriptionStatus === "pending") return "pending";
  if (subscriptionStatus === "active") return "active";

  return input.active ? "active" : "pending";
}

export function isManualCardAccessible(status: ManualCardStatus): boolean {
  return status === "active";
}

export function getManualCardStatusMessage(status: ManualCardStatus): string {
  if (status === "paused") {
    return "This card is currently paused. Access will return after manual reactivation.";
  }

  if (status === "pending") {
    return "This card is waiting for manual activation by the CardSaaS team.";
  }

  return "This card is active.";
}
