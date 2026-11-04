// Outgoing email (digests). Server only. Any SMTP provider works: SMTP_URL=smtp://user:pass@host:587
import nodemailer, { type Transporter } from "nodemailer";

// Read at request time, so one built image works with and without SMTP.
export const hasMail = () => !!process.env.SMTP_URL;

let transport: Transporter | undefined;
export function mailer(): Transporter | null {
  if (!hasMail()) return null;
  transport ??= nodemailer.createTransport(process.env.SMTP_URL!);
  return transport;
}

export const FROM = process.env.EMAIL_FROM || "Changelark <alerts@localhost>";

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
// Comments are written by strangers: never let them become markup in someone's inbox.
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ENTITIES[c]);
