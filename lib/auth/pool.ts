import {
  AdminAddUserToGroupCommand,
  AdminGetUserCommand,
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  ListUsersInGroupCommand,
  type AttributeType,
} from "@aws-sdk/client-cognito-identity-provider";

import { ROLES, roleFromGroups, type Role } from "./roles";

/**
 * Who holds which role, read from and written to the Cognito pool.
 *
 * A role is a Cognito group carried on the person's token, so the database never holds a
 * copy. Reading the groups of other people, and changing them, needs AWS credentials
 * allowed to administer the pool, which the app does not otherwise hold. They are
 * `COGNITO_ADMIN_*` and not `AWS_*` for the reason the S3 keys are `S3_*`: Amplify Hosting
 * refuses any variable with the reserved AWS prefix. Without them the Team screen stays
 * read-only, as it was, and says so.
 *
 * The IAM policy needs, on this one user pool: `cognito-idp:ListUsers`,
 * `ListUsersInGroup`, `AdminGetUser`, `AdminListGroupsForUser`, `AdminAddUserToGroup` and
 * `AdminRemoveUserFromGroup`.
 */

export type PoolAccount = {
  /** Cognito username: the handle every admin API takes. */
  username: string;
  /** Null when the person holds no role group: signed up, waiting for one. */
  role: Role | null;
};

export type PoolRoles =
  | { readable: true; byEmail: Map<string, PoolAccount>; error: null }
  | { readable: false; byEmail: null; error: string | null };

/** Every group a role can come from, legacy `eco-owner` included, so a change clears it. */
const ROLE_GROUPS: readonly string[] = [...Object.keys(ROLES), "eco-owner"];

function adminClient(): { client: CognitoIdentityProviderClient; poolId: string } | null {
  const accessKeyId = process.env.COGNITO_ADMIN_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.COGNITO_ADMIN_SECRET_ACCESS_KEY?.trim();
  const poolId = process.env.COGNITO_USER_POOL_ID?.trim();
  const region = process.env.COGNITO_REGION?.trim();
  if (!accessKeyId || !secretAccessKey || !poolId || !region) return null;
  return {
    client: new CognitoIdentityProviderClient({ region, credentials: { accessKeyId, secretAccessKey } }),
    poolId,
  };
}

const attribute = (attributes: AttributeType[] | undefined, name: string): string | null =>
  attributes?.find((entry) => entry.Name === name)?.Value ?? null;

const describe = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").trim().slice(0, 200);

/** Each account's role, keyed by lower-cased email — the column the team list shares. */
export async function readPoolRoles(): Promise<PoolRoles> {
  const admin = adminClient();
  if (!admin) return { readable: false, byEmail: null, error: null };
  const { client, poolId } = admin;

  try {
    const groupsOf = new Map<string, string[]>();
    for (const group of ROLE_GROUPS) {
      let token: string | undefined;
      do {
        const page = await client.send(
          new ListUsersInGroupCommand({ UserPoolId: poolId, GroupName: group, NextToken: token }),
        );
        for (const user of page.Users ?? []) {
          if (user.Username) groupsOf.set(user.Username, [...(groupsOf.get(user.Username) ?? []), group]);
        }
        token = page.NextToken;
      } while (token);
    }

    const byEmail = new Map<string, PoolAccount>();
    let token: string | undefined;
    do {
      const page = await client.send(new ListUsersCommand({ UserPoolId: poolId, PaginationToken: token }));
      for (const user of page.Users ?? []) {
        const email = attribute(user.Attributes, "email")?.toLowerCase();
        if (!user.Username || !email) continue;
        byEmail.set(email, { username: user.Username, role: roleFromGroups(groupsOf.get(user.Username)) });
      }
      token = page.PaginationToken;
    } while (token);

    return { readable: true, byEmail, error: null };
  } catch (error) {
    return { readable: false, byEmail: null, error: `The user pool could not be read: ${describe(error)}` };
  }
}

export type RoleChange =
  | { ok: true; role: Role }
  | { ok: false; status: 404 | 409 | 503; message: string };

/**
 * Put a person in exactly one role group.
 *
 * The new group is added before the old ones are removed, so a failure part-way leaves
 * the person with both roles — the stronger wins until someone retries — rather than
 * with none and locked out. Nobody can change their own role: the last admin demoting
 * themselves would leave nobody able to undo it.
 */
export async function setPoolRole(username: string, role: Role, actingSub: string): Promise<RoleChange> {
  const admin = adminClient();
  if (!admin) {
    return {
      ok: false,
      status: 503,
      message:
        "Roles cannot be changed from the app: COGNITO_ADMIN_ACCESS_KEY_ID and COGNITO_ADMIN_SECRET_ACCESS_KEY are not set. Change it in the Cognito console.",
    };
  }
  const { client, poolId } = admin;

  try {
    const user = await client.send(new AdminGetUserCommand({ UserPoolId: poolId, Username: username }));
    if (attribute(user.UserAttributes, "sub") === actingSub) {
      return { ok: false, status: 409, message: "You cannot change your own role. Ask another admin." };
    }
  } catch (error) {
    if (error instanceof Error && error.name === "UserNotFoundException") {
      return { ok: false, status: 404, message: "No account with that username is in the pool." };
    }
    return { ok: false, status: 503, message: `The user pool could not be read: ${describe(error)}` };
  }

  try {
    await client.send(new AdminAddUserToGroupCommand({ UserPoolId: poolId, Username: username, GroupName: role }));
    const current = await client.send(new AdminListGroupsForUserCommand({ UserPoolId: poolId, Username: username }));
    for (const group of current.Groups ?? []) {
      const name = group.GroupName;
      if (!name || name === role || !ROLE_GROUPS.includes(name)) continue;
      await client.send(new AdminRemoveUserFromGroupCommand({ UserPoolId: poolId, Username: username, GroupName: name }));
    }
    return { ok: true, role };
  } catch (error) {
    return { ok: false, status: 503, message: `The role was not changed: ${describe(error)}` };
  }
}
