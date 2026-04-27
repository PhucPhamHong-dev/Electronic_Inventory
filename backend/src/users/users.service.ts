import { Injectable } from "@nestjs/common";
import type { CreateUserDto, ResetPasswordDto, UpdateUserDto } from "../../../BE/src/types/system.dto";
import { UserService as LegacyUserService } from "../../../BE/src/services/UserService";

@Injectable()
export class UsersServiceAdapter {
  private readonly service = new LegacyUserService();

  listUsers() {
    return this.service.listUsers();
  }

  createUser(payload: CreateUserDto) {
    return this.service.createUser(payload);
  }

  updateUser(userId: string, payload: UpdateUserDto) {
    return this.service.updateUser(userId, payload);
  }

  deleteUser(userId: string) {
    return this.service.deleteUser(userId);
  }

  resetPassword(userId: string, payload: ResetPasswordDto, context: { actorUserId?: string; traceId?: string; ipAddress?: string }) {
    return this.service.resetPassword(userId, payload, context);
  }
}
