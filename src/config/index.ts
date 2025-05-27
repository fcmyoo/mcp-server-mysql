import * as dotenv from "dotenv";
import { SchemaPermissions } from "../types/index.js";
import { parseSchemaPermissions } from "../utils/index.js";

export const MCP_VERSION = "2.0.2";

// @INFO: Load environment variables from .env file
dotenv.config();

// @INFO: Update the environment setup to ensure database is correctly set
if (process.env.NODE_ENV === "test" && !process.env.MYSQL_DB) {
  process.env.MYSQL_DB = "mcp_test_db"; // @INFO: Ensure we have a database name for tests
}

// Write operation flags (global defaults)
export const ALLOW_INSERT_OPERATION =
  process.env.ALLOW_INSERT_OPERATION === "true";
export const ALLOW_UPDATE_OPERATION =
  process.env.ALLOW_UPDATE_OPERATION === "true";
export const ALLOW_DELETE_OPERATION =
  process.env.ALLOW_DELETE_OPERATION === "true";
export const ALLOW_DDL_OPERATION = process.env.ALLOW_DDL_OPERATION === "true";

// Schema-specific permissions
export const SCHEMA_INSERT_PERMISSIONS: SchemaPermissions =
  parseSchemaPermissions(process.env.SCHEMA_INSERT_PERMISSIONS);
export const SCHEMA_UPDATE_PERMISSIONS: SchemaPermissions =
  parseSchemaPermissions(process.env.SCHEMA_UPDATE_PERMISSIONS);
export const SCHEMA_DELETE_PERMISSIONS: SchemaPermissions =
  parseSchemaPermissions(process.env.SCHEMA_DELETE_PERMISSIONS);
export const SCHEMA_DDL_PERMISSIONS: SchemaPermissions = parseSchemaPermissions(
  process.env.SCHEMA_DDL_PERMISSIONS,
);

// Check if we're in multi-DB mode (no specific DB set)
export const isMultiDbMode =
  !process.env.MYSQL_DB || process.env.MYSQL_DB.trim() === "";

export const mcpConfig = {
  server: {
    name: "@benborla29/mcp-server-mysql",
    version: MCP_VERSION,
    connectionTypes: ["stdio"],
  },
  mysql: {
    // Use Unix socket if provided, otherwise use host/port
    ...(process.env.MYSQL_SOCKET_PATH
      ? {
          socketPath: process.env.MYSQL_SOCKET_PATH,
        }
      : {
          host: process.env.MYSQL_HOST || "127.0.0.1",
          port: Number(process.env.MYSQL_PORT || "3306"),
        }),
    user: process.env.MYSQL_USER || "root",
    password:
      process.env.MYSQL_PASS === undefined ? "" : process.env.MYSQL_PASS,
    database: process.env.MYSQL_DB || undefined, // Allow undefined database for multi-DB mode
    connectionLimit: 10,
    authPlugins: {
      mysql_clear_password: () => () =>
        Buffer.from(process.env.MYSQL_PASS || "root"),
    },
    ...(process.env.MYSQL_SSL === "true"
      ? {
          ssl: {
            rejectUnauthorized:
              process.env.MYSQL_SSL_REJECT_UNAUTHORIZED === "true",
          },
        }
      : {}),
  },
  paths: {
    schema: "schema",
  },
};
