import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../config/db";
import { env } from "../config/env";
import { AppError } from "../utils/errors";
import { normalizePermissions } from "../utils/permission";

export class AuthService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async login(username: string, password: string): Promise<{ accessToken: string; expiresIn: string }> {
    const user = await this.db.user.findFirst({
      where: {
        username,
        deletedAt: null,
        isActive: true
      }
    });
    if (!user) {
      throw new AppError("Invalid username or password", 401, "UNAUTHORIZED");
    }

    const matched = await bcrypt.compare(password, user.passwordHash);
    if (!matched) {
      throw new AppError("Invalid username or password", 401, "UNAUTHORIZED");
    }

    const token = jwt.sign(
      {
        username: user.username,
        permissions: normalizePermissions(user.permissions)
      },
      env.JWT_SECRET,
      {
        subject: user.id,
        expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"]
      }
    );

    return {
      accessToken: token,
      expiresIn: env.JWT_EXPIRES_IN
    };
  }
}
