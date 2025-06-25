export interface SchemaPermissions {
  [schema: string]: boolean;
}

export interface TableRow {
  table_name: string;
}

export interface ColumnRow {
  column_name: string;
  data_type: string;
}
