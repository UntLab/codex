import { Resend } from "resend";

let _resend: Resend | null = null;

function getResend(): Resend {
  if (!_resend) {
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
}

const FROM_EMAIL = process.env.FROM_EMAIL || "CardSaaS <noreply@2ai.az>";

export async function sendNewLeadNotification(
  userEmail: string,
  cardName: string,
  leadData: { name?: string; phone?: string; email?: string }
) {
  return getResend().emails.send({
    from: FROM_EMAIL,
    to: userEmail,
    subject: `New lead from "${cardName}"`,
    html: `
      <div style="font-family: 'JetBrains Mono', monospace; background: #030305; color: #fff; padding: 30px; border-radius: 12px;">
        <h2 style="color: #00ffcc; margin-bottom: 20px;">[NEW_LEAD] New contact</h2>
        <p>Someone shared their contact details from <strong>${cardName}</strong>:</p>
        <table style="margin: 20px 0; border-collapse: collapse;">
          ${leadData.name ? `<tr><td style="color: #5a6b7c; padding: 5px 15px 5px 0;">Name:</td><td>${leadData.name}</td></tr>` : ""}
          ${leadData.phone ? `<tr><td style="color: #5a6b7c; padding: 5px 15px 5px 0;">Phone:</td><td>${leadData.phone}</td></tr>` : ""}
          ${leadData.email ? `<tr><td style="color: #5a6b7c; padding: 5px 15px 5px 0;">Email:</td><td>${leadData.email}</td></tr>` : ""}
        </table>
        <p style="color: #5a6b7c; font-size: 12px;">All leads are available in your dashboard.</p>
      </div>
    `,
  });
}

export async function sendPaymentWarning(
  userEmail: string,
  cardName: string,
  cardSlug: string
) {
  return getResend().emails.send({
    from: FROM_EMAIL,
    to: userEmail,
    subject: `Action needed — "${cardName}" is inactive`,
    html: `
      <div style="font-family: 'JetBrains Mono', monospace; background: #030305; color: #fff; padding: 30px; border-radius: 12px;">
        <h2 style="color: #ff003c; margin-bottom: 20px;">[ALERT] Card inactive</h2>
        <p>Your card <strong>${cardName}</strong> (/${cardSlug}) is currently inactive.</p>
        <p style="margin-top: 15px;">Contact the CardSaaS team if you need it reactivated.</p>
        <p style="color: #5a6b7c; font-size: 12px; margin-top: 20px;">CardSaaS — Digital Business Cards</p>
      </div>
    `,
  });
}

export async function sendWeeklyReport(
  userEmail: string,
  cards: { name: string; views: number; leads: number }[]
) {
  const rows = cards
    .map(
      (c) =>
        `<tr><td style="padding: 8px 15px; border-bottom: 1px solid #111;">${c.name}</td><td style="padding: 8px 15px; text-align: center; border-bottom: 1px solid #111;">${c.views}</td><td style="padding: 8px 15px; text-align: center; border-bottom: 1px solid #111; color: #00ffcc;">${c.leads}</td></tr>`
    )
    .join("");

  return getResend().emails.send({
    from: FROM_EMAIL,
    to: userEmail,
    subject: "CardSaaS Weekly Report",
    html: `
      <div style="font-family: 'JetBrains Mono', monospace; background: #030305; color: #fff; padding: 30px; border-radius: 12px;">
        <h2 style="color: #00ffcc; margin-bottom: 20px;">[REPORT] Weekly stats</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <thead><tr style="color: #5a6b7c; font-size: 12px;">
            <th style="text-align: left; padding: 8px 15px;">Card</th>
            <th style="text-align: center; padding: 8px 15px;">Views</th>
            <th style="text-align: center; padding: 8px 15px;">Leads</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `,
  });
}
