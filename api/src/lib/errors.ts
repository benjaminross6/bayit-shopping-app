export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const unauthorized = (msg = "Sign in required") =>
  new ApiError(401, msg, "UNAUTHORIZED");
export const forbidden = (msg = "Not allowed") => new ApiError(403, msg, "FORBIDDEN");
export const notFound = (msg = "Not found") => new ApiError(404, msg, "NOT_FOUND");
export const conflict = (msg: string, code?: string, details?: unknown) =>
  new ApiError(409, msg, code ?? "CONFLICT", details);
export const badRequest = (msg: string, details?: unknown) =>
  new ApiError(400, msg, "BAD_REQUEST", details);
