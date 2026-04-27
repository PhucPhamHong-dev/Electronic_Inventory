import { Module } from "@nestjs/common";
import { MasterDataController } from "./master-data.controller";
import { MasterDataServiceAdapter } from "./master-data.service";

@Module({
  controllers: [MasterDataController],
  providers: [MasterDataServiceAdapter]
})
export class MasterDataModule {}
