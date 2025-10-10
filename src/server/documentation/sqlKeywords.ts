/**
 * Documentation for SQL keywords
 * Used by the hover provider to show helpful information
 */

export interface KeywordDocumentation {
  keyword: string;
  description: string;
  example?: string;
}

export const SQL_KEYWORD_DOCS: Record<string, KeywordDocumentation> = {
  SELECT: {
    keyword: "SELECT",
    description: "Retrieves data from one or more tables. Specifies which columns to return in the result set.",
    example: "SELECT column1, column2 FROM table_name"
  },
  FROM: {
    keyword: "FROM",
    description: "Specifies the table(s) from which to retrieve data.",
    example: "SELECT * FROM users"
  },
  WHERE: {
    keyword: "WHERE",
    description: "Filters records based on specified conditions. Only rows that satisfy the condition are included in the result.",
    example: "SELECT * FROM users WHERE age > 18"
  },
  "JOIN": {
    keyword: "JOIN",
    description: "Combines rows from two or more tables based on a related column between them.",
    example: "SELECT * FROM users JOIN orders ON users.id = orders.user_id"
  },
  "LEFT JOIN": {
    keyword: "LEFT JOIN",
    description: "Returns all records from the left table and matched records from the right table. Returns NULL for unmatched right table records.",
    example: "SELECT * FROM users LEFT JOIN orders ON users.id = orders.user_id"
  },
  "RIGHT JOIN": {
    keyword: "RIGHT JOIN",
    description: "Returns all records from the right table and matched records from the left table. Returns NULL for unmatched left table records.",
    example: "SELECT * FROM users RIGHT JOIN orders ON users.id = orders.user_id"
  },
  "INNER JOIN": {
    keyword: "INNER JOIN",
    description: "Returns only records that have matching values in both tables.",
    example: "SELECT * FROM users INNER JOIN orders ON users.id = orders.user_id"
  },
  "FULL JOIN": {
    keyword: "FULL JOIN",
    description: "Returns all records when there is a match in either left or right table.",
    example: "SELECT * FROM users FULL JOIN orders ON users.id = orders.user_id"
  },
  "GROUP BY": {
    keyword: "GROUP BY",
    description: "Groups rows that have the same values in specified columns. Often used with aggregate functions (COUNT, MAX, MIN, SUM, AVG).",
    example: "SELECT department, COUNT(*) FROM employees GROUP BY department"
  },
  "ORDER BY": {
    keyword: "ORDER BY",
    description: "Sorts the result set by one or more columns in ascending (ASC) or descending (DESC) order.",
    example: "SELECT * FROM users ORDER BY name ASC"
  },
  HAVING: {
    keyword: "HAVING",
    description: "Filters groups of rows after GROUP BY has been applied. Similar to WHERE but for aggregated data.",
    example: "SELECT department, COUNT(*) FROM employees GROUP BY department HAVING COUNT(*) > 5"
  },
  LIMIT: {
    keyword: "LIMIT",
    description: "Restricts the number of rows returned by the query.",
    example: "SELECT * FROM users LIMIT 10"
  },
  OFFSET: {
    keyword: "OFFSET",
    description: "Skips a specified number of rows before starting to return rows from the query.",
    example: "SELECT * FROM users LIMIT 10 OFFSET 20"
  },
  AS: {
    keyword: "AS",
    description: "Creates an alias for a column or table, providing a temporary name for the result set.",
    example: "SELECT name AS user_name FROM users"
  },
  DISTINCT: {
    keyword: "DISTINCT",
    description: "Returns only unique values, eliminating duplicate rows from the result set.",
    example: "SELECT DISTINCT department FROM employees"
  },
  "COUNT": {
    keyword: "COUNT",
    description: "Aggregate function that returns the number of rows that match specified criteria.",
    example: "SELECT COUNT(*) FROM users WHERE active = 1"
  },
  "SUM": {
    keyword: "SUM",
    description: "Aggregate function that calculates the total sum of a numeric column.",
    example: "SELECT SUM(salary) FROM employees"
  },
  "AVG": {
    keyword: "AVG",
    description: "Aggregate function that calculates the average value of a numeric column.",
    example: "SELECT AVG(salary) FROM employees"
  },
  "MAX": {
    keyword: "MAX",
    description: "Aggregate function that returns the maximum value in a column.",
    example: "SELECT MAX(salary) FROM employees"
  },
  "MIN": {
    keyword: "MIN",
    description: "Aggregate function that returns the minimum value in a column.",
    example: "SELECT MIN(salary) FROM employees"
  },
  AND: {
    keyword: "AND",
    description: "Logical operator that combines multiple conditions. All conditions must be true for the row to be included.",
    example: "SELECT * FROM users WHERE age > 18 AND country = 'USA'"
  },
  OR: {
    keyword: "OR",
    description: "Logical operator that combines multiple conditions. At least one condition must be true for the row to be included.",
    example: "SELECT * FROM users WHERE age < 18 OR age > 65"
  },
  NOT: {
    keyword: "NOT",
    description: "Logical operator that negates a condition.",
    example: "SELECT * FROM users WHERE NOT country = 'USA'"
  },
  IN: {
    keyword: "IN",
    description: "Allows you to specify multiple values in a WHERE clause.",
    example: "SELECT * FROM users WHERE country IN ('USA', 'Canada', 'Mexico')"
  },
  BETWEEN: {
    keyword: "BETWEEN",
    description: "Selects values within a given range (inclusive).",
    example: "SELECT * FROM products WHERE price BETWEEN 10 AND 50"
  },
  LIKE: {
    keyword: "LIKE",
    description: "Searches for a specified pattern in a column. Use % as wildcard for multiple characters, _ for single character.",
    example: "SELECT * FROM users WHERE name LIKE 'John%'"
  },
  "IS NULL": {
    keyword: "IS NULL",
    description: "Tests for NULL values (empty/missing data).",
    example: "SELECT * FROM users WHERE email IS NULL"
  },
  "IS NOT NULL": {
    keyword: "IS NOT NULL",
    description: "Tests for non-NULL values (ensures data exists).",
    example: "SELECT * FROM users WHERE email IS NOT NULL"
  },
  CASE: {
    keyword: "CASE",
    description: "Provides if-then-else logic in SQL queries. Evaluates conditions and returns a value when the first condition is met.",
    example: "SELECT CASE WHEN age < 18 THEN 'Minor' ELSE 'Adult' END FROM users"
  },
  WHEN: {
    keyword: "WHEN",
    description: "Part of CASE statement. Specifies a condition to evaluate.",
    example: "CASE WHEN age < 18 THEN 'Minor' END"
  },
  THEN: {
    keyword: "THEN",
    description: "Part of CASE statement. Specifies the result when the WHEN condition is true.",
    example: "CASE WHEN age < 18 THEN 'Minor' END"
  },
  ELSE: {
    keyword: "ELSE",
    description: "Part of CASE statement. Specifies the result when no WHEN conditions are true.",
    example: "CASE WHEN age < 18 THEN 'Minor' ELSE 'Adult' END"
  },
  END: {
    keyword: "END",
    description: "Marks the end of a CASE statement.",
    example: "CASE WHEN age < 18 THEN 'Minor' ELSE 'Adult' END"
  },
  UNION: {
    keyword: "UNION",
    description: "Combines the result sets of two or more SELECT statements, removing duplicates.",
    example: "SELECT name FROM users UNION SELECT name FROM customers"
  },
  WITH: {
    keyword: "WITH",
    description: "Defines a Common Table Expression (CTE), a temporary named result set.",
    example: "WITH temp AS (SELECT * FROM users) SELECT * FROM temp"
  }
};

export function getKeywordDocumentation(keyword: string): KeywordDocumentation | undefined {
  return SQL_KEYWORD_DOCS[keyword.toUpperCase()];
}
