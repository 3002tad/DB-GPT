---
name: excel-data-analyzer
description: Inspect Excel workbooks and sheets, profile columns and missing values, and analyze supported trends or comparisons. Use when a user supplies an XLSX/XLS workbook or asks questions about spreadsheet data.
---

# Excel Data Analyzer

## Workflow

1. Identify the supplied workbook and list its sheets. Inspect headers, merged/header rows, dates, units and the row grain before combining sheets.
2. Profile the requested sheets using the available Python tools or the bundled `scripts/analyze_excel.py` helper. Its CLI accepts a positional file path, optional `--sheet <name>` and optional `--max-rows <n>`. It requires pandas and the appropriate Excel reader (for example openpyxl for XLSX).
3. Review the helper's JSON: sheet row counts, column names, types, missing values, numeric summaries and samples. If `--max-rows` is used, disclose that the profile is bounded; do not present its counts as full-workbook totals.
4. Validate dates, keys, duplicate rows and joins across sheets. Use executed calculations for the requested question, with explicit denominators and compatible units/currencies. Formatting and sheet names alone do not establish business semantics.
5. Explain results in the user's language, including workbook/sheet scope, evidence, quality limitations and what cannot be concluded. Treat associations as descriptive unless causal evidence exists.

## Recovery

For a structured report, the general `csv-data-analysis` skill supports spreadsheet input. For custom calculations, use the existing Python/data tools. Inspect actual columns after a schema error instead of repeating the same failed calculation. Do not overwrite the workbook or claim that generated fixture values are observed business facts.
