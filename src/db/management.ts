import * as mysql2 from "mysql2/promise";
import { log } from "../utils/index.js";
import {
  mcpConfig as config,
  ALLOW_OBJECT_MANAGEMENT,
  ALLOW_USER_MANAGEMENT,
  ALLOW_PRIVILEGE_MANAGEMENT,
} from "../config/index.js";
import {
  extractSchemaFromQuery,
  getQueryTypes,
} from "./utils.js";

let poolPromise: Promise<mysql2.Pool>;

const getPool = (): Promise<mysql2.Pool> => {
  if (!poolPromise) {
    poolPromise = new Promise((resolve) => resolve(mysql2.createPool(config.mysql)));
  }
  return poolPromise;
};

async function exec(sql: string, params: string[] = []) {
  const pool = await getPool();
  const connection = await pool.getConnection();
  try {
    const result = await connection.query(sql, params);
    return Array.isArray(result) ? result[0] : result;
  } finally {
    connection.release();
  }
}

function toText(result: unknown, duration: number, ok = true) {
  return {
    content: [
      { type: "text", text: JSON.stringify(result, null, 2) },
      { type: "text", text: `Query execution time: ${duration.toFixed(2)} ms` },
    ],
    isError: !ok,
  };
}

function bad(name: string, message: string) {
  log("error", `[management] ${name}: ${message}`);
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

function checkFlag(name: string, flag: boolean) {
  if (!flag) {
    return bad(name, `This operation requires ${name}=true`);
  }
  return null;
}

function schemaFrom(sql: string | undefined) {
  if (!sql) return null;
  return extractSchemaFromQuery(sql);
}

type ManagementResult = {
  content: { type: string; text: string }[];
  isError: boolean;
};

function withTimer<T>(name: string, fn: () => Promise<T>): Promise<ManagementResult> {
  const start = performance.now();
  return fn().then((result) => {
    const duration = performance.now() - start;
    if (result && typeof result === "object" && "isError" in result) {
      return result as unknown as ManagementResult;
    }
    return toText(result as unknown, duration);
  });
}

/* -------------------- object management -------------------- */

export async function listViews(args: { database?: string }) {
  const denied = checkFlag("ALLOW_OBJECT_MANAGEMENT", ALLOW_OBJECT_MANAGEMENT);
  if (denied) return denied;

  const db = args.database ? `'${String(args.database).replace(/'/g, "''")}'` : "DATABASE()";
  const sql = `
    SELECT TABLE_SCHEMA AS database_name, TABLE_NAME AS view_name, VIEW_DEFINITION AS view_definition
    FROM information_schema.VIEWS
    WHERE TABLE_SCHEMA = ${db}
    ORDER BY TABLE_SCHEMA, TABLE_NAME
  `;
  return withTimer("listViews", () => exec(sql));
}

export async function createView(args: { sql: string }) {
  const denied = checkFlag("ALLOW_OBJECT_MANAGEMENT", ALLOW_OBJECT_MANAGEMENT);
  if (denied) return denied;

  const sql = String(args.sql).trim();
  if (!/^CREATE\s+OR\s+REPLACE\s+VIEW/i.test(sql) && !/^CREATE\s+VIEW/i.test(sql)) {
    return bad("createView", "Only CREATE VIEW / CREATE OR REPLACE VIEW is allowed here.");
  }
  return withTimer("createView", () => exec(sql));
}

export async function dropView(args: { sql: string }) {
  const denied = checkFlag("ALLOW_OBJECT_MANAGEMENT", ALLOW_OBJECT_MANAGEMENT);
  if (denied) return denied;

  const sql = String(args.sql).trim();
  if (!/^DROP\s+VIEW/i.test(sql)) {
    return bad("dropView", "Only DROP VIEW is allowed here.");
  }
  return withTimer("dropView", () => exec(sql));
}

export async function listRoutines(args: { database?: string; type?: "PROCEDURE" | "FUNCTION" } = {}) {
  const denied = checkFlag("ALLOW_OBJECT_MANAGEMENT", ALLOW_OBJECT_MANAGEMENT);
  if (denied) return denied;

  const type = (args.type || "PROCEDURE").toUpperCase();
  const db = args.database ? `'${String(args.database).replace(/'/g, "''")}'` : "DATABASE()";
  const sql = `
    SELECT ROUTINE_SCHEMA AS database_name, ROUTINE_NAME, ROUTINE_TYPE, DEFINER, CREATED, LAST_ALTERED, SQL_MODE, ROUTINE_DEFINITION
    FROM information_schema.ROUTINES
    WHERE ROUTINE_SCHEMA = ${db} AND ROUTINE_TYPE = '${type.replace(/'/g, "''")}'
    ORDER BY ROUTINE_NAME
  `;
  return withTimer("listRoutines", () => exec(sql));
}

export async function dropRoutine(args: { sql: string }) {
  const denied = checkFlag("ALLOW_OBJECT_MANAGEMENT", ALLOW_OBJECT_MANAGEMENT);
  if (denied) return denied;

  const sql = String(args.sql).trim();
  if (!/^DROP\s+(PROCEDURE|FUNCTION)/i.test(sql)) {
    return bad("dropRoutine", "Only DROP PROCEDURE / DROP FUNCTION is allowed here.");
  }
  return withTimer("dropRoutine", () => exec(sql));
}

/* -------------------- user management -------------------- */

export async function listUsers() {
  const denied = checkFlag("ALLOW_USER_MANAGEMENT", ALLOW_USER_MANAGEMENT);
  if (denied) return denied;

  return withTimer("listUsers", () => exec(`SELECT User, Host, account_locked, password_expired FROM mysql.user ORDER BY User, Host`));
}

export async function createUser(args: { sql: string }) {
  const denied = checkFlag("ALLOW_USER_MANAGEMENT", ALLOW_USER_MANAGEMENT);
  if (denied) return denied;

  const sql = String(args.sql).trim();
  if (!/^CREATE\s+USER/i.test(sql)) {
    return bad("createUser", "Only CREATE USER is allowed here.");
  }
  return withTimer("createUser", () => exec(sql));
}

export async function dropUser(args: { sql: string }) {
  const denied = checkFlag("ALLOW_USER_MANAGEMENT", ALLOW_USER_MANAGEMENT);
  if (denied) return denied;

  const sql = String(args.sql).trim();
  if (!/^DROP\s+USER/i.test(sql)) {
    return bad("dropUser", "Only DROP USER is allowed here.");
  }
  return withTimer("dropUser", () => exec(sql));
}

export async function alterUser(args: { sql: string }) {
  const denied = checkFlag("ALLOW_USER_MANAGEMENT", ALLOW_USER_MANAGEMENT);
  if (denied) return denied;

  const sql = String(args.sql).trim();
  if (!/^ALTER\s+USER/i.test(sql)) {
    return bad("alterUser", "Only ALTER USER is allowed here.");
  }
  return withTimer("alterUser", () => exec(sql));
}

export async function setPassword(args: { sql: string }) {
  const denied = checkFlag("ALLOW_USER_MANAGEMENT", ALLOW_USER_MANAGEMENT);
  if (denied) return denied;

  const sql = String(args.sql).trim();
  if (!/^SET\s+PASSWORD/i.test(sql) && !/^ALTER\s+USER.*IDENTIFIED\s+BY/i.test(sql)) {
    return bad("setPassword", "Only SET PASSWORD or ALTER USER ... IDENTIFIED BY is allowed here.");
  }
  return withTimer("setPassword", () => exec(sql));
}

/* -------------------- privilege management -------------------- */

export async function flushPrivileges(args: { sql?: string } = {}) {
  const denied = checkFlag("ALLOW_PRIVILEGE_MANAGEMENT", ALLOW_PRIVILEGE_MANAGEMENT);
  if (denied) return denied;

  const sql =
    args.sql && String(args.sql).trim()
      ? String(args.sql).trim()
      : "FLUSH PRIVILEGES";
  return withTimer("flushPrivileges", () => exec(sql));
}

export async function showGrants(args: { sql?: string } = {}) {
  const denied = checkFlag("ALLOW_PRIVILEGE_MANAGEMENT", ALLOW_PRIVILEGE_MANAGEMENT);
  if (denied) return denied;

  const sql =
    args.sql && String(args.sql).trim()
      ? String(args.sql).trim()
      : "SHOW GRANTS FOR CURRENT_USER()";
  return withTimer("showGrants", () => exec(sql));
}

export async function grantPrivilege(args: { sql: string }) {
  const denied = checkFlag("ALLOW_PRIVILEGE_MANAGEMENT", ALLOW_PRIVILEGE_MANAGEMENT);
  if (denied) return denied;

  const sql = String(args.sql).trim();
  if (!/^GRANT\s+/i.test(sql)) {
    return bad("grantPrivilege", "Only GRANT is allowed here.");
  }
  return withTimer("grantPrivilege", () => exec(sql));
}

export async function revokePrivilege(args: { sql: string }) {
  const denied = checkFlag("ALLOW_PRIVILEGE_MANAGEMENT", ALLOW_PRIVILEGE_MANAGEMENT);
  if (denied) return denied;

  const sql = String(args.sql).trim();
  if (!/^REVOKE\s+/i.test(sql)) {
    return bad("revokePrivilege", "Only REVOKE is allowed here.");
  }
  return withTimer("revokePrivilege", () => exec(sql));
}
