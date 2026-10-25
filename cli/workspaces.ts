import { createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import { Option } from "commander";
import type { Command } from "commander";

import type { ApiToken, Attachment } from "../src/lib/api-types.ts";
import { colors } from "../src/lib/colors.ts";
import type { Color } from "../src/lib/colors.ts";
import { projectIcons } from "../src/lib/project-icons.ts";
import type { ProjectIcon } from "../src/lib/project-icons.ts";
import {
  action,
  call,
  changes,
  CliError,
  collect,
  confirm,
  download,
  fileForm,
  localTime,
  readConfig,
  table,
  usageError,
  workspaceOf,
  yesFlags,
} from "./client.ts";
import type { Config, Scope } from "./client.ts";

const colorOption = (description = "color") =>
  new Option("-c, --color <color>", description).choices(colors);

const workspaceOption = (command: Command) =>
  command.option("-w, --workspace <slug>", "workspace (default: flint link)");

const iconOption = () =>
  new Option("--icon <icon>", "icon").choices(projectIcons);

const nameFlag = "-n, --name <name>";
const usernameArgument = ["<username>", "Gitea username"] as const;

const roleOption = () =>
  new Option("--role <role>", "member role").choices(["admin", "member"]);

const registerWorkspaces = (program: Command) => {
  const workspace = program
    .command("workspace")
    .description("Work with workspaces");

  workspace
    .command("list")
    .description("List your workspaces")
    .action(
      action(async () => {
        const workspaces = await call(await readConfig(), "GET /workspaces");

        return {
          result: workspaces,
          text: () =>
            table([
              ["SLUG", "ROLE", "NAME"],
              ...workspaces.map(({ name, role, slug }) => [slug, role, name]),
            ]),
        };
      })
    );

  workspaceOption(
    workspace
      .command("view")
      .description("Show a workspace")
      .argument("[slug]", "workspace slug (default: -w or flint link)")
  ).action(
    action(async (slug: string | undefined, options: Scope) => {
      if (slug !== undefined && options.workspace !== undefined) {
        throw usageError("Pass the workspace slug or -w, not both");
      }

      const config = await readConfig();

      return {
        result: await call(config, "GET /workspaces/:slug", {
          params: { slug: slug ?? (await workspaceOf(config, options)) },
        }),
      };
    })
  );

  workspace
    .command("create")
    .description("Create a workspace; you become its admin")
    .argument("<slug>", "URL name, such as acme")
    .requiredOption(nameFlag, "display name")
    .addOption(colorOption())
    .option("--demo", "add a Getting started project and a wiki guide")
    .action(
      action(
        async (
          slug: string,
          options: { color?: Color; demo?: boolean; name: string }
        ) => ({
          result: await call(await readConfig(), "POST /workspaces", {
            body: {
              color: options.color,
              demo: options.demo,
              name: options.name,
              slug,
            },
          }),
        })
      )
    );

  workspaceOption(
    workspace
      .command("update")
      .description("Rename a workspace, change its slug or color (admin)")
      .option(nameFlag, "display name")
      .option("--slug <slug>", "new URL name")
      .addOption(colorOption())
  ).action(
    action(
      async (
        options: Scope & { color?: Color; name?: string; slug?: string }
      ) => {
        const body = changes("PATCH /workspaces/:slug", {
          color: options.color,
          name: options.name,
          slug: options.slug,
        });

        const config = await readConfig();

        return {
          result: await call(config, "PATCH /workspaces/:slug", {
            body,
            params: { slug: await workspaceOf(config, options) },
          }),
        };
      }
    )
  );

  workspace
    .command("delete")
    .description("Delete a workspace with everything in it (admin)")
    .argument("<slug>", "workspace slug")
    .option(...yesFlags)
    .action(
      action(async (slug: string, options: { yes?: boolean }) => {
        await confirm(
          `Delete workspace ${slug} with all its projects, issues and wiki pages?`,
          options.yes
        );
        await call(await readConfig(), "DELETE /workspaces/:slug", {
          params: { slug },
        });

        return { result: { deleted: slug }, text: () => `Deleted ${slug}` };
      })
    );

  workspaceOption(
    workspace
      .command("logo")
      .description(
        "Set the workspace logo from an image file, or remove it (admin)"
      )
      .argument("[file]", "PNG, JPEG, WebP or AVIF image")
      .option("--remove", "remove the logo")
      .option(...yesFlags)
  ).action(
    action(
      async (
        file: string | undefined,
        options: Scope & { remove?: boolean; yes?: boolean }
      ) => {
        if ((file === undefined) === (options.remove !== true)) {
          throw usageError("Pass an image file or --remove");
        }

        const config = await readConfig();
        const params = { slug: await workspaceOf(config, options) };

        if (file === undefined) {
          await confirm(
            `Remove the logo of workspace ${params.slug}?`,
            options.yes
          );
        }

        return {
          result:
            file === undefined
              ? await call(config, "DELETE /workspaces/:slug/logo", { params })
              : await call(config, "PUT /workspaces/:slug/logo", {
                  body: await fileForm(file),
                  params,
                }),
        };
      }
    )
  );
};

const registerProjects = (program: Command) => {
  const project = program.command("project").description("Work with projects");

  workspaceOption(
    project.command("list").description("List the projects of a workspace")
  ).action(
    action(async (options: Scope) => {
      const config = await readConfig();

      const projects = await call(config, "GET /workspaces/:slug/projects", {
        params: { slug: await workspaceOf(config, options) },
      });

      return {
        result: projects,
        text: () =>
          table([
            ["KEY", "NAME"],
            ...projects.map(({ key, name }) => [key, name]),
          ]),
      };
    })
  );

  project
    .command("view")
    .description("Show a project with its statuses")
    .argument("<key>", "project key")
    .action(
      action(async (key: string) => {
        const found = await call(await readConfig(), "GET /projects/:key", {
          params: { key },
        });

        return {
          result: found,
          text: () =>
            `${found.key}  ${found.name} (${found.workspaceSlug})\n${found.statuses
              .map((status) => `  ${status.name} (${status.category})`)
              .join("\n")}`,
        };
      })
    );

  workspaceOption(
    project
      .command("create")
      .description("Create a project (admin)")
      .argument("<key>", "2-5 letters or digits, used in issue keys")
      .requiredOption(nameFlag, "project name")
      .addOption(colorOption().default("gray"))
      .addOption(iconOption())
  ).action(
    action(
      async (
        key: string,
        options: Scope & { color: Color; icon?: ProjectIcon; name: string }
      ) => {
        const config = await readConfig();

        return {
          result: await call(config, "POST /workspaces/:slug/projects", {
            body: {
              color: options.color,
              icon: options.icon,
              key,
              name: options.name,
            },
            params: { slug: await workspaceOf(config, options) },
          }),
        };
      }
    )
  );

  project
    .command("update")
    .description("Rename a project or change its color or icon (admin)")
    .argument("<key>", "project key (it never changes)")
    .option(nameFlag, "project name")
    .addOption(colorOption())
    .addOption(iconOption())
    .action(
      action(
        async (
          key: string,
          options: { color?: Color; icon?: ProjectIcon; name?: string }
        ) => ({
          result: await call(await readConfig(), "PATCH /projects/:key", {
            body: changes("PATCH /projects/:key", {
              color: options.color,
              icon: options.icon,
              name: options.name,
            }),
            params: { key },
          }),
        })
      )
    );

  project
    .command("delete")
    .description("Delete a project with its issues (admin)")
    .argument("<key>", "project key")
    .option(...yesFlags)
    .action(
      action(async (key: string, options: { yes?: boolean }) => {
        await confirm(
          `Delete project ${key} with all its issues?`,
          options.yes
        );
        await call(await readConfig(), "DELETE /projects/:key", {
          params: { key },
        });

        return { result: { deleted: key }, text: () => `Deleted ${key}` };
      })
    );
};

const memberParams = async (
  config: Config,
  scope: Scope,
  username: string
) => ({
  slug: await workspaceOf(config, scope),
  username: username.replace(/^@/u, ""),
});

const registerMembers = (program: Command) => {
  const member = program
    .command("member")
    .description("Work with workspace members");

  workspaceOption(
    member.command("list").description("List members and pending invites")
  ).action(
    action(async (options: Scope) => {
      const config = await readConfig();

      const members = await call(config, "GET /workspaces/:slug/members", {
        params: { slug: await workspaceOf(config, options) },
      });

      return {
        result: members,
        text: () =>
          table([
            ["USERNAME", "ROLE", "NAME"],
            ...members.map((item) => [
              `@${item.username}`,
              item.pending ? `${item.role} (invited)` : item.role,
              item.displayName,
            ]),
          ]),
      };
    })
  );

  workspaceOption(
    member
      .command("add")
      .description("Add a Gitea user to the workspace (admin)")
      .argument(...usernameArgument)
      .addOption(roleOption().default("member"))
  ).action(
    action(
      async (
        username: string,
        options: Scope & { role: "admin" | "member" }
      ) => {
        const config = await readConfig();

        return {
          result: await call(config, "POST /workspaces/:slug/members", {
            body: { role: options.role, username },
            params: { slug: await workspaceOf(config, options) },
          }),
        };
      }
    )
  );

  workspaceOption(
    member
      .command("update")
      .description("Change the role of a member (admin)")
      .argument(...usernameArgument)
      .addOption(roleOption().makeOptionMandatory())
  ).action(
    action(
      async (
        username: string,
        options: Scope & { role: "admin" | "member" }
      ) => {
        const config = await readConfig();

        return {
          result: await call(
            config,
            "PATCH /workspaces/:slug/members/:username",
            {
              body: { role: options.role },
              params: await memberParams(config, options, username),
            }
          ),
        };
      }
    )
  );

  workspaceOption(
    member
      .command("remove")
      .description("Remove a member or invite (admin, or yourself)")
      .argument(...usernameArgument)
      .option(...yesFlags)
  ).action(
    action(async (username: string, options: Scope & { yes?: boolean }) => {
      await confirm(`Remove @${username} from the workspace?`, options.yes);

      const config = await readConfig();

      await call(config, "DELETE /workspaces/:slug/members/:username", {
        params: await memberParams(config, options, username),
      });

      return {
        result: { removed: username },
        text: () => `Removed @${username}`,
      };
    })
  );
};

const findLabel = async (config: Config, scope: Scope, name: string) => {
  const labels = await call(config, "GET /workspaces/:slug/labels", {
    params: { slug: await workspaceOf(config, scope) },
  });

  const label = labels.find(
    (candidate) =>
      candidate.id === name ||
      candidate.name.toLowerCase() === name.toLowerCase()
  );

  if (label === undefined) {
    const message = `Unknown label “${name}”`;

    throw new CliError(message, 1, { error: { code: "not_found", message } });
  }

  return label;
};

const registerLabels = (program: Command) => {
  const label = program.command("label").description("Work with labels");

  workspaceOption(
    label.command("list").description("List the labels of a workspace")
  ).action(
    action(async (options: Scope) => {
      const config = await readConfig();

      const labels = await call(config, "GET /workspaces/:slug/labels", {
        params: { slug: await workspaceOf(config, options) },
      });

      return {
        result: labels,
        text: () =>
          table([
            ["NAME", "COLOR", "ID"],
            ...labels.map(({ color, id, name }) => [name, color, id]),
          ]),
      };
    })
  );

  workspaceOption(
    label
      .command("create")
      .description("Create a label")
      .argument("<name>", "label name")
      .addOption(colorOption().default("gray"))
  ).action(
    action(async (name: string, options: Scope & { color: Color }) => {
      const config = await readConfig();

      return {
        result: await call(config, "POST /workspaces/:slug/labels", {
          body: { color: options.color, name },
          params: { slug: await workspaceOf(config, options) },
        }),
      };
    })
  );

  workspaceOption(
    label
      .command("update")
      .description("Rename a label or change its color")
      .argument("<label>", "label name or id")
      .option(nameFlag, "new name")
      .addOption(colorOption())
  ).action(
    action(
      async (
        name: string,
        options: Scope & { color?: Color; name?: string }
      ) => {
        const body = changes("PATCH /labels/:labelId", {
          color: options.color,
          name: options.name,
        });

        const config = await readConfig();
        const found = await findLabel(config, options, name);

        return {
          result: await call(config, "PATCH /labels/:labelId", {
            body,
            params: { labelId: found.id },
          }),
        };
      }
    )
  );

  workspaceOption(
    label
      .command("delete")
      .description("Delete a label and remove it from issues")
      .argument("<label>", "label name or id")
      .option(...yesFlags)
  ).action(
    action(async (name: string, options: Scope & { yes?: boolean }) => {
      await confirm(`Delete label ${name}?`, options.yes);

      const config = await readConfig();
      const found = await findLabel(config, options, name);

      await call(config, "DELETE /labels/:labelId", {
        params: { labelId: found.id },
      });

      return {
        result: { deleted: found.id },
        text: () => `Deleted ${found.name}`,
      };
    })
  );
};

const tokenScope = (token: ApiToken) =>
  token.workspaces?.map(({ slug }) => slug).join(",") ?? "all";

const registerTokens = (program: Command) => {
  const token = program.command("token").description("Manage your API tokens");

  token
    .command("list")
    .description("List your API tokens")
    .action(
      action(async () => {
        const tokens = await call(await readConfig(), "GET /me/tokens");

        return {
          result: tokens,
          text: () =>
            table([
              ["ID", "NAME", "WORKSPACES", "LAST USED"],
              ...tokens.map((item) => [
                item.id,
                item.name,
                tokenScope(item),
                item.lastUsedAt === null ? "never" : localTime(item.lastUsedAt),
              ]),
            ]),
        };
      })
    );

  token
    .command("create")
    .description("Create an API token; it is shown only once")
    .argument("<name>", "token name")
    .option(
      "-w, --workspace <slug>",
      "restrict the token to a workspace (repeat for several)",
      collect
    )
    .action(
      action(async (name: string, options: { workspace?: string[] }) => {
        const created = await call(await readConfig(), "POST /me/tokens", {
          body: { name, workspaces: options.workspace },
        });

        return {
          result: created,
          text: () =>
            `${created.token}\nStore it now: Flint shows a token only once.`,
        };
      })
    );

  token
    .command("revoke")
    .description("Revoke an API token")
    .argument("<id>", "token id")
    .option(...yesFlags)
    .action(
      action(async (id: string, options: { yes?: boolean }) => {
        await confirm(`Revoke token ${id}?`, options.yes);
        await call(await readConfig(), "DELETE /me/tokens/:tokenId", {
          params: { tokenId: id },
        });

        return { result: { revoked: id }, text: () => `Revoked ${id}` };
      })
    );
};

const attachmentRows = (attachments: Attachment[]) =>
  table(attachments.map((item) => [item.id, item.filename, item.url]));

const registerAttachments = (program: Command) => {
  const attachment = program
    .command("attachment")
    .description(
      "List, download and delete files attached to issues and pages"
    );

  workspaceOption(
    attachment
      .command("list")
      .description("List the files of an issue or a wiki page")
      .argument("[key]", "issue key, the same as -i")
      .option("-i, --issue <key>", "issue key")
      .option("--page <path>", "wiki page path")
  ).action(
    action(
      async (
        key: string | undefined,
        options: Scope & { issue?: string; page?: string }
      ) => {
        const issueKey = key ?? options.issue;

        if (
          (key !== undefined && options.issue !== undefined) ||
          (issueKey === undefined) === (options.page === undefined)
        ) {
          throw usageError("Pass an issue key (or -i <key>) or --page <path>");
        }

        const config = await readConfig();

        if (issueKey !== undefined) {
          const attachments = await call(
            config,
            "GET /issues/:issueKey/attachments",
            { params: { issueKey } }
          );

          return {
            result: attachments,
            text: () => attachmentRows(attachments),
          };
        }

        const page = await call(config, "GET /workspaces/:slug/wiki/*", {
          params: {
            _splat: options.page ?? "",
            slug: await workspaceOf(config, options),
          },
        });

        const attachments = await call(
          config,
          "GET /wiki/:pageId/attachments",
          {
            params: { pageId: page.id },
          }
        );

        return { result: attachments, text: () => attachmentRows(attachments) };
      }
    )
  );

  attachment
    .command("download")
    .description("Download an attachment")
    .argument("<id>", "attachment id")
    .option(
      "-o, --output <path>",
      "file to write (default: the attachment's name, never overwritten)"
    )
    .action(
      action(async (id: string, options: { output?: string }) => {
        const file = await download(await readConfig(), id);
        const target = options.output ?? path.basename(file.filename);

        try {
          await pipeline(
            file.body,
            createWriteStream(target, {
              flags: options.output === undefined ? "wx" : "w",
            })
          );
        } catch (error) {
          if (
            error instanceof Error &&
            "code" in error &&
            error.code === "EEXIST"
          ) {
            throw new CliError(`${target} exists; pass -o <path>`, 1);
          }

          throw error;
        }

        const { size } = await stat(target);

        return {
          result: { id, path: target, size },
          text: () => `Saved ${target} (${size} bytes)`,
        };
      })
    );

  attachment
    .command("delete")
    .description("Delete an attachment")
    .argument("<id>", "attachment id")
    .option(...yesFlags)
    .action(
      action(async (id: string, options: { yes?: boolean }) => {
        await confirm(`Delete attachment ${id}?`, options.yes);
        await call(await readConfig(), "DELETE /attachments/:attachmentId", {
          params: { attachmentId: id },
        });

        return { result: { deleted: id }, text: () => `Deleted ${id}` };
      })
    );
};

export const registerWorkspaceCommands = (program: Command) => {
  registerWorkspaces(program);
  registerProjects(program);
  registerMembers(program);
  registerLabels(program);
  registerTokens(program);
  registerAttachments(program);
};
