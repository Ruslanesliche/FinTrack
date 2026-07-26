import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const fintrackProfiles = sqliteTable("fintrack_profiles", {
  email: text("email").primaryKey(),
  displayName: text("display_name"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const fintrackSnapshots = sqliteTable(
  "fintrack_snapshots",
  {
    ownerEmail: text("owner_email")
      .primaryKey()
      .references(() => fintrackProfiles.email, { onDelete: "cascade" }),
    payload: text("payload").notNull(),
    revision: integer("revision").notNull().default(1),
    clientUpdatedAt: text("client_updated_at"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("fintrack_snapshots_updated_at_idx").on(table.updatedAt),
  ],
);
