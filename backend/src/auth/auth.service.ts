import { Injectable } from "@nestjs/common";
import { AuthService as LegacyAuthService } from "../../../BE/src/services/AuthService";

@Injectable()
export class AuthServiceAdapter {
  private readonly service = new LegacyAuthService();

  login(username: string, password: string) {
    return this.service.login(username, password);
  }
}
