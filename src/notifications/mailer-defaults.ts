import type { MailerOptions } from '@nestjs-modules/mailer';
import type { MailDefaults } from 'nodemailer';

export function mailerDefaults(
  defaults: MailDefaults,
): NonNullable<MailerOptions['defaults']> {
  // Mailer 2.x types defaults as transport options; Nodemailer 10 correctly
  // separates message defaults. Keep the runtime object and validate its input.
  return defaults;
}
