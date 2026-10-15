import nodemailer from "nodemailer";
import type { config } from "../config";
import type { Notifier } from "../types";

type EmailConfig = ReturnType<typeof config.email>;

export class EmailNotifier implements Notifier {
  private transport;
  constructor(private c: EmailConfig) {
    this.transport = nodemailer.createTransport({
      host: c.host,
      port: c.port,
      secure: c.secure,
      auth: c.user ? { user: c.user, pass: c.pass } : undefined,
    });
  }

  async send(m: { subject: string; text: string; html: string }): Promise<void> {
    await this.transport.sendMail({ from: this.c.from, to: this.c.to, ...m });
  }
}
