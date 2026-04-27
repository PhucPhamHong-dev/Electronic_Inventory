import { Module } from "@nestjs/common";
import { UsersController } from "./users.controller";
import { UsersServiceAdapter } from "./users.service";

@Module({
  controllers: [UsersController],
  providers: [UsersServiceAdapter]
})
export class UsersModule {}
