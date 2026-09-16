#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { log } from "./src/utils/index.js";
import type { TableRow, ColumnRow } from "./src/types/index.js";
import {
  ALLOW_DELETE_OPERATION,
  ALLOW_DDL_OPERATION,
  ALLOW_INSERT_OPERATION,
  ALLOW_OBJECT_MANAGEMENT,
  ALLOW_PRIVILEGE_MANAGEMENT,
  ALLOW_UPDATE_OPERATION,
  ALLOW_USER_MANAGEMENT,
  SCHEMA_DELETE_PERMISSIONS,
  SCHEMA_DDL_PERMISSIONS,
  SCHEMA_INSERT_PERMISSIONS,
  SCHEMA_UPDATE_PERMISSIONS,
  isMultiDbMode,
  mcpConfig as config,
  MCP_VERSION as version,
  IS_REMOTE_MCP,
  REMOTE_SECRET_KEY,
  PORT,
  ENABLE_PII_REDACTION,
  PII_EXTRA_COLUMNS,
  PII_EXTRA_COLUMN_PATTERNS,
} from "./src/config/index.js";
import { isPIIColumn, DEFAULT_PII_COLUMNS } from "./src/security/redact.js";
import {
  safeExit,
  getPool,
  executeQuery,
  executeReadOnlyQuery,
  poolPromise,
} from "./src/db/index.js";
import {
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
} from "./src/db/management.js";

import express, { Request, Response } from "express";
import { fileURLToPath } from 'url';
import { realpathSync } from 'fs';


log("info", `Starting MySQL MCP server v${version}...`);

// Update tool description to include multi-DB mode and schema-specific permissions
const toolVersion = `MySQL MCP Server [v${process.env.npm_package_version}]`;
let toolDescription = `[${toolVersion}] Run SQL queries against MySQL database`;

if (isMultiDbMode) {
  toolDescription += " (Multi-DB mode enabled)";
}

if (
  ALLOW_INSERT_OPERATION ||
  ALLOW_UPDATE_OPERATION ||
  ALLOW_DELETE_OPERATION ||
  ALLOW_DDL_OPERATION ||
  ALLOW_OBJECT_MANAGEMENT ||
  ALLOW_USER_MANAGEMENT ||
  ALLOW_PRIVILEGE_MANAGEMENT
) {
  // At least one write operation is enabled
  toolDescription += " with support for:";

  if (ALLOW_INSERT_OPERATION) {
    toolDescription += " INSERT,";
  }

  if (ALLOW_UPDATE_OPERATION) {
    toolDescription += " UPDATE,";
  }

  if (ALLOW_DELETE_OPERATION) {
    toolDescription += " DELETE,";
  }

  if (ALLOW_DDL_OPERATION) {
    toolDescription += " DDL,";
  }

  if (ALLOW_OBJECT_MANAGEMENT) {
    toolDescription += " OBJECT_MANAGEMENT,";
  }

  if (ALLOW_USER_MANAGEMENT) {
    toolDescription += " USER_MANAGEMENT,";
  }

  if (ALLOW_PRIVILEGE_MANAGEMENT) {
    toolDescription += " PRIVILEGE_MANAGEMENT,";
  }

  // Remove trailing comma and add READ operations
  toolDescription = toolDescription.replace(/,$/, "") + " and READ operations";

  if (
    Object.keys(SCHEMA_INSERT_PERMISSIONS).length > 0 ||
    Object.keys(SCHEMA_UPDATE_PERMISSIONS).length > 0 ||
    Object.keys(SCHEMA_DELETE_PERMISSIONS).length > 0 ||
    Object.keys(SCHEMA_DDL_PERMISSIONS).length > 0
  ) {
    toolDescription += " (Schema-specific permissions enabled)";
  }
} else {
  // Only read operations are allowed
  toolDescription += " (READ-ONLY)";
}

// Determine if we're in read-only mode (no write operations enabled)
const isReadOnly = !(
  ALLOW_INSERT_OPERATION ||
  ALLOW_UPDATE_OPERATION ||
  ALLOW_DELETE_OPERATION ||
  ALLOW_DDL_OPERATION
);

/**
 * Turn a raw MySQL driver error into a message the model can act on. mysql2
 * surfaces server errors as `Error` objects carrying `code`/`errno`; we append
 * a short remediation hint for the shapes that were misfiring most often in
 * practice (missing table/column, cross-database collation mismatch) without
 * hiding the original message.
 */
function describeQueryError(err: unknown): string {
  const e = err as { message?: string; code?: string; errno?: number };
  const base = `Error: ${e?.message ?? String(err)}`;
  const code = e?.code ?? "";
  const msg = e?.message ?? "";

  if (code === "ER_NO_SUCH_TABLE" || /doesn't exist/i.test(msg)) {
    return `${base}\nHint: the table was not found. List tables via the mysql://tables resource or run \`SHOW TABLES FROM \`db\`\`, and qualify names as \`db.table\` in multi-DB mode.`;
  }
  if (code === "ER_BAD_FIELD_ERROR" || /Unknown column/i.test(msg)) {
    return `${base}\nHint: that column does not exist. Inspect the real column names via the mysql://tables/{table} resource or \`SHOW COLUMNS FROM \`db.table\`\` before referencing them (quoted Chinese/identifiers are exact).`;
  }
  if (
    code === "ER_CANT_AGGREGATE_2COLLATIONS" ||
    code === "ER_CANT_AGGREGATE_3COLLATIONS" ||
    code === "ER_DIFFERENT_COLLISIONS" ||
    /Illegal mix of collations/i.test(msg)
  ) {
    return `${base}\nHint: the compared columns use different collations (common when joining tables from databases created with different defaults). Add an explicit COLLATE on the comparison, e.g. \`a.col COLLATE utf8mb4_unicode_ci = b.col COLLATE utf8mb4_unicode_ci\`.`;
  }
  if (code === "ER_QUERY_TIMEOUT" || /maximum statement execution time/i.test(msg)) {
    return `${base}\nHint: the query exceeded the server time limit. Add a LIMIT, tighten the WHERE clause, or use an indexed column.`;
  }
  return base;
}

// @INFO: Add debug logging for configuration
log(
  "info",
  "MySQL Configuration:",
  JSON.stringify(
    {
      ...(process.env.MYSQL_SOCKET_PATH
        ? {
            socketPath: process.env.MYSQL_SOCKET_PATH,
            connectionType: "Unix Socket",
          }
        : {
            host: process.env.MYSQL_HOST || "127.0.0.1",
            port: process.env.MYSQL_PORT || "3306",
            connectionType: "TCP/IP",
          }),
      user: config.mysql.user,
      password: config.mysql.password ? "******" : "not set",
      database: config.mysql.database || "MULTI_DB_MODE",
      ssl: process.env.MYSQL_SSL === "true" ? "enabled" : "disabled",
      sslCA: process.env.MYSQL_SSL_CA || "not set",
      sslCert: process.env.MYSQL_SSL_CERT || "not set",
      sslKey: process.env.MYSQL_SSL_KEY || "not set",
      multiDbMode: isMultiDbMode ? "enabled" : "disabled",
    },
    null,
    2,
  ),
);

// Define configuration schema
export const configSchema = z.object({
  debug: z.boolean().default(false).describe("Enable debug logging"),
});

// Export the default function that creates and returns the MCP server
export default function createMcpServer({
  sessionId,
  config,
}: {
  sessionId?: string;
  config: z.infer<typeof configSchema>;
}) {
  // Create the server instance
  const server = new Server(
    {
      name: "MySQL MCP Server",
      version: process.env.npm_package_version || "1.0.0",
    },
    {
      capabilities: {
        resources: {},
        tools: {
          mysql_query: {
            description: toolDescription,
            inputSchema: {
              type: "object",
              properties: {
                sql: {
                  type: "string",
                  description: "The SQL query to execute",
                },
              },
              required: ["sql"],
            },
            annotations: {
              readOnlyHint: isReadOnly,
              idempotentHint: isReadOnly,
              destructiveHint: !isReadOnly,
              openWorldHint: false,
              title: "MySQL Query",
            },
          },
        },
      },
    },
  );

  // Register request handlers for resources
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    try {
      log("info", "Handling ListResourcesRequest");
      const connectionInfo = process.env.MYSQL_SOCKET_PATH
        ? `socket: ${process.env.MYSQL_SOCKET_PATH}`
        : `host: ${process.env.MYSQL_HOST || "localhost"}, port: ${
            process.env.MYSQL_PORT || 3306
          }`;
      log("info", `Connection info: ${connectionInfo}`);

      // Query to get all tables
      const tablesQuery = `
      SELECT
        table_name as name,
        table_schema as \`database\`,
        table_comment as description,
        table_rows as rowCount,
        data_length as dataSize,
        index_length as indexSize,
        create_time as createTime,
        update_time as updateTime
      FROM
        information_schema.tables
      WHERE
        table_schema NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
      ORDER BY
        table_schema, table_name
    `;

      const queryResult = (await executeReadOnlyQuery<any>(tablesQuery));
      const tables = JSON.parse(queryResult.content[0].text) as TableRow[];
      log("info", `Found ${tables.length} tables`);

      // Create resources for each table
      const resources = tables.map((table) => ({
        uri: `mysql://tables/${table.name}`,
        name: table.name,
        title: `${table.database}.${table.name}`,
        description:
          table.description ||
          `Table ${table.name} in database ${table.database}`,
        mimeType: "application/json",
      }));

      // Add a resource for the list of tables
      resources.push({
        uri: "mysql://tables",
        name: "Tables",
        title: "MySQL Tables",
        description: "List of all MySQL tables",
        mimeType: "application/json",
      });

      return { resources };
    } catch (error) {
      log("error", "Error in ListResourcesRequest handler:", error);
      throw error;
    }
  });

  // Register request handler for reading resources
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    try {
      log("info", "Handling ReadResourceRequest:", request.params.uri);

      // Parse the URI to extract table name and optional database name
      const uriParts = request.params.uri.split("/");
      const tableName = uriParts.pop();
      const dbName = uriParts.length > 0 ? uriParts.pop() : null;

      if (!tableName) {
        throw new Error(`Invalid resource URI: ${request.params.uri}`);
      }

      // Modify query to include schema information
      let columnsQuery =
        "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = ?";
      let queryParams = [tableName as string];

      if (dbName) {
        columnsQuery += " AND table_schema = ?";
        queryParams.push(dbName);
      }

      const results = (await executeQuery(
        columnsQuery,
        queryParams,
      )) as ColumnRow[];

      // When PII redaction is enabled, hide PII column names from the schema
      // response so the LLM never learns they exist and won't generate SQL
      // referencing them. Combined with the SELECT * guard in executeReadOnlyQuery,
      // this gives end-to-end protection: the LLM only ever sees safe columns
      // and is forced to project them explicitly.
      const piiColumnList = [...DEFAULT_PII_COLUMNS, ...PII_EXTRA_COLUMNS];
      const filtered = ENABLE_PII_REDACTION
        ? results.filter(
            (col) =>
              !isPIIColumn(col.column_name, piiColumnList, PII_EXTRA_COLUMN_PATTERNS),
          )
        : results;

      if (ENABLE_PII_REDACTION && filtered.length !== results.length) {
        log(
          "info",
          `[redact] hid ${results.length - filtered.length} PII column(s) from schema for table "${tableName}"`,
        );
      }

      return {
        contents: [
          {
            uri: request.params.uri,
            mimeType: "application/json",
            text: JSON.stringify(filtered, null, 2),
          },
        ],
      };
    } catch (error) {
      log("error", "Error in ReadResourceRequest handler:", error);
      throw error;
    }
  });

  // Register handler for tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      log("info", "Handling CallToolRequest:", request.params.name);
      const name = request.params.name as string;
      const args = (request.params.arguments || {}) as {
        sql?: string;
        database?: string;
        type?: "PROCEDURE" | "FUNCTION";
      };

      if (name === "mysql_query") {
        const sql = args.sql as string;
        if (!sql) {
          return {
            content: [{ type: "text", text: "Error: sql is required" }],
            isError: true,
          };
        }
        try {
          return await executeReadOnlyQuery(sql);
        } catch (err) {
          log("error", "Error executing mysql_query:", err);
          return {
            content: [{ type: "text", text: describeQueryError(err) }],
            isError: true,
          };
        }
      }

      if (name === "mysql_users") {
        return await listUsers();
      }
      if (name === "mysql_create_user") {
        return await createUser(args as { sql: string });
      }
      if (name === "mysql_drop_user") {
        return await dropUser(args as { sql: string });
      }
      if (name === "mysql_alter_user") {
        return await alterUser(args as { sql: string });
      }
      if (name === "mysql_set_password") {
        return await setPassword(args as { sql: string });
      }
      if (name === "mysql_show_grants") {
        return await showGrants(args as { sql?: string });
      }
      if (name === "mysql_grant") {
        return await grantPrivilege(args as {
          database: string;
          user: string;
          host?: string;
          privileges: unknown[];
          withGrantOption?: boolean;
        });
      }
      if (name === "mysql_revoke") {
        return await revokePrivilege(args as { sql: string });
      }
      if (name === "mysql_flush_privileges") {
        return await flushPrivileges(args as { sql?: string });
      }
      if (name === "mysql_views") {
        return await listViews(args as { database?: string });
      }
      if (name === "mysql_create_view") {
        return await createView(args as { sql: string });
      }
      if (name === "mysql_drop_view") {
        return await dropView(args as { sql: string });
      }
      if (name === "mysql_procedures") {
        return await listRoutines(args as { database?: string; type?: "PROCEDURE" | "FUNCTION" });
      }
      if (name === "mysql_drop_routine") {
        return await dropRoutine(args as { sql: string });
      }

      return {
        content: [{ type: "text", text: `Error: Unknown tool: ${name}` }],
        isError: true,
      };
    } catch (err) {
      const error = err as Error;
      log("error", "Error in CallToolRequest handler:", error);
      return {
        content: [{
          type: "text",
          text: `Error: ${error.message}`
        }],
        isError: true
      };
    }
  });

  // Register handler for listing tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    log("info", "Handling ListToolsRequest");

    const toolsResponse = {
      tools: [
        {
          name: "mysql_query",
          description: toolDescription,
          inputSchema: {
            type: "object",
            properties: {
              sql: {
                type: "string",
                description: "The SQL query to execute",
              },
            },
            required: ["sql"],
          },
          annotations: {
            readOnlyHint: isReadOnly,
            idempotentHint: isReadOnly,
            destructiveHint: !isReadOnly,
            openWorldHint: false,
            title: "MySQL Query",
          },
        },
        {
          name: "mysql_users",
          description: "[MySQL User Management] List MySQL users",
          inputSchema: {
            type: "object",
            properties: {},
            required: [],
          },
          annotations: {
            readOnlyHint: true,
            idempotentHint: true,
            destructiveHint: false,
            openWorldHint: false,
            title: "List MySQL Users",
          },
        },
        {
          name: "mysql_create_user",
          description: "[MySQL User Management] Create a MySQL user",
          inputSchema: {
            type: "object",
            properties: {
              sql: {
                type: "string",
                description: "CREATE USER SQL statement",
              },
            },
            required: ["sql"],
          },
          annotations: {
            readOnlyHint: false,
            idempotentHint: false,
            destructiveHint: true,
            openWorldHint: false,
            title: "Create MySQL User",
          },
        },
        {
          name: "mysql_drop_user",
          description: "[MySQL User Management] Drop a MySQL user",
          inputSchema: {
            type: "object",
            properties: {
              sql: {
                type: "string",
                description: "DROP USER SQL statement",
              },
            },
            required: ["sql"],
          },
          annotations: {
            readOnlyHint: false,
            idempotentHint: false,
            destructiveHint: true,
            openWorldHint: false,
            title: "Drop MySQL User",
          },
        },
        {
          name: "mysql_alter_user",
          description: "[MySQL User Management] Alter a MySQL user",
          inputSchema: {
            type: "object",
            properties: {
              sql: {
                type: "string",
                description: "ALTER USER SQL statement",
              },
            },
            required: ["sql"],
          },
          annotations: {
            readOnlyHint: false,
            idempotentHint: false,
            destructiveHint: true,
            openWorldHint: false,
            title: "Alter MySQL User",
          },
        },
        {
          name: "mysql_set_password",
          description: "[MySQL User Management] Set password for a MySQL user",
          inputSchema: {
            type: "object",
            properties: {
              sql: {
                type: "string",
                description: "SET PASSWORD or ALTER USER ... IDENTIFIED BY SQL",
              },
            },
            required: ["sql"],
          },
          annotations: {
            readOnlyHint: false,
            idempotentHint: false,
            destructiveHint: true,
            openWorldHint: false,
            title: "Set MySQL Password",
          },
        },
        {
          name: "mysql_show_grants",
          description: "[MySQL Privilege Management] Show grants",
          inputSchema: {
            type: "object",
            properties: {
              sql: {
                type: "string",
                description: "Optional SHOW GRANTS SQL",
              },
            },
            required: [],
          },
          annotations: {
            readOnlyHint: true,
            idempotentHint: true,
            destructiveHint: false,
            openWorldHint: false,
            title: "Show Grants",
          },
        },
        {
          name: "mysql_grant",
          description: "[MySQL Privilege Management] Grant database-level privileges",
          inputSchema: {
            type: "object",
            properties: {
              database: {
                type: "string",
                description: "Target database name",
              },
              user: {
                type: "string",
                description: "MySQL user name",
              },
              host: {
                type: "string",
                description: "MySQL user host, default '%'",
              },
              privileges: {
                type: "array",
                items: { type: "string" },
                description:
                  "Database-level privileges to grant. Supported: ALL (alias of ALL PRIVILEGES), SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, INDEX, EXECUTE, CREATE ROUTINE, ALTER ROUTINE, EVENT, TRIGGER, CREATE VIEW, SHOW VIEW, REFERENCES, CREATE TEMPORARY TABLES, LOCK TABLES",
              },
              withGrantOption: {
                type: "boolean",
                description: "Whether to grant WITH GRANT OPTION",
              },
            },
            required: ["database", "user", "privileges"],
          },
          annotations: {
            readOnlyHint: false,
            idempotentHint: false,
            destructiveHint: true,
            openWorldHint: false,
            title: "Grant Privileges",
          },
        },
        {
          name: "mysql_revoke",
          description: "[MySQL Privilege Management] Revoke privileges",
          inputSchema: {
            type: "object",
            properties: {
              sql: {
                type: "string",
                description: "REVOKE SQL",
              },
            },
            required: ["sql"],
          },
          annotations: {
            readOnlyHint: false,
            idempotentHint: false,
            destructiveHint: true,
            openWorldHint: false,
            title: "Revoke Privileges",
          },
        },
        {
          name: "mysql_flush_privileges",
          description: "[MySQL Privilege Management] Flush privileges",
          inputSchema: {
            type: "object",
            properties: {},
            required: [],
          },
          annotations: {
            readOnlyHint: false,
            idempotentHint: false,
            destructiveHint: true,
            openWorldHint: false,
            title: "Flush Privileges",
          },
        },
        {
          name: "mysql_views",
          description: "[MySQL Object Management] List views",
          inputSchema: {
            type: "object",
            properties: {
              database: {
                type: "string",
                description: "Optional database name",
              },
            },
            required: [],
          },
          annotations: {
            readOnlyHint: true,
            idempotentHint: true,
            destructiveHint: false,
            openWorldHint: false,
            title: "List Views",
          },
        },
        {
          name: "mysql_create_view",
          description: "[MySQL Object Management] Create a view",
          inputSchema: {
            type: "object",
            properties: {
              sql: {
                type: "string",
                description: "CREATE VIEW SQL",
              },
            },
            required: ["sql"],
          },
          annotations: {
            readOnlyHint: false,
            idempotentHint: false,
            destructiveHint: true,
            openWorldHint: false,
            title: "Create View",
          },
        },
        {
          name: "mysql_drop_view",
          description: "[MySQL Object Management] Drop a view",
          inputSchema: {
            type: "object",
            properties: {
              sql: {
                type: "string",
                description: "DROP VIEW SQL",
              },
            },
            required: ["sql"],
          },
          annotations: {
            readOnlyHint: false,
            idempotentHint: false,
            destructiveHint: true,
            openWorldHint: false,
            title: "Drop View",
          },
        },
        {
          name: "mysql_procedures",
          description: "[MySQL Object Management] List stored procedures/functions",
          inputSchema: {
            type: "object",
            properties: {
              database: {
                type: "string",
                description: "Optional database name",
              },
              type: {
                type: "string",
                enum: ["PROCEDURE", "FUNCTION"],
                description: "Routine type",
              },
            },
            required: [],
          },
          annotations: {
            readOnlyHint: true,
            idempotentHint: true,
            destructiveHint: false,
            openWorldHint: false,
            title: "List Routines",
          },
        },
        {
          name: "mysql_drop_routine",
          description: "[MySQL Object Management] Drop a stored procedure or function",
          inputSchema: {
            type: "object",
            properties: {
              sql: {
                type: "string",
                description: "DROP PROCEDURE/FUNCTION SQL",
              },
            },
            required: ["sql"],
          },
          annotations: {
            readOnlyHint: false,
            idempotentHint: false,
            destructiveHint: true,
            openWorldHint: false,
            title: "Drop Routine",
          },
        },
      ],
    };

    log(
      "info",
      "ListToolsRequest response:",
      JSON.stringify(toolsResponse, null, 2),
    );
    return toolsResponse;
  });

  // Initialize database connection and set up shutdown handlers
  (async () => {
    try {
      log("info", "Attempting to test database connection...");
      // Test the connection before fully starting the server
      const pool = await getPool();
      const connection = await pool.getConnection();
      log("info", "Database connection test successful");
      connection.release();
    } catch (error) {
      log("error", "Fatal error during server startup:", error);
      safeExit(1);
    }
  })();

  // Setup shutdown handlers
  const shutdown = async (signal: string): Promise<void> => {
    log("error", `Received ${signal}. Shutting down...`);
    try {
      // Only attempt to close the pool if it was created
      if (poolPromise) {
        const pool = await poolPromise;
        await pool.end();
      }
    } catch (err) {
      log("error", "Error closing pool:", err);
      throw err;
    }
  };

  process.on("SIGINT", async () => {
    try {
      await shutdown("SIGINT");
      process.exit(0);
    } catch (err) {
      log("error", "Error during SIGINT shutdown:", err);
      safeExit(1);
    }
  });

  process.on("SIGTERM", async () => {
    try {
      await shutdown("SIGTERM");
      process.exit(0);
    } catch (err) {
      log("error", "Error during SIGTERM shutdown:", err);
      safeExit(1);
    }
  });

  // Add unhandled error listeners
  process.on("uncaughtException", (error) => {
    log("error", "Uncaught exception:", error);
    safeExit(1);
  });

  process.on("unhandledRejection", (reason, promise) => {
    log("error", "Unhandled rejection at:", promise, "reason:", reason);
    safeExit(1);
  });

  return server;
}

/**
* Checks if the current module is the main module (the entry point of the application).
* This function works for both ES Modules (ESM) and CommonJS.
* @returns {boolean} - True if the module is the main module, false otherwise.
*/
const isMainModule = () => {
  // 1. Standard check for CommonJS
  // `require.main` refers to the application's entry point module.
  // If it's the same as the current `module`, this file was executed directly.
  if (typeof require !== 'undefined' && require.main === module) {
    return true;
  }
  // 2. Check for ES Modules (ESM)
  // `import.meta.url` provides the file URL of the current module.
  // `process.argv[1]` provides the path of the executed script.
  if (typeof import.meta !== 'undefined' && import.meta.url && process.argv[1]) {
    // Convert the `import.meta.url` (e.g., 'file:///path/to/file.js') to a system-standard absolute path.
    const currentModulePath = fileURLToPath(import.meta.url);
    // Resolve `process.argv[1]` (which can be a relative path) to a standard absolute path.
    const mainScriptPath = realpathSync(process.argv[1]);
    // Compare the two standardized absolute paths.
    return currentModulePath === mainScriptPath;
  }
  // Fallback if neither of the above conditions are met.
  return false;
}

// Start the server if this file is being run directly
if (isMainModule()) {
  log("info", "Running in standalone mode");

  // Start the server
  (async () => {
    try {
      const mcpServer = createMcpServer({ config: { debug: false } });
      if (IS_REMOTE_MCP && REMOTE_SECRET_KEY?.length) {
        const app = express();
        app.use(express.json());
        app.post("/mcp", async (req: Request, res: Response) => {
          // In stateless mode, create a new instance of transport and server for each request
          // to ensure complete isolation. A single instance would cause request ID collisions
          // when multiple clients connect concurrently.
          if (
            !req.get("Authorization") ||
            !req.get("Authorization")?.startsWith("Bearer ") ||
            !req.get("Authorization")?.endsWith(REMOTE_SECRET_KEY)
          ) {
            console.error("Missing or invalid Authorization header");
            res.status(401).json({
              jsonrpc: "2.0",
              error: {
                code: -32603,
                message: "Missing or invalid Authorization header",
              },
              id: null,
            });
            return;
          }
          try {
            const server = createMcpServer({ config: { debug: false } });
            const transport: StreamableHTTPServerTransport =
              new StreamableHTTPServerTransport({
                sessionIdGenerator: undefined,
              });
            res.on("close", () => {
              log("info", "Request closed");
              transport.close();
              server.close();
            });
            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
          } catch (error) {
            log("error", "Error handling MCP request:", error);
            if (!res.headersSent) {
              res.status(500).json({
                jsonrpc: "2.0",
                error: {
                  code: -32603,
                  message: (error as any).message,
                },
                id: null,
              });
            }
          }
        });

        // SSE notifications not supported in stateless mode
        app.get("/mcp", async (req: Request, res: Response) => {
          console.log("Received GET MCP request");
          res.writeHead(405).end(
            JSON.stringify({
              jsonrpc: "2.0",
              error: {
                code: -32000,
                message: "Method not allowed.",
              },
              id: null,
            }),
          );
        });

        // Session termination not needed in stateless mode
        app.delete("/mcp", async (req: Request, res: Response) => {
          console.log("Received DELETE MCP request");
          res.writeHead(405).end(
            JSON.stringify({
              jsonrpc: "2.0",
              error: {
                code: -32000,
                message: "Method not allowed.",
              },
              id: null,
            }),
          );
        });

        // Start the server
        app.listen(PORT, (error) => {
          if (error) {
            console.error("Failed to start server:", error);
            process.exit(1);
          }
          console.log(
            `MCP Stateless Streamable HTTP Server listening on port ${PORT}`,
          );
        });
      } else {
        const transport = new StdioServerTransport();
        // Create a server instance directly instead of importing

        await mcpServer.connect(transport);
        log("info", "Server started and listening on stdio");
      }
    } catch (error) {
      log("error", "Server error:", error);
      safeExit(1);
    }
  })();
}
