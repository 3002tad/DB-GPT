# SQL distribution evidence

`sql_query` preserves SQL NULL as JSON null in query artifacts and labels it
`NULL` in the model-facing markdown observation. Empty strings and the literal
string `NULL` remain distinct in the structured artifact.

Successful results include additive `result_coverage` metadata:

- `scope=returned_result_only`, `returned_rows` and `preview_truncated`;
- column index/name and the number of returned rows containing a SQL NULL;
- an advisory reminder to preserve missing groups, label subsets/top-N and
  reconcile disjoint groups with a total at the same grain/filter/time window.

This describes the returned result, not source coverage. One NULL row in a
grouped result can represent many source records. A SQL LIMIT, excluded NULL
filter or join omission cannot be inferred from these fields. Coverage must be
established from actual query evidence. NULL alone does not trigger a quality
block or become zero; existing explicit quality warnings are retained.

An exact successful SQL repeat within the same tool instance includes
`prior_execution` pointing to the previous artifact. The SQL still executes
and captures fresh evidence. At most 16 query-to-artifact references are kept
in that instance; no rows are cached by this feature. No semantic-equivalence
heuristic skips changed queries or conflates scopes, strings or parameters.
Existing short-lived schema caching remains separate.

The ecommerce skill 1.0.11 guides cross-turn reuse of sufficient evidence and
denominator checks. These instructions are not a deterministic final-answer
validator. Retest real multi-turn model answers after deployment to verify
that the omission and redundant-query behavior improves.

Regression: `packages/dbgpt-app/src/dbgpt_app/tests/test_sql_distribution_coverage.py`
uses a disposable SQLite fixture, without model requests or live data changes.
