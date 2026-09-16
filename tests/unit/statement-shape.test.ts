import { describe, it, expect } from "vitest";
import {
  isRoutineDefinition,
  countTopLevelStatements,
  splitTopLevelStatements,
} from "../../src/db/utils.js";

// The pool runs with `multipleStatements` disabled, so the executor rejects
// multi-statement batches and routine bodies up front. These cover the
// pure-function guards behind that rejection.
describe("isRoutineDefinition", () => {
  it("matches PROCEDURE/FUNCTION/TRIGGER, with or without DEFINER", () => {
    expect(
      isRoutineDefinition("CREATE PROCEDURE sp() BEGIN SELECT 1; END"),
    ).toBe(true);
    expect(
      isRoutineDefinition("CREATE FUNCTION f() RETURNS INT BEGIN RETURN 1; END"),
    ).toBe(true);
    expect(
      isRoutineDefinition(
        "CREATE TRIGGER trg BEFORE INSERT ON t FOR EACH ROW BEGIN SET @x = 1; END",
      ),
    ).toBe(true);
    expect(
      isRoutineDefinition(
        "CREATE DEFINER=`root`@`localhost` PROCEDURE sp() BEGIN SELECT 1; END",
      ),
    ).toBe(true);
  });

  it("does not match ordinary DDL", () => {
    expect(isRoutineDefinition("CREATE TABLE t (id INT)")).toBe(false);
    expect(isRoutineDefinition("CREATE OR REPLACE VIEW v AS SELECT 1")).toBe(
      false,
    );
    expect(isRoutineDefinition("SELECT * FROM t")).toBe(false);
  });
});

describe("countTopLevelStatements", () => {
  it("counts a trailing semicolon as one statement", () => {
    expect(countTopLevelStatements("SELECT 1;")).toBe(1);
    expect(countTopLevelStatements("SELECT 1")).toBe(1);
  });

  it("detects multi-statement batches", () => {
    expect(countTopLevelStatements("USE jcb; SHOW TABLES")).toBe(2);
    expect(countTopLevelStatements("SELECT 1; SELECT 2; SELECT 3;")).toBe(3);
  });

  it("does not split on semicolons inside strings or comments", () => {
    expect(countTopLevelStatements("SELECT 'a;b;c' AS s FROM t;")).toBe(1);
    expect(countTopLevelStatements("SELECT 1 -- trailing ; note\n;")).toBe(1);
  });

  it("returns 0 for empty input", () => {
    expect(countTopLevelStatements("")).toBe(0);
    expect(countTopLevelStatements("   ;  ; ")).toBe(0);
  });
});

describe("splitTopLevelStatements", () => {
  it("trims each statement and drops separators", () => {
    expect(splitTopLevelStatements("USE jcb; SHOW TABLES")).toEqual([
      "USE jcb",
      "SHOW TABLES",
    ]);
  });
});
