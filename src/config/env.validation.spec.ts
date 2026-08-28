import { environmentValidationSchema } from './env.validation';

const validBaseEnvironment = {
  NODE_ENV: 'development',
  MONGODB_URI: 'mongodb://localhost:27017/finanzapp',
  JWT_SECRET: 'access-secret-with-at-least-32-characters',
  JWT_REFRESH_SECRET: 'refresh-secret-with-at-least-32-characters',
};

describe('environmentValidationSchema', () => {
  it('accepts the minimum development configuration', () => {
    const { error } = environmentValidationSchema.validate(
      validBaseEnvironment,
      { abortEarly: false },
    );

    expect(error).toBeUndefined();
  });

  it('reports all missing required values together', () => {
    const { error } = environmentValidationSchema.validate(
      { NODE_ENV: 'development' },
      { abortEarly: false },
    );

    expect(error?.details.map((detail) => detail.path.join('.'))).toEqual(
      expect.arrayContaining([
        'MONGODB_URI',
        'JWT_SECRET',
        'JWT_REFRESH_SECRET',
      ]),
    );
  });

  it('rejects short or reused JWT secrets', () => {
    const shortResult = environmentValidationSchema.validate(
      {
        ...validBaseEnvironment,
        JWT_SECRET: 'short',
        JWT_REFRESH_SECRET: 'short',
      },
      { abortEarly: false },
    );
    const reusedResult = environmentValidationSchema.validate({
      ...validBaseEnvironment,
      JWT_REFRESH_SECRET: validBaseEnvironment.JWT_SECRET,
    });

    expect(
      shortResult.error?.details.map((detail) => detail.path.join('.')),
    ).toEqual(expect.arrayContaining(['JWT_SECRET', 'JWT_REFRESH_SECRET']));
    expect(reusedResult.error?.message).toContain(
      'JWT_REFRESH_SECRET must be different from JWT_SECRET',
    );
  });

  it('rejects invalid token durations during startup validation', () => {
    const { error } = environmentValidationSchema.validate({
      ...validBaseEnvironment,
      JWT_REFRESH_EXPIRES_IN: 'someday',
    });

    expect(error?.message).toContain('must be a positive duration');
  });

  it('requires HTTPS frontend and public URLs in production', () => {
    const { error } = environmentValidationSchema.validate(
      {
        ...validBaseEnvironment,
        NODE_ENV: 'production',
        FRONTEND_URL: 'http://app.example.com',
        API_PUBLIC_URL: 'http://api.example.com/api',
      },
      { abortEarly: false },
    );

    expect(error?.details.map((detail) => detail.path.join('.'))).toEqual(
      expect.arrayContaining(['FRONTEND_URL', 'API_PUBLIC_URL']),
    );
  });

  it('requires complete SMTP configuration when SMTP is enabled', () => {
    const { error } = environmentValidationSchema.validate({
      ...validBaseEnvironment,
      SMTP_HOST: 'smtp.example.com',
    });

    expect(error?.message).toContain('SMTP_USER');
    expect(error?.message).toContain('SMTP_PASS');
  });

  it('requires complete Telegram configuration when Telegram is enabled', () => {
    const { error } = environmentValidationSchema.validate({
      ...validBaseEnvironment,
      TELEGRAM_BOT_TOKEN: 'bot-token',
    });

    expect(error?.message).toContain('WEBHOOK_URL');
    expect(error?.message).toContain('TELEGRAM_WEBHOOK_SECRET');
  });

  it('accepts complete optional integrations', () => {
    const { error } = environmentValidationSchema.validate({
      ...validBaseEnvironment,
      SMTP_HOST: 'smtp.example.com',
      SMTP_USER: 'mailer@example.com',
      SMTP_PASS: 'smtp-password',
      TELEGRAM_BOT_TOKEN: 'bot-token',
      WEBHOOK_URL: 'http://localhost:8080/api/bot/webhook',
      TELEGRAM_WEBHOOK_SECRET: 'telegram-webhook-secret-with-32-characters',
    });

    expect(error).toBeUndefined();
  });
});
