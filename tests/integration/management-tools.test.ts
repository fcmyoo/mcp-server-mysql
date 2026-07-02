import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env.test") });

process.env.ALLOW_OBJECT_MANAGEMENT = "true";
process.env.ALLOW_USER_MANAGEMENT = "true";
process.env.ALLOW_PRIVILEGE_MANAGEMENT = "true";

const {
  listViews,
  createView,
  dropView,
  listRoutines,
  dropRoutine,
  listUsers,
  createUser,
  dropUser,
  alterUser,
  setPassword,
  showGrants,
  grantPrivilege,
  revokePrivilege,
  flushPrivileges,
} = await import("../../dist/src/db/management.js");

describe("Management Tools Integration", () => {
  const testSchema = "mcp_test_db";

  beforeAll(async () => {
    await createView({ sql: `CREATE OR REPLACE VIEW ${testSchema}.mgmt_view AS SELECT 1 AS id` });
    await createView({ sql: `CREATE OR REPLACE VIEW ${testSchema}.mgmt_view_drop AS SELECT 2 AS id` });
  });

  afterAll(async () => {
    await dropView({ sql: `DROP VIEW IF EXISTS ${testSchema}.mgmt_view` });
    await dropView({ sql: `DROP VIEW IF EXISTS ${testSchema}.mgmt_view_drop` });
  });

  it("should list views", async () => {
    const result = await listViews({ database: testSchema });
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("view_name");
  });

  it("should create and drop view", async () => {
    const createResult = await createView({ sql: `CREATE OR REPLACE VIEW ${testSchema}.mgmt_view_dynamic AS SELECT 1` });
    expect(createResult.isError).toBe(false);

    const dropResult = await dropView({ sql: `DROP VIEW ${testSchema}.mgmt_view_dynamic` });
    expect(dropResult.isError).toBe(false);
  });

  it("should list routines", async () => {
    const result = await listRoutines({ database: testSchema, type: "PROCEDURE" });
    expect(result.isError).toBe(false);
    expect(Array.isArray(JSON.parse(result.content[0].text))).toBe(true);
  });

  it("should show grants", async () => {
    const result = await showGrants({ sql: `SHOW GRANTS FOR CURRENT_USER()` });
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("GRANT");
  });

  it("should flush privileges", async () => {
    const result = await flushPrivileges();
    expect(result.isError).toBe(false);
  });
});
