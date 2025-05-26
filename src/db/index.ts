import {
  ALLOW_DELETE_OPERATION,
  ALLOW_DDL_OPERATION,
  ALLOW_INSERT_OPERATION,
  ALLOW_UPDATE_OPERATION,
  SCHEMA_DELETE_PERMISSIONS,
  SCHEMA_DDL_PERMISSIONS,
  SCHEMA_INSERT_PERMISSIONS,
  SCHEMA_UPDATE_PERMISSIONS,
  isMultiDbMode,
} from "./../config/index.js";

import * as mysql2 from "mysql2/promise";
import SqlParser, { AST } from "node-sql-parser";
import { log } from "./../utils/index.js";
import { mcpConfig as config } from "./../config/index.js";

const { Parser } = SqlParser;
const parser = new Parser();

// Force read-only mode in multi-DB mode unless explicitly configured otherwise
if (isMultiDbMode && process.env.MULTI_DB_WRITE_MODE !== "true") {
  log("error", "Multi-DB mode detected - enabling read-only mode for safety");
}

// @INFO: Check if running in test mode
const isTestEnvironment = process.env.NODE_ENV === "test" || process.env.VITEST;

// @INFO: Safe way to exit process (not during tests)
// @INFO: Move this back to *main* index.ts
function safeExit(code: number): void {
  if (!isTestEnvironment) {
    process.exit(code);
  } else {
    log("error", `[Test mode] Would have called process.exit(${code})`);
  }
}

// Schema permission checking functions
function isInsertAllowedForSchema(schema: string | null): boolean {
  if (!schema) {
    return ALLOW_INSERT_OPERATION;
  }
  return schema in SCHEMA_INSERT_PERMISSIONS
    ? SCHEMA_INSERT_PERMISSIONS[schema]
    : ALLOW_INSERT_OPERATION;
}

function isUpdateAllowedForSchema(schema: string | null): boolean {
  if (!schema) {
    return ALLOW_UPDATE_OPERATION;
  }
  return schema in SCHEMA_UPDATE_PERMISSIONS
    ? SCHEMA_UPDATE_PERMISSIONS[schema]
    : ALLOW_UPDATE_OPERATION;
}

function isDeleteAllowedForSchema(schema: string | null): boolean {
  if (!schema) {
    return ALLOW_DELETE_OPERATION;
  }
  return schema in SCHEMA_DELETE_PERMISSIONS
    ? SCHEMA_DELETE_PERMISSIONS[schema]
    : ALLOW_DELETE_OPERATION;
}

function isDDLAllowedForSchema(schema: string | null): boolean {
  if (!schema) {
    return ALLOW_DDL_OPERATION;
  }
  return schema in SCHEMA_DDL_PERMISSIONS
    ? SCHEMA_DDL_PERMISSIONS[schema]
    : ALLOW_DDL_OPERATION;
}

// Extract schema from SQL query
function extractSchemaFromQuery(sql: string): string | null {
  // Default schema from environment
  const defaultSchema = process.env.MYSQL_DB || null;

  // If we have a default schema and not in multi-DB mode, return it
  if (defaultSchema && !isMultiDbMode) {
    return defaultSchema;
  }

  // Try to extract schema from query

  // Case 1: USE database statement
  const useMatch = sql.match(/USE\s+`?([a-zA-Z0-9_]+)`?/i);
  if (useMatch && useMatch[1]) {
    return useMatch[1];
  }

  // Case 2: database.table notation
  const dbTableMatch = sql.match(/`?([a-zA-Z0-9_]+)`?\.`?[a-zA-Z0-9_]+`?/i);
  if (dbTableMatch && dbTableMatch[1]) {
    return dbTableMatch[1];
  }

  // Return default if we couldn't find a schema in the query
  return defaultSchema;
}

async function getQueryTypes(query: string): Promise<string[]> {
  try {
    log("info", "Parsing SQL query: ", query);
    // Parse into AST or array of ASTs - only specify the database type
    const astOrArray: AST | AST[] = parser.astify(query, { database: "mysql" });
    const statements = Array.isArray(astOrArray) ? astOrArray : [astOrArray];

    // Map each statement to its lowercased type (e.g., 'select', 'update', 'insert', 'delete', etc.)
    return statements.map((stmt) => stmt.type?.toLowerCase() ?? "unknown");
  } catch (err: any) {
    log("error", "sqlParser error, query: ", query);
    log("error", "Error parsing SQL query:", err);
    throw new Error(`Parsing failed: ${err.message}`);
  }
}

// @INFO: Lazy load MySQL pool
let poolPromise: Promise<mysql2.Pool>;

const getPool = (): Promise<mysql2.Pool> => {
  if (!poolPromise) {
    poolPromise = new Promise<mysql2.Pool>((resolve, reject) => {
      try {
        const pool = mysql2.createPool(config.mysql);
        log("info", "MySQL pool created successfully");
        resolve(pool);
      } catch (error) {
        log("error", "Error creating MySQL pool:", error);
        reject(error);
      }
    });
  }
  return poolPromise;
};

async function executeQuery<T>(sql: string, params: string[] = []): Promise<T> {
  let connection;
  try {
    const pool = await getPool();
    connection = await pool.getConnection();
    const result = await connection.query(sql, params);
    return (Array.isArray(result) ? result[0] : result) as T;
  } catch (error) {
    log("error", "Error executing query:", error);
    throw error;
  } finally {
    if (connection) {
      connection.release();
      log("error", "Connection released");
    }
  }
}

// @INFO: New function to handle write operations
async function executeWriteQuery<T>(sql: string): Promise<T> {
  let connection;
  try {
    const pool = await getPool();
    connection = await pool.getConnection();
    log("error", "Write connection acquired");

    // Extract schema for permissions (if needed)
    const schema = extractSchemaFromQuery(sql);

    // @INFO: Begin transaction for write operation
    await connection.beginTransaction();

    try {
      // @INFO: Execute the write query
      const result = await connection.query(sql);
      const response = Array.isArray(result) ? result[0] : result;

      // @INFO: Commit the transaction
      await connection.commit();

      // @INFO: Format the response based on operation type
      let responseText;

      // Check the type of query
      const queryTypes = await getQueryTypes(sql);
      const isUpdateOperation = queryTypes.some((type) =>
        ["update"].includes(type),
      );
      const isInsertOperation = queryTypes.some((type) =>
        ["insert"].includes(type),
      );
      const isDeleteOperation = queryTypes.some((type) =>
        ["delete"].includes(type),
      );
      const isDDLOperation = queryTypes.some((type) =>
        ["create", "alter", "drop", "truncate"].includes(type),
      );

      // @INFO: Type assertion for ResultSetHeader which has affectedRows, insertId, etc.
      if (isInsertOperation) {
        const resultHeader = response as mysql2.ResultSetHeader;
        responseText = `Insert successful on schema '${schema || "default"}'. Affected rows: ${resultHeader.affectedRows}, Last insert ID: ${resultHeader.insertId}`;
      } else if (isUpdateOperation) {
        const resultHeader = response as mysql2.ResultSetHeader;
        responseText = `Update successful on schema '${schema || "default"}'. Affected rows: ${resultHeader.affectedRows}, Changed rows: ${resultHeader.changedRows || 0}`;
      } else if (isDeleteOperation) {
        const resultHeader = response as mysql2.ResultSetHeader;
        responseText = `Delete successful on schema '${schema || "default"}'. Affected rows: ${resultHeader.affectedRows}`;
      } else if (isDDLOperation) {
        responseText = `DDL operation successful on schema '${schema || "default"}'.`;
      } else {
        responseText = JSON.stringify(response, null, 2);
      }

      return {
        content: [
          {
            type: "text",
            text: responseText,
          },
        ],
        isError: false,
      } as T;
    } catch (error: unknown) {
      // @INFO: Rollback on error
      log("error", "Error executing write query:", error);
      await connection.rollback();

      return {
        content: [
          {
            type: "text",
            text: `Error executing write operation: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      } as T;
    }
  } catch (error: unknown) {
    log("error", "Error in write operation transaction:", error);
    return {
      content: [
        {
          type: "text",
          text: `Database connection error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    } as T;
  } finally {
    if (connection) {
      connection.release();
      log("error", "Write connection released");
    }
  }
}

async function executeReadOnlyQuery<T>(sql: string): Promise<T> {
  let connection;
  try {
    // Check the type of query
    const queryTypes = await getQueryTypes(sql);

    // Get schema for permission checking
    const schema = extractSchemaFromQuery(sql);

    const isUpdateOperation = queryTypes.some((type) =>
      ["update"].includes(type),
    );
    const isInsertOperation = queryTypes.some((type) =>
      ["insert"].includes(type),
    );
    const isDeleteOperation = queryTypes.some((type) =>
      ["delete"].includes(type),
    );
    const isDDLOperation = queryTypes.some((type) =>
      ["create", "alter", "drop", "truncate"].includes(type),
    );

    // Check schema-specific permissions
    if (isInsertOperation && !isInsertAllowedForSchema(schema)) {
      log(
        "error",
        `INSERT operations are not allowed for schema '${schema || "default"}'. Configure SCHEMA_INSERT_PERMISSIONS.`,
      );
      return {
        content: [
          {
            type: "text",
            text: `Error: INSERT operations are not allowed for schema '${schema || "default"}'. Ask the administrator to update SCHEMA_INSERT_PERMISSIONS.`,
          },
        ],
        isError: true,
      } as T;
    }

    if (isUpdateOperation && !isUpdateAllowedForSchema(schema)) {
      log(
        "error",
        `UPDATE operations are not allowed for schema '${schema || "default"}'. Configure SCHEMA_UPDATE_PERMISSIONS.`,
      );
      return {
        content: [
          {
            type: "text",
            text: `Error: UPDATE operations are not allowed for schema '${schema || "default"}'. Ask the administrator to update SCHEMA_UPDATE_PERMISSIONS.`,
          },
        ],
        isError: true,
      } as T;
    }

    if (isDeleteOperation && !isDeleteAllowedForSchema(schema)) {
      log(
        "error",
        `DELETE operations are not allowed for schema '${schema || "default"}'. Configure SCHEMA_DELETE_PERMISSIONS.`,
      );
      return {
        content: [
          {
            type: "text",
            text: `Error: DELETE operations are not allowed for schema '${schema || "default"}'. Ask the administrator to update SCHEMA_DELETE_PERMISSIONS.`,
          },
        ],
        isError: true,
      } as T;
    }

    if (isDDLOperation && !isDDLAllowedForSchema(schema)) {
      log(
        "error",
        `DDL operations are not allowed for schema '${schema || "default"}'. Configure SCHEMA_DDL_PERMISSIONS.`,
      );
      return {
        content: [
          {
            type: "text",
            text: `Error: DDL operations are not allowed for schema '${schema || "default"}'. Ask the administrator to update SCHEMA_DDL_PERMISSIONS.`,
          },
        ],
        isError: true,
      } as T;
    }

    // For write operations that are allowed, use executeWriteQuery
    if (
      (isInsertOperation && isInsertAllowedForSchema(schema)) ||
      (isUpdateOperation && isUpdateAllowedForSchema(schema)) ||
      (isDeleteOperation && isDeleteAllowedForSchema(schema)) ||
      (isDDLOperation && isDDLAllowedForSchema(schema))
    ) {
      return executeWriteQuery(sql);
    }

    // For read-only operations, continue with the original logic
    const pool = await getPool();
    connection = await pool.getConnection();
    log("error", "Read-only connection acquired");

    // Set read-only mode
    await connection.query("SET SESSION TRANSACTION READ ONLY");

    // Begin transaction
    await connection.beginTransaction();

    try {
      // Execute query - in multi-DB mode, we may need to handle USE statements specially
      const result = await connection.query(sql);
      const rows = Array.isArray(result) ? result[0] : result;

      // Rollback transaction (since it's read-only)
      await connection.rollback();

      // Reset to read-write mode
      await connection.query("SET SESSION TRANSACTION READ WRITE");

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(rows, null, 2),
          },
        ],
        isError: false,
      } as T;
    } catch (error) {
      // Rollback transaction on query error
      log("error", "Error executing read-only query:", error);
      await connection.rollback();
      throw error;
    }
  } catch (error) {
    // Ensure we rollback and reset transaction mode on any error
    log("error", "Error in read-only query transaction:", error);
    try {
      if (connection) {
        await connection.rollback();
        await connection.query("SET SESSION TRANSACTION READ WRITE");
      }
    } catch (cleanupError) {
      // Ignore errors during cleanup
      log("error", "Error during cleanup:", cleanupError);
    }
    throw error;
  } finally {
    if (connection) {
      connection.release();
      log("error", "Read-only connection released");
    }
  }
}

export {
  isTestEnvironment,
  safeExit,
  isDeleteAllowedForSchema,
  isUpdateAllowedForSchema,
  isInsertAllowedForSchema,
  isDDLAllowedForSchema,
  extractSchemaFromQuery,
  getQueryTypes,
  executeQuery,
  getPool,
  executeWriteQuery,
  executeReadOnlyQuery,
  poolPromise,
};
