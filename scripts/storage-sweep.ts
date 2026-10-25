import { db } from "~/server/db.server";
import { sweepStorage } from "~/server/storage-sweep.server";

const { objects, rows } = await sweepStorage();

console.info(
  `Deleted ${objects} orphaned objects and ${rows} unused logo attachments`
);

await db.close();
