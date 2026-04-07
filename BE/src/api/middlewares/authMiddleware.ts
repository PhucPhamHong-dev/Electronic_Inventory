import type { NextFunction, Request, Response } from "express";
import jwt, { JsonWebTokenError, TokenExpiredError, type JwtPayload } from "jsonwebtoken";
import { prisma } from "../../config/db";
import { env } from "../../config/env";
import type { AuthenticatedUser } from "../../types";
import { AppError } from "../../utils/errors";
import { normalizePermissions } from "../../utils/permission";

interface TokenPayload extends JwtPayload {
  sub: string;
  username: string;
  permissions: Record<string, unknown>;
  actorKind?: string;
  role?: string;
  branchCode?: string;
}

function isTokenExpiredError(error: unknown): boolean {
  return error instanceof TokenExpiredError || (error instanceof Error && error.name === "TokenExpiredError");
}

function isJsonWebTokenError(error: unknown): boolean {
  return error instanceof JsonWebTokenError || (error instanceof Error && error.name === "JsonWebTokenError");
}

function parseToken(req: Request): string {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    throw new AppError("Missing Authorization header", 401, "UNAUTHORIZED");
  }

  const [type, token] = authHeader.split(" ");
  if (type !== "Bearer" || !token) {
    throw new AppError("Invalid Authorization header format", 401, "UNAUTHORIZED");
  }
  return token;
}

export async function authMiddleware(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = parseToken(req);
    const decoded = jwt.verify(token, env.JWT_SECRET) as TokenPayload;

    const persistedUser = await prisma.user.findFirst({
      where: {
        id: decoded.sub,
        deletedAt: null,
        isActive: true
      },
      select: {
        id: true,
        username: true,
        permissions: true
      }
    });

    if (!persistedUser) {
      throw new AppError("Session is no longer valid. Please login again.", 401, "UNAUTHORIZED");
    }

    const user: AuthenticatedUser = {
      id: persistedUser.id,
      username: persistedUser.username,
      permissions: normalizePermissions(persistedUser.permissions),
      actorKind: decoded.actorKind,
      role: decoded.role,
      branchCode: decoded.branchCode
    };

    req.user = user;
    next();
  } catch (error) {
    if (isTokenExpiredError(error)) {
      next(new AppError("Session expired. Please login again.", 401, "UNAUTHORIZED"));
      return;
    }

    if (isJsonWebTokenError(error)) {
      next(new AppError("Invalid access token. Please login again.", 401, "UNAUTHORIZED"));
      return;
    }

    next(error);
  }
}
