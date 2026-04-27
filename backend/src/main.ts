import "reflect-metadata";
import { env } from "../../BE/src/config/env";
import { createApp } from "./create-app";

async function bootstrap() {
  const app = await createApp();
  await app.listen(env.PORT);
}

void bootstrap();
