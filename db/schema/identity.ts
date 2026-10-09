import {
  boolean,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { primaryKeyId, timestamps } from "./columns";
import { membershipRole, organizationKind, userStatus } from "./enums";

/**
 * Identity, ownership and who may do what.
 *
 * Cognito owns credentials. It holds the password hash, the MFA state and the
 * refresh tokens, and none of that is duplicated here. What lives in Postgres is
 * the part Cognito deliberately does not model: which organization a person acts
 * for, and what they are allowed to do inside it. A user row is created the first
 * time a Cognito id token is exchanged for a session, keyed by `cognito_sub`.
 */

export const users = pgTable(
  "users",
  {
    id: primaryKeyId(),

    /**
     * The Cognito `sub` claim: stable for the life of the account, unlike email.
     * This is the join between the token and the database, so it is unique and it
     * is never updated.
     */
    cognitoSub: text("cognito_sub").notNull(),

    /**
     * Copied from the token for display and for support lookups. `citext` would be
     * the better type, but it needs an extension enabled on the RDS instance, so
     * emails are folded to lower case on write by the application and the unique
     * index below is on the stored value.
     */
    email: text("email"),
    emailVerified: boolean("email_verified").default(false).notNull(),

    /** E.164, e.g. +9198…, because that is what Cognito and SMS both want. */
    phone: text("phone"),

    fullName: text("full_name").notNull(),

    /**
     * BCP-47 tag. Defaults to Hindi because the frontline user speaks it, and the
     * voice path is built around that assumption.
     */
    preferredLocale: text("preferred_locale").default("hi-IN").notNull(),

    status: userStatus("status").default("invited").notNull(),

    /** Last successful sign-in, mirrored from Cognito for an operational view. */
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),

    ...timestamps(),
  },
  (table) => [
    uniqueIndex("users_cognito_sub_uq").on(table.cognitoSub),
    uniqueIndex("users_email_uq").on(table.email),
    index("users_status_idx").on(table.status),
  ],
);

/**
 * Every actor in the system is one of these: a brand with an EPR obligation, a
 * CPCB-registered recycler, a municipality, a collector cooperative, or the
 * platform itself. Keeping them in one table means a load can point at a single
 * `organizations.id` whether the other side is a brand or a recycler.
 */
export const organizations = pgTable(
  "organizations",
  {
    id: primaryKeyId(),
    kind: organizationKind("kind").notNull(),

    name: text("name").notNull(),
    /** Registered name, when it differs from the trading name. */
    legalName: text("legal_name"),

    /** 15-character GSTIN. Absent for informal cooperatives and for the platform. */
    gstin: text("gstin"),

    /**
     * The CPCB registration number that makes a recycler legal to route hazardous
     * waste to. Null for every other kind — and a null here is exactly what stops a
     * load being routed there.
     */
    cpcbRegistrationNo: text("cpcb_registration_no"),

    city: text("city"),
    /** Free-form registered address; kept whole rather than normalised into parts. */
    address: text("address"),

    ...timestamps(),
  },
  (table) => [
    uniqueIndex("organizations_gstin_uq").on(table.gstin),
    uniqueIndex("organizations_cpcb_no_uq").on(table.cpcbRegistrationNo),
    index("organizations_kind_idx").on(table.kind),
  ],
);

/**
 * The authorisation table. Cognito decides *who* you are; this decides *what you
 * may do and for whom*, which is the half Cognito cannot answer because it has no
 * concept of a brand wanting access to one recycler's data and not another's.
 *
 * A membership is per (organization, user). The same person can be an operator at
 * a cooperative and a viewer at a brand, with different roles in each.
 */
export const organizationMembers = pgTable(
  "organization_members",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    role: membershipRole("role").notNull().default("viewer"),

    /** Null when access was granted by the platform rather than by a teammate. */
    invitedByUserId: uuid("invited_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),

    invitedAt: timestamp("invited_at", { withTimezone: true }),
    joinedAt: timestamp("joined_at", { withTimezone: true }),

    ...timestamps(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.userId] }),
    index("organization_members_user_idx").on(table.userId),
    index("organization_members_role_idx").on(table.organizationId, table.role),
  ],
);
