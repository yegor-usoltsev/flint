// oxlint-disable sonarjs/no-duplicate-string -- Demo content repeats names and statuses.
import { generateNKeysBetween } from "fractional-indexing";
// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import type { Attachment } from "~/lib/api-types";
import { branchName } from "~/lib/branch";
import type { Color } from "~/lib/colors";
import type { ProjectIcon } from "~/lib/project-icons";
import type { Actor } from "~/server/api.server";
import { uploadFile } from "~/server/attachments.server";
import { createComment } from "~/server/comments.server";
import { db } from "~/server/db.server";
import { settleEmbeddings } from "~/server/embeddings.server";
import { env } from "~/server/env.server";
import {
  createIssue,
  CreateIssueSchema,
  deleteIssue,
  updateIssue,
  UpdateIssueSchema,
} from "~/server/issues.server";
import { createLabel } from "~/server/labels.server";
import { addMember } from "~/server/members.server";
import { createProject } from "~/server/projects.server";
import { signIn } from "~/server/users.server";
import { deletePage, putPage } from "~/server/wiki.server";
import { createWorkspace, deleteWorkspace } from "~/server/workspaces.server";

import { GiteaEnvSchema, giteaClient } from "../gitea-client";
import { setExternalTracker } from "../gitea-external-tracker";

const gitea = giteaClient(v.parse(GiteaEnvSchema, process.env));

const health = await fetch(new URL("/api/health", env.APP_URL)).catch(
  () => null
);

if (health?.ok !== true) {
  throw new Error(
    `Flint is not answering at ${env.APP_URL}; start it first (bun run dev or the app profile), because Gitea links the demo pull request through its webhook`
  );
}

const GiteaUserSchema = v.object({
  avatar_url: v.string(),
  email: v.string(),
  full_name: v.string(),
  id: v.number(),
  login: v.string(),
});

const assets = `${import.meta.dir}/demo-assets`;

const people = { alice: "Alice Morgan", bob: "Bob Chen", carol: "Carol Diaz" };

const signInAs = async (username: keyof typeof people): Promise<Actor> => {
  const asUser = giteaClient(
    v.parse(GiteaEnvSchema, {
      ...process.env,
      GITEA_ADMIN_PASSWORD: "password",
      GITEA_ADMIN_USER: username,
    })
  );

  const avatar = Bun.file(`${assets}/${username}.png`);

  await asUser(v.unknown(), "/user/avatar", {
    body: JSON.stringify({
      image: Buffer.from(await avatar.arrayBuffer()).toString("base64"),
    }),
    method: "POST",
  });

  const user = await gitea(GiteaUserSchema, `/admin/users/${username}`, {
    body: JSON.stringify({
      full_name: people[username],
      login_name: username,
      source_id: 0,
    }),
    method: "PATCH",
  });

  return {
    userId: await signIn({
      avatarUrl: user.avatar_url.replace(env.GITEA_URL, env.GITEA_PUBLIC_URL),
      email: user.email,
      giteaId: String(user.id),
      name: user.full_name,
      username: user.login,
    }),
  };
};

type Person = keyof typeof people;

const repo = "acme/web";

const draftSlug = "acme-demo-incomplete";

const pageIds = {
  architecture: Bun.randomUUIDv7(),
  checkout: Bun.randomUUIDv7(),
  welcome: Bun.randomUUIDv7(),
};

const ciLog = new File(
  [
    `▶ inventory sync
  ✔ imports the nightly feed (412ms)
  ✔ skips unknown SKUs (38ms)
  ✖ updates stock after a webhook (5003ms)
    Error: timed out after 5000ms waiting for stock 12 on SKU TR-42 (last seen 11)
        at waitFor (test/helpers.js:18:11)
        at async TestContext.<anonymous> (src/inventory.test.js:57:5)
▶ inventory sync (5461ms)
ℹ tests 3
ℹ pass 2
ℹ fail 1
`,
  ],
  "inventory-sync-ci.log",
  { type: "text/plain" }
);

interface DemoIssue {
  assignee?: Person;
  author?: Person;
  comments?: [Person, string, File?][];
  days: number;
  deleted?: boolean;
  description?: string;
  image?: string;
  labels?: string[];
  priority?: v.InferInput<typeof CreateIssueSchema>["priority"];
  status: string;
  title: string;
}

const prIssue = {
  assignee: "alice",
  comments: [
    [
      "bob",
      "Can we keep the dollar sign for `en-US` exactly as it is today? Support has a macro that quotes prices from the storefront.",
    ],
    ["alice", "Yes, `en-US` stays `$129.00`; the tests pin it."],
  ],
  days: 3,
  description: [
    "Customers outside the US see prices as `$129.00`. Format them with `Intl.NumberFormat` for the browser's locale so a UK visitor sees `£129.00`.",
    "- [x] `localPrice(cents, locale)` helper with tests\n- [ ] Use it on the product and cart pages\n- [ ] Read the locale from `Accept-Language` on the server",
    "Exchange rates are out of scope: catalogue prices stay in each region's currency.",
  ].join("\n\n"),
  labels: ["Feature"],
  priority: 2,
  status: "In Review",
  title: "Format prices for the customer's locale",
} satisfies DemoIssue;

const engineering: DemoIssue[] = [
  {
    assignee: "bob",
    days: 26,
    description:
      "Offer Apple Pay on the payment step for Safari users. The payment provider already supports it; we need the domain verification file and the button.",
    labels: ["Feature"],
    priority: 2,
    status: "Done",
    title: "Add Apple Pay to checkout",
  },
  {
    assignee: "carol",
    comments: [
      [
        "carol",
        "Reproduced: a double click on **Pay** sends two requests before the button disables. The provider accepts both because we send no idempotency key.",
      ],
      [
        "bob",
        "Let's send the order id as the idempotency key and disable the button on the first click. Both are cheap.",
      ],
    ],
    days: 11,
    description:
      "Two customers were charged twice this week. Both double-clicked **Pay** on a slow connection.\n\n- [x] Find the cause\n- [x] Send an idempotency key with every charge\n- [x] Refund the affected orders",
    labels: ["Bug"],
    priority: 1,
    status: "Done",
    title: "Fix double charge when the payment form is submitted twice",
  },
  {
    assignee: "bob",
    days: 9,
    description:
      "Sessions live in a signed cookie, so we cannot revoke them. Store them in Postgres and keep only a random token in the cookie.\n\n- [x] Sessions table and migration\n- [x] Read and write through the new store\n- [ ] Revoke all sessions on password change\n- [ ] Remove the cookie fallback after a week",
    labels: ["Security", "Improvement"],
    priority: 2,
    status: "In Progress",
    title: "Store sessions in Postgres instead of signed cookies",
  },
  {
    assignee: "carol",
    days: 6,
    description:
      "Product pages send the 3000 px originals to phones. Serve `srcset` sizes from the image service; the gallery alone is 9 MB on a cold load.",
    labels: ["Performance"],
    priority: 2,
    status: "Todo",
    title: "Product images load at full resolution on mobile",
  },
  prIssue,
  {
    days: 34,
    description:
      "Signed-in customers lose their cart when they switch devices. Keep the cart on the account and merge it with the guest cart at sign-in.",
    labels: ["Feature"],
    priority: 4,
    status: "Backlog",
    title: "Keep the cart across devices for signed-in customers",
  },
  {
    assignee: "alice",
    days: 5,
    description:
      "Anyone can request unlimited reset emails for any address. Allow five requests per address and per IP an hour and answer the same way whether or not the account exists.",
    labels: ["Security"],
    priority: 1,
    status: "Todo",
    title: "Rate-limit the password reset endpoint",
  },
  {
    assignee: "alice",
    comments: [
      [
        "carol",
        "Searching for `creme` finds nothing, `crème` finds the brûlée set. Same for `cafe`.",
      ],
      [
        "alice",
        "The search column uses the `simple` configuration. Switching to `unaccent` fixes it; I'm checking the index size before and after.",
      ],
    ],
    days: 2,
    labels: ["Bug"],
    priority: 2,
    status: "In Progress",
    title: "Search returns nothing for queries without accents",
  },
  {
    assignee: "bob",
    comments: [
      [
        "bob",
        "Closing this: the REST endpoints are fast enough and the cart is the only client. We can revisit when the mobile app needs it.",
      ],
    ],
    days: 19,
    priority: 4,
    status: "Canceled",
    title: "Move the cart API to GraphQL",
  },
  {
    days: 41,
    description:
      "Let customers leave a rating and up to three photos after delivery. Moderation goes through the existing admin queue.",
    labels: ["Feature"],
    status: "Backlog",
    title: "Product reviews with photos",
  },
  {
    assignee: "carol",
    days: 7,
    description:
      "The confirmation email prints the order time in UTC. Use the time zone from the shipping address.",
    labels: ["Bug"],
    priority: 3,
    status: "Todo",
    title: "Order confirmation email shows times in UTC",
  },
  {
    assignee: "bob",
    days: 15,
    labels: ["Improvement"],
    priority: 3,
    status: "Done",
    title: "Upgrade the storefront to Node 24",
  },
  {
    assignee: "bob",
    days: 2,
    description:
      "Category pages render on every request. Cache them for five minutes and purge on product updates.",
    labels: ["Performance"],
    priority: 3,
    status: "In Review",
    title: "Cache category pages for five minutes",
  },
  {
    assignee: "carol",
    comments: [
      [
        "alice",
        "Happens on an iPhone SE with the banner open. The banner is `position: fixed` with a higher `z-index` than the sticky checkout bar.",
      ],
    ],
    days: 1,
    description:
      "On screens under 380 px the cookie banner covers **Place order**. Customers have to scroll back up to dismiss it.",
    image: "cookie-banner-iphone-se.webp",
    labels: ["Bug"],
    priority: 1,
    status: "Todo",
    title: "Cookie banner hides the checkout button on small screens",
  },
  {
    assignee: "alice",
    days: 22,
    labels: ["Docs"],
    priority: 4,
    status: "Backlog",
    title: "Document the release checklist in the wiki",
  },
  {
    assignee: "carol",
    days: 4,
    description:
      "Record who changed a price, when, and the old and new value. Show the history on the product's admin page.\n\n- [x] `price_changes` table\n- [ ] Write a row on every change\n- [ ] History panel in the admin",
    labels: ["Security", "Feature"],
    priority: 3,
    status: "In Progress",
    title: "Audit log for price changes in the admin",
  },
  {
    assignee: "bob",
    comments: [
      [
        "bob",
        "Log of the last failing run. The webhook arrives after about 4.8 s on a busy runner, so the 5 s wait loses the race.",
        ciLog,
      ],
    ],
    days: 3,
    description:
      "`inventory sync › updates stock after a webhook` fails about one run in ten with a timeout. It waits on a real timer; use a fake clock.",
    labels: ["Bug"],
    priority: 3,
    status: "Todo",
    title: "Flaky test: inventory sync times out in CI",
  },
  {
    assignee: "carol",
    days: 12,
    labels: ["Performance"],
    priority: 4,
    status: "Done",
    title: "Lazy-load the recommendations carousel",
  },
  {
    days: 47,
    labels: ["Feature"],
    priority: 3,
    status: "Backlog",
    title: "Gift cards",
  },
  {
    assignee: "alice",
    days: 13,
    description:
      "Add `Product` structured data (name, price, availability, rating) so search engines show rich results.",
    labels: ["Improvement"],
    priority: 4,
    status: "Todo",
    title: "Structured data for product pages",
  },
  {
    days: 29,
    priority: 0,
    status: "Backlog",
    title: "Dark theme for the storefront",
  },
  {
    assignee: "bob",
    days: 1,
    deleted: true,
    priority: 3,
    status: "Todo",
    title: "Limit password reset emails per address",
  },
];

const design: DemoIssue[] = [
  {
    assignee: "carol",
    comments: [
      [
        "bob",
        "The new address step is great. Can the postcode lookup fill the city too? That's the field people get wrong most.",
      ],
    ],
    days: 8,
    description: `Shorten checkout from four steps to two: address and payment on one page, review on the second.

- [x] Wireframes
- [x] Usability test with five customers
- [ ] High-fidelity mockups
- [ ] Handoff notes for ENG

Wireframe and notes: [Checkout redesign](/doc/${pageIds.checkout})`,
    priority: 2,
    status: "In Progress",
    title: "Redesign the checkout flow in two steps",
  },
  {
    assignee: "carol",
    days: 6,
    priority: 3,
    status: "Todo",
    title: "Icons for order statuses",
  },
  {
    assignee: "alice",
    days: 10,
    description:
      "Run the product page through a screen reader and keyboard-only, then file what breaks. Color contrast of the sale badge is a known one.",
    labels: ["Improvement"],
    priority: 2,
    status: "Todo",
    title: "Accessibility review of the product page",
  },
  {
    days: 31,
    priority: 4,
    status: "Backlog",
    title: "Holiday campaign palette and banners",
  },
  {
    assignee: "carol",
    days: 14,
    priority: 3,
    status: "Done",
    title: "Empty states for search and the cart",
  },
  {
    assignee: "carol",
    days: 3,
    priority: 3,
    status: "In Review",
    title: "Design tokens for spacing and type",
  },
];

const prKey = `ENG-${engineering.indexOf(prIssue) + 1}`;
const prBranch = branchName("alice", prKey, prIssue.title);

const pages: [Person, string, string, string, string?, string?][] = [
  [
    "alice",
    "handbook/welcome",
    "Welcome to Acme",
    `We build and run the Acme storefront: the shop at acme.example, its admin and the services behind them.

## Where things live

| What | Where |
| --- | --- |
| Product work | The **Engineering** and **Design** projects |
| Code | \`${repo}\` on Gitea |
| How we work | The rest of this handbook |
| Architecture | [Architecture](/doc/${pageIds.architecture}) |

## Your first week

- [ ] Get access to Gitea and Flint
- [ ] Run the storefront locally (\`npm start\` in \`${repo}\`)
- [ ] Ship a small fix: pick a **Low** priority issue from the backlog
- [ ] Join an on-call shadow shift`,
    pageIds.welcome,
  ],
  [
    "alice",
    "handbook/how-we-work",
    "How we work",
    `## Statuses

- **Backlog**: worth doing, not planned yet.
- **Todo**: planned for the next two weeks.
- **In Progress** and **In Review**: someone is on it. Keep it to two issues per person.
- **Done** and **Canceled**: closed; a canceled issue says why in a comment.

## Priorities

Urgent means someone drops what they are doing, so it needs a person assigned right away. High is this week, medium this cycle, low when there is time.

## Branches and reviews

Name branches after the issue (\`Cmd+Shift+.\` on an issue copies the name) so the pull request shows up on the issue. One approval merges; CI must be green.`,
  ],
  [
    "bob",
    "engineering/architecture",
    "Architecture",
    `The storefront is a Node service in front of Postgres, with images on S3 and payments through the provider's API.

\`\`\`mermaid
flowchart LR
  browser[Browser] --> web[Storefront]
  web --> db[(Postgres)]
  web --> images[(Image storage)]
  web --> payments[Payment provider]
  admin[Admin] --> web
\`\`\`

| Service | Owner | Runbook |
| --- | --- | --- |
| Storefront | Bob | Payments outage |
| Admin | Carol | none yet |
| Image storage | Bob | none yet |

Sessions move to Postgres with ENG-3.`,
    pageIds.architecture,
  ],
  [
    "bob",
    "engineering/releases",
    "Releases",
    `We deploy from \`main\` several times a day.

1. Merge the pull request once CI is green.
2. The deploy job builds the image and rolls it out to 10% of traffic.
3. Watch the error rate for ten minutes, then promote to 100%.

To roll back, redeploy the previous image:

\`\`\`sh
deploy rollback storefront --to previous
\`\`\``,
  ],
  [
    "carol",
    "engineering/runbooks/payments-outage",
    "Payments outage",
    `Symptoms: checkout errors above 2%, or the provider's status page reports an incident.

1. Check the provider's status page and our error dashboard.
2. If the provider is down, switch checkout to **Pay later** in the admin.
3. Post in the incident channel every 30 minutes.
4. Once payments recover, switch **Pay later** off and retry failed charges.

See ENG-2 for the last incident's follow-up.`,
  ],
  [
    "carol",
    "design/checkout",
    "Checkout redesign",
    `Checkout drops from four steps to two (DES-1). Address and payment share the first page, review is the second.

- The postcode fills the city, the field customers get wrong most.
- Apple Pay and Pay later sit next to the card form instead of on a separate step.
- The order summary stays visible while the customer scrolls.

Usability test: five of five customers finished without help, median time 1 min 52 s (was 3 min 10 s).`,
    pageIds.checkout,
    "checkout-wireframe.webp",
  ],
  [
    "alice",
    "handbook/onboarding-2025",
    "Onboarding checklist 2025",
    "Replaced by the checklist on the welcome page.",
  ],
];

const fileChanges = (files: Record<string, string>) =>
  Object.entries(files).map(([path, content]) => ({
    content: Buffer.from(content).toString("base64"),
    operation: "create",
    path,
  }));

const app = {
  ".gitea/workflows/ci.yml": `name: CI

on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - run: node --test
`,
  "README.md": `# Acme web

The Acme storefront. \`npm start\` serves it on port 8080 and \`npm test\` runs the tests.

Name branches after a Flint issue (such as \`${prBranch}\`), and the branch and its pull request show up on the issue.
`,
  "package.json": `{
  "name": "acme-web",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node server.js",
    "test": "node --test"
  }
}
`,
  "server.js": `import { createServer } from "node:http";

import { formatPrice } from "./src/price.js";

const products = [
  { cents: 12900, name: "Trail runner" },
  { cents: 1800, name: "Wool socks" },
];

createServer((request, response) => {
  const items = products.map((product) => "<li>" + product.name + ": " + formatPrice(product.cents) + "</li>");

  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end("<h1>Acme</h1><ul>" + items.join("") + "</ul>");
}).listen(process.env.PORT ?? 8080);
`,
  "src/price.js": `export const formatPrice = (cents) => "$" + (cents / 100).toFixed(2);
`,
  "src/price.test.js": `import assert from "node:assert/strict";
import { test } from "node:test";

import { formatPrice } from "./price.js";

test("formats cents as dollars", () => {
  assert.equal(formatPrice(12900), "$129.00");
});
`,
};

const feature = {
  "src/currency.js": `const currencies = { "en-GB": "GBP", "en-US": "USD" };

export const localPrice = (cents, locale) =>
  new Intl.NumberFormat(locale, {
    currency: currencies[locale] ?? "USD",
    style: "currency",
  }).format(cents / 100);
`,
  "src/currency.test.js": `import assert from "node:assert/strict";
import { test } from "node:test";

import { localPrice } from "./currency.js";

test("keeps dollars for en-US", () => {
  assert.equal(localPrice(12900, "en-US"), "$129.00");
});

test("uses pounds for en-GB", () => {
  assert.equal(localPrice(12900, "en-GB"), "£129.00");
});
`,
};

const asset = (name: string) => {
  const file = Bun.file(`${assets}/${name}`);

  return new File([file], name, { type: file.type });
};

const withImage = (text: string, { filename, url }: Attachment) =>
  `${text}\n\n![${filename}](${url})`;

interface Age {
  days: number;
  id: string;
}

const addIssues = async (
  actors: Record<Person, Actor>,
  key: string,
  statuses: { id: string; name: string }[],
  labels: Map<string, string>,
  issues: DemoIssue[]
) => {
  const sortKeys = generateNKeysBetween(null, null, issues.length);
  const ages: Age[] = [];

  for (const [index, issue] of issues.entries()) {
    // oxlint-disable-next-line no-await-in-loop -- Keys follow the order above.
    const created = await createIssue(
      actors[issue.author ?? issue.assignee ?? "alice"],
      key,
      v.parse(CreateIssueSchema, {
        assigneeId: issue.assignee ? actors[issue.assignee].userId : null,
        description: issue.description,
        labelIds: issue.labels?.map((name) => labels.get(name)),
        priority: issue.priority,
        sortKey: sortKeys[index],
        statusId: statuses.find(({ name }) => name === issue.status)?.id,
        title: issue.title,
      })
    );

    ages.push({ days: issue.days, id: created.id });

    if (issue.image !== undefined) {
      const author = actors[issue.author ?? issue.assignee ?? "alice"];

      // oxlint-disable-next-line no-await-in-loop -- The description embeds the upload.
      const image = await uploadFile(
        author,
        { issueKey: created.key },
        asset(issue.image)
      );

      // oxlint-disable-next-line no-await-in-loop -- Follows its upload.
      await updateIssue(
        author,
        created.key,
        v.parse(UpdateIssueSchema, {
          description: withImage(issue.description ?? "", image),
        })
      );
    }

    if (issue.deleted === true) {
      // oxlint-disable-next-line no-await-in-loop -- Deleted right after creation.
      await deleteIssue(actors.alice, created.key);
    }

    const comments = issue.comments ?? [];

    for (const [position, [person, body, file]] of comments.entries()) {
      const attachment =
        file === undefined
          ? undefined
          : // oxlint-disable-next-line no-await-in-loop -- The comment links the upload.
            await uploadFile(actors[person], { issueKey: created.key }, file);

      // oxlint-disable-next-line no-await-in-loop -- Comments keep their order.
      const comment = await createComment(actors[person], created.key, {
        body:
          attachment === undefined
            ? body
            : `${body}\n\n[${attachment.filename}](${attachment.url})`,
      });

      ages.push({
        days:
          (issue.days * (comments.length - position)) / (comments.length + 1),
        id: comment.id,
      });
    }
  }

  return ages;
};

const seedWorkspace = async () => {
  const alice = await signInAs("alice");

  const actors = {
    alice,
    bob: await signInAs("bob"),
    carol: await signInAs("carol"),
  };

  const [draft] = await db<
    unknown[]
  >`select 1 from workspaces where slug = ${draftSlug}`;

  if (draft !== undefined) {
    await deleteWorkspace(alice, draftSlug);
  }

  await createWorkspace(alice, {
    color: "indigo",
    demo: true,
    name: "Acme Corp",
    slug: draftSlug,
  });
  await addMember(alice, draftSlug, { role: "member", username: "bob" });
  await addMember(alice, draftSlug, { role: "member", username: "carol" });

  const labels = new Map<string, string>();

  for (const [name, color] of [
    ["Bug", "red"],
    ["Feature", "blue"],
    ["Improvement", "teal"],
    ["Performance", "amber"],
    ["Security", "purple"],
    ["Docs", "gray"],
  ] as const satisfies [string, Color][]) {
    // oxlint-disable-next-line no-await-in-loop -- The label list keeps this order.
    const label = await createLabel(alice, draftSlug, { color, name });

    labels.set(name, label.id);
  }

  const ages: Age[] = [];

  for (const [key, name, icon, color, issues] of [
    ["ENG", "Engineering", "code", "indigo", engineering],
    ["DES", "Design", "palette", "pink", design],
  ] as const satisfies [string, string, ProjectIcon, Color, DemoIssue[]][]) {
    // oxlint-disable-next-line no-await-in-loop -- The sidebar lists projects in creation order.
    const project = await createProject(alice, draftSlug, {
      color,
      icon,
      key,
      name,
    });

    // oxlint-disable-next-line no-await-in-loop -- Issue keys follow creation order.
    const created = await addIssues(
      actors,
      key,
      project.statuses,
      labels,
      issues
    );

    ages.push(...created);
  }

  for (const [person, path, title, body, id, image] of pages) {
    const target = { path, slug: draftSlug };
    // oxlint-disable-next-line no-await-in-loop -- Pages keep their order among siblings.
    const page = await putPage(actors[person], target, { body, id, title });

    if (image !== undefined) {
      // oxlint-disable-next-line no-await-in-loop -- The body embeds the upload.
      const attachment = await uploadFile(
        actors[person],
        { pageId: page.id },
        asset(image)
      );

      // oxlint-disable-next-line no-await-in-loop -- Follows its upload.
      await putPage(actors[person], target, {
        body: withImage(body, attachment),
      });
    }
  }

  await deletePage(alice, draftSlug, "handbook/onboarding-2025");

  const days = db.array(
    ages.map((age) => age.days),
    "float8"
  );

  const ids = db.array(
    ages.map((age) => age.id),
    "uuid"
  );

  await db.begin(async (tx) => {
    await tx`
      update issues i set
        created_at = i.created_at - a.days * interval '1 day',
        updated_at = i.updated_at - a.days / 3 * interval '1 day',
        completed_at = i.completed_at - a.days / 3 * interval '1 day',
        canceled_at = i.canceled_at - a.days / 3 * interval '1 day'
      from unnest(${ids}, ${days}) a (id, days)
      where i.id = a.id
    `;
    await tx`
      update comments c set created_at = c.created_at - a.days * interval '1 day'
      from unnest(${ids}, ${days}) a (id, days)
      where c.id = a.id
    `;
    await tx`
      update attachments t set created_at = t.created_at - a.days * interval '1 day'
      from unnest(${ids}, ${days}) a (id, days)
      where t.issue_id = a.id
    `;
    await tx`
      update issue_events e set created_at = e.created_at - a.days * interval '1 day'
      from unnest(${ids}, ${days}) a (id, days)
      where e.kind = 'comment_created' and e.to_value = to_jsonb(a.id::text)
        or e.kind <> 'comment_created' and e.issue_id = a.id
    `;
    await tx`update workspaces set slug = 'acme' where slug = ${draftSlug}`;
  });

  console.info("Created workspace acme");
};

const RepoListSchema = v.array(v.object({ name: v.string() }));

const seedRepository = async () => {
  const [owner, name] = repo.split("/");
  const repos = await gitea(RepoListSchema, `/orgs/${owner}/repos`);

  if (!repos.some((item) => item.name === name)) {
    await gitea(v.unknown(), `/orgs/${owner}/repos`, {
      body: JSON.stringify({
        default_branch: "main",
        description: "The Acme storefront",
        name,
      }),
      method: "POST",
    });
  }

  const branches = await gitea(
    v.nullish(RepoListSchema, []),
    `/repos/${repo}/branches`
  );

  const hasBranch = (branch: string) =>
    branches.some((item) => item.name === branch);

  if (!hasBranch("main")) {
    await gitea(v.unknown(), `/repos/${repo}/contents`, {
      body: JSON.stringify({
        branch: "main",
        files: fileChanges(app),
        message: "Serve the product list with prices",
      }),
      method: "POST",
    });
  }

  if (!hasBranch(prBranch)) {
    await gitea(v.unknown(), `/repos/${repo}/contents`, {
      body: JSON.stringify({
        branch: "main",
        files: fileChanges(feature),
        message: "Add localPrice for the customer's locale",
        new_branch: prBranch,
      }),
      method: "POST",
    });
  }

  const pulls = await gitea(
    v.array(v.object({ head: v.object({ ref: v.string() }) })),
    `/repos/${repo}/pulls?state=all`
  );

  if (!pulls.some((pull) => pull.head.ref === prBranch)) {
    await gitea(v.unknown(), `/repos/${repo}/pulls`, {
      body: JSON.stringify({
        base: "main",
        body: `${prIssue.description.split("\n\n")[0]}\n\nCloses [${prKey}].`,
        head: prBranch,
        title: `[${prKey}] ${prIssue.title}`,
      }),
      method: "POST",
    });
  }

  console.info(`Gitea repository ${repo} is ready`);
};

const [existing] = await db<
  unknown[]
>`select 1 from workspaces where slug = 'acme'`;

if (existing === undefined) {
  await seedWorkspace();
} else {
  console.info("Workspace acme exists, skipping");
}

await seedRepository();

await setExternalTracker(gitea, env.APP_URL, repo);

await settleEmbeddings();

await db.close();

console.info(
  `Demo ready: sign in at ${env.APP_URL} as alice, bob or carol with the password "password"`
);
