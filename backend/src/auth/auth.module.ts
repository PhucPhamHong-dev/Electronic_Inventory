import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthServiceAdapter } from "./auth.service";

@Module({
  controllers: [AuthController],
  providers: [AuthServiceAdapter]
})
export class AuthModule {}
