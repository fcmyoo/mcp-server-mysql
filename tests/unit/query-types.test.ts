import { describe, it, expect } from "vitest";
import { getQueryTypes, inferStatementTypes } from "../../src/db/utils.js";

// Regression coverage for MySQL statements `node-sql-parser` cannot parse.
// Previously these threw `Parsing failed` from `getQueryTypes` and blocked
// otherwise-valid queries. They must now fall back to textual inference.
describe("getQueryTypes - parser-limitation fallback", () => {
  it("does not throw on NULL-safe equality `<=>`", async () => {
    expect(
      await getQueryTypes("SELECT a FROM t WHERE a <=> b"),
    ).toEqual(["select"]);
  });

  it("classifies EXPLAIN UPDATE as read-only `explain`", async () => {
    expect(
      await getQueryTypes(
        "EXPLAIN UPDATE t JOIN d ON t.id = d.id SET t.x = d.y",
      ),
    ).toEqual(["explain"]);
  });

  it("classifies EXPLAIN DELETE as `explain`", async () => {
    expect(await getQueryTypes("EXPLAIN DELETE FROM t WHERE id = 1")).toEqual([
      "explain",
    ]);
  });

  it("survives CAST(...) COLLATE expressions", async () => {
    expect(
      await getQueryTypes(
        "SELECT CAST(a AS CHAR) COLLATE utf8mb4_unicode_ci AS c FROM t",
      ),
    ).toEqual(["select"]);
  });

  it("survives reserved-word aliases", async () => {
    expect(
      await getQueryTypes(
        "SELECT @@secure_file_priv AS secure_file_priv, @@version_compile_os AS os, @@have_ssl AS ssl",
      ),
    ).toEqual(["select"]);
  });

  it("routes CALL to a non-read-only `call` type", async () => {
    expect(await getQueryTypes("CALL mydb.sp_refresh_org()")).toEqual([
      "call",
    ]);
  });

  it("routes qualified CALL with backticks and string args", async () => {
    expect(
      await getQueryTypes(
        "CALL `dzyh`.`sp_refresh_org_map`('惠支付明细_分户','v_orgmap_hzf',1)",
      ),
    ).toContain("call");
  });

  it("classifies CREATE PROCEDURE as DDL `create`", async () => {
    const types = await getQueryTypes(
      "CREATE PROCEDURE sp() BEGIN UPDATE t SET a = 1; COMMIT; END",
    );
    expect(types[0]).toBe("create");
  });

  // Root cause of "Cannot execute statement in a READ ONLY transaction" for
  // RENAME TABLE: the parser emits a distinct `rename` type (not `alter`), so
  // the executor must include it in its DDL/write set.
  it("classifies RENAME TABLE as `rename` (must be treated as DDL)", async () => {
    expect(
      await getQueryTypes("RENAME TABLE `dzyh`.`a_copy` TO `dzyh`.`a_orig`"),
    ).toEqual(["rename"]);
  });
});

describe("getQueryTypes - normal AST path still works", () => {
  it("recognises DML verbs", async () => {
    expect(await getQueryTypes("INSERT INTO t VALUES (1)")).toEqual(["insert"]);
    expect(await getQueryTypes("UPDATE t SET a = 1 WHERE id = 1")).toEqual([
      "update",
    ]);
    expect(await getQueryTypes("DELETE FROM t WHERE id = 1")).toEqual([
      "delete",
    ]);
    expect(await getQueryTypes("DROP TABLE t")).toEqual(["drop"]);
  });

  it("handles multi-statement scripts", async () => {
    expect(
      await getQueryTypes("SELECT 1; UPDATE t SET a = 1 WHERE id = 1"),
    ).toEqual(["select", "update"]);
  });
});

describe("inferStatementTypes - textual inference", () => {
  it("ignores keywords inside string literals", () => {
    expect(inferStatementTypes("SELECT 'UPDATE users SET x' AS s FROM t")).toEqual([
      "select",
    ]);
  });

  it("ignores keywords inside line comments", () => {
    expect(inferStatementTypes("-- DROP TABLE evil\nSELECT 1")).toEqual([
      "select",
    ]);
    expect(inferStatementTypes("# UPDATE x\nDELETE FROM t")).toEqual([
      "delete",
    ]);
  });

  it("ignores keywords inside block comments", () => {
    expect(inferStatementTypes("/* INSERT */ SELECT 1")).toEqual(["select"]);
  });

  it("does not split on semicolons inside quoted values", () => {
    expect(
      inferStatementTypes("SELECT 'a;b;c' FROM t; UPDATE t SET a = 1"),
    ).toEqual(["select", "update"]);
  });

  it("classifies SHOW/SET/USE and CASE-insensitive/leading-space", () => {
    expect(inferStatementTypes("  show tables")).toEqual(["show"]);
    expect(inferStatementTypes("SET NAMES utf8mb4")).toEqual(["set"]);
    expect(inferStatementTypes("USE mydb")).toEqual(["use"]);
  });

  it("returns unknown for empty/unrecognised input", () => {
    expect(inferStatementTypes("")).toEqual(["unknown"]);
    expect(inferStatementTypes("   ;  ;  ")).toEqual(["unknown"]);
    expect(inferStatementTypes("VACUUM t")).toEqual(["unknown"]);
  });
});
