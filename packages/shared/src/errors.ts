/**
 * Centralised application error codes and the typed error used across the API.
 * Front-end receives a normalised `{ error: { code, message } }` payload.
 */

export const ErrorCode = {
  BAD_REQUEST: "BAD_REQUEST",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL_ERROR: "INTERNAL_ERROR",

  EMAIL_TAKEN: "EMAIL_TAKEN",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  WEBSITE_NOT_FOUND: "WEBSITE_NOT_FOUND",
  WEBSITE_SLUG_TAKEN: "WEBSITE_SLUG_TAKEN",
  DEPLOYMENT_NOT_FOUND: "DEPLOYMENT_NOT_FOUND",
  DEPLOYMENT_NOT_ROLLBACKABLE: "DEPLOYMENT_NOT_ROLLBACKABLE",
  DOMAIN_NOT_FOUND: "DOMAIN_NOT_FOUND",
  DOMAIN_TAKEN: "DOMAIN_TAKEN",
  RESERVED_SLUG: "RESERVED_SLUG",
  INVALID_SLUG: "INVALID_SLUG",
  UPLOAD_TOO_LARGE: "UPLOAD_TOO_LARGE",
  INVALID_ARCHIVE: "INVALID_ARCHIVE",
  INVALID_ARTIFACT_KEY: "INVALID_ARTIFACT_KEY",
  ARTIFACT_NOT_FOUND: "ARTIFACT_NOT_FOUND",
  ARTIFACT_READ_FAILED: "ARTIFACT_READ_FAILED",
  ARTIFACT_WRITE_FAILED: "ARTIFACT_WRITE_FAILED",
  GITHUB_AUTH_FAILED: "GITHUB_AUTH_FAILED",
  NODE_UNAVAILABLE: "NODE_UNAVAILABLE",
  QUOTA_EXCEEDED: "QUOTA_EXCEEDED",
  OAUTH_STATE_MISMATCH: "OAUTH_STATE_MISMATCH",
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
  status: number;
}

export const ERROR_STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VALIDATION_ERROR: 400,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  EMAIL_TAKEN: 409,
  INVALID_CREDENTIALS: 401,
  WEBSITE_NOT_FOUND: 404,
  WEBSITE_SLUG_TAKEN: 409,
  DEPLOYMENT_NOT_FOUND: 404,
  DEPLOYMENT_NOT_ROLLBACKABLE: 400,
  DOMAIN_NOT_FOUND: 404,
  DOMAIN_TAKEN: 409,
  RESERVED_SLUG: 400,
  INVALID_SLUG: 400,
  UPLOAD_TOO_LARGE: 413,
  INVALID_ARCHIVE: 400,
  INVALID_ARTIFACT_KEY: 400,
  ARTIFACT_NOT_FOUND: 404,
  ARTIFACT_READ_FAILED: 500,
  ARTIFACT_WRITE_FAILED: 500,
  GITHUB_AUTH_FAILED: 400,
  NODE_UNAVAILABLE: 503,
  QUOTA_EXCEEDED: 413,
  OAUTH_STATE_MISMATCH: 400,
};

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;
  public readonly details?: unknown;

  constructor(code: ErrorCode, message?: string, details?: unknown) {
    super(message ?? code);
    this.name = "AppError";
    this.code = code;
    this.status = ERROR_STATUS[code] ?? 500;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }

  static fromCode(code: ErrorCode, message?: string): AppError {
    return new AppError(code, message);
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
