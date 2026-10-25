import { S3Client } from "bun";

import { env } from "~/server/env.server";
import { log } from "~/server/log.server";

export const s3 = new S3Client({
  accessKeyId: env.S3_ACCESS_KEY_ID,
  bucket: env.S3_BUCKET,
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
});

export const deleteObjects = async (keys: string[]) => {
  await Promise.all(
    keys.map(async (key) => {
      try {
        await s3.delete(key);
      } catch (error) {
        log.error({ err: error, key }, "S3 delete failed");
      }
    })
  );
};
