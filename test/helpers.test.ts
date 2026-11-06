import { afterEach, expect, mock, test } from "bun:test";

import { addGiteaUser, resetDatabase, stubGiteaUsers } from "./helpers";

afterEach(() => {
  mock.restore();
});

test("resetting the database forgets the fake Gitea accounts", async () => {
  addGiteaUser("zed");
  await resetDatabase();
  stubGiteaUsers();

  const response = await fetch("http://gitea.test/api/v1/users/zed");

  expect(response.status).toBe(404);
});
