import {
  ALLOW_DELETE_OPERATION,
  ALLOW_DDL_OPERATION,
  ALLOW_INSERT_OPERATION,
  ALLOW_UPDATE_OPERATION,
  SCHEMA_DELETE_PERMISSIONS,
  SCHEMA_DDL_PERMISSIONS,
  SCHEMA_INSERT_PERMISSIONS,
  SCHEMA_UPDATE_PERMISSIONS,
} from "../config/index.js";

// Schema permission checking functions
function isInsertAllowedForSchema(schema: string | null): boolean {
  if (insertOverride !== undefined) {
    return insertOverride;
  }
  if (!schema) {
    return ALLOW_INSERT_OPERATION;
  }
  return schema in SCHEMA_INSERT_PERMISSIONS
    ? SCHEMA_INSERT_PERMISSIONS[schema]
    : ALLOW_INSERT_OPERATION;
}

function isUpdateAllowedForSchema(schema: string | null): boolean {
  if (updateOverride !== undefined) {
    return updateOverride;
  }
  if (!schema) {
    return ALLOW_UPDATE_OPERATION;
  }
  return schema in SCHEMA_UPDATE_PERMISSIONS
    ? SCHEMA_UPDATE_PERMISSIONS[schema]
    : ALLOW_UPDATE_OPERATION;
}

function isDeleteAllowedForSchema(schema: string | null): boolean {
  if (deleteOverride !== undefined) {
    return deleteOverride;
  }
  if (!schema) {
    return ALLOW_DELETE_OPERATION;
  }
  return schema in SCHEMA_DELETE_PERMISSIONS
    ? SCHEMA_DELETE_PERMISSIONS[schema]
    : ALLOW_DELETE_OPERATION;
}

function isDDLAllowedForSchema(schema: string | null): boolean {
  if (ddlOverride !== undefined) {
    return ddlOverride;
  }
  if (!schema) {
    return ALLOW_DDL_OPERATION;
  }
  return schema in SCHEMA_DDL_PERMISSIONS
    ? SCHEMA_DDL_PERMISSIONS[schema]
    : ALLOW_DDL_OPERATION;
}

export {
  isInsertAllowedForSchema,
  isUpdateAllowedForSchema,
  isDeleteAllowedForSchema,
  isDDLAllowedForSchema,
};

/* -------------------- test helpers -------------------- */

let insertOverride: boolean | undefined;
let updateOverride: boolean | undefined;
let deleteOverride: boolean | undefined;
let ddlOverride: boolean | undefined;

export function __setPermissionOverridesForTest(opts: {
  insert?: boolean;
  update?: boolean;
  delete?: boolean;
  ddl?: boolean;
}): void {
  if (
    process.env.NODE_ENV !== "test" &&
    process.env.VITEST !== "true"
  ) {
    throw new Error(
      "Permission overrides are only allowed in test mode",
    );
  }
  insertOverride = opts.insert;
  updateOverride = opts.update;
  deleteOverride = opts.delete;
  ddlOverride = opts.ddl;
}

export function __clearPermissionOverridesForTest(): void {
  insertOverride = undefined;
  updateOverride = undefined;
  deleteOverride = undefined;
  ddlOverride = undefined;
}
