import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { AppError, ErrorCode, isAppError, logger } from "@babasti/shared";

export interface ApiErrorResponse {
  error: { code: string; message: string };
}

export function serializeError(error: unknown): {
  status: number;
  body: ApiErrorResponse;
} {
  if (isAppError(error)) {
    return {
      status: error.status,
      body: { error: { code: error.code, message: error.message } },
    };
  }

  if (error instanceof ZodError) {
    const first = error.issues[0];
    return {
      status: 400,
      body: {
        error: {
          code: ErrorCode.VALIDATION_ERROR,
          message: first?.message ?? "Validation failed",
        },
      },
    };
  }

  // Prisma known errors
  const prismaError = error as { code?: string; meta?: { target?: string[] } };
  if (prismaError?.code === "P2002") {
    return {
      status: 409,
      body: {
        error: {
          code: ErrorCode.CONFLICT,
          message: `Resource already exists (${prismaError.meta?.target?.join(", ") ?? "unique constraint"})`,
        },
      },
    };
  }

  logger.error("Unhandled error", error);
  return {
    status: 500,
    body: {
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message: "An unexpected error occurred.",
      },
    },
  };
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function readJsonBody<T>(
  request: FastifyRequest,
): Promise<T> {
  return request.body as T;
}

export function ok<T>(reply: FastifyReply, data: T, status = 200) {
  return reply.code(status).send({ data });
}

export function accepted(reply: FastifyReply, data: unknown) {
  return reply.code(202).send({ data });
}
