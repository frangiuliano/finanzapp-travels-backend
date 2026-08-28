import * as Joi from 'joi';
import * as ms from 'ms';

const optionalString = Joi.string().trim().empty('').optional();
const optionalHttpUrl = Joi.string()
  .trim()
  .empty('')
  .uri({ scheme: ['http', 'https'] })
  .optional();
const duration = Joi.string()
  .trim()
  .custom((value: string, helpers) => {
    const milliseconds = ms(value as ms.StringValue);
    return Number.isFinite(milliseconds) && milliseconds > 0
      ? value
      : helpers.error('duration.positive');
  })
  .messages({
    'duration.positive':
      '{{#label}} must be a positive duration such as 15m or 7d',
  });

export const environmentValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(8080),

  MONGODB_URI: Joi.string()
    .trim()
    .uri({ scheme: ['mongodb', 'mongodb+srv'] })
    .required(),
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string()
    .min(32)
    .invalid(Joi.ref('JWT_SECRET'))
    .required()
    .messages({
      'any.invalid': 'JWT_REFRESH_SECRET must be different from JWT_SECRET',
    }),
  JWT_EXPIRES_IN: duration.default('1h'),
  JWT_REFRESH_EXPIRES_IN: duration.default('30d'),

  FRONTEND_URL: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string()
      .trim()
      .uri({ scheme: ['https'] })
      .required(),
    otherwise: optionalHttpUrl,
  }),
  API_PUBLIC_URL: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string()
      .trim()
      .empty('')
      .uri({ scheme: ['https'] })
      .optional(),
    otherwise: optionalHttpUrl,
  }),

  SMTP_HOST: optionalString,
  SMTP_PORT: Joi.number().port().default(587),
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  SMTP_SECURE: Joi.boolean().truthy('true').falsy('false').default(false),
  SMTP_FROM: optionalString,
  APP_NAME: optionalString,

  TELEGRAM_BOT_TOKEN: optionalString,
  WEBHOOK_URL: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string()
      .trim()
      .empty('')
      .uri({ scheme: ['https'] })
      .optional(),
    otherwise: optionalHttpUrl,
  }),
  TELEGRAM_WEBHOOK_SECRET: Joi.string().trim().empty('').min(32).optional(),
  GROQ_API_KEY: optionalString,

  FX_ARGENTINA_CASA: optionalString,
  FX_DOLARAPI_BASE_URL: optionalHttpUrl,
  FX_ARGENTINA_DATOS_BASE_URL: optionalHttpUrl,
  FX_CACHE_TTL_MS: Joi.number().integer().positive().optional(),
  FX_HISTORICAL_CACHE_TTL_MS: Joi.number().integer().positive().optional(),
  FX_API_KEY: optionalString,
  FX_API_BASE_URL: optionalHttpUrl,

  TWELVE_DATA_API_KEY: optionalString,
  TWELVE_DATA_API_BASE_URL: optionalHttpUrl,
  MARKET_DATA_SEARCH_CACHE_TTL_MS: Joi.number().integer().positive().optional(),
})
  .and('SMTP_HOST', 'SMTP_USER', 'SMTP_PASS')
  .and('TELEGRAM_BOT_TOKEN', 'WEBHOOK_URL', 'TELEGRAM_WEBHOOK_SECRET')
  .unknown(true);
