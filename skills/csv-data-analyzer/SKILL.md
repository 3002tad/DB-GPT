---
name: csv-data-analyzer
description: Profile CSV and TSV files, inspect data quality, summarize distributions and investigate trends or comparisons supported by the observed columns. Use when a user uploads tabular text data or requests exploratory file analysis.
---

# CSV Data Analyzer

## Workflow

1. Identify the user-provided file, encoding, delimiter, headers and requested question. Inspect column names and a bounded sample before selecting measures, dimensions or joins.
2. Use the available Python/data tools (for example pandas) to load the file. Report the parsed row count, missing values, types and duplicate keys. Distinguish a sampled profile from a complete-file calculation.
3. Establish the row grain, date range and units from the file or supplied metadata. Preserve raw labels such as UTM source values; do not invent business mappings.
4. Compute the requested distributions, comparisons or trends using executed code. Validate join cardinality, denominators and grouping keys. Do not add amounts across different currencies or grains without an explicit supported conversion.
5. Present the result in the user's language with the calculation, file scope, relevant quality limitations and evidence. Separate observed associations from causal explanations.

## Reporting and recovery

For a structured CSV/Excel report, the existing `csv-data-analysis` skill and its bundled analyzer/template can be loaded as needed. General analysis does not require that report template. This skill has no dedicated analysis script; `scripts/example.py` is a scaffold, not a data profiler.

If parsing or a column assumption fails, inspect the file/schema and correct that assumption before retrying. Ask for missing definitions when necessary. Do not fabricate measurements, financial meaning or statistical significance, and never alter the user's source file to make an analysis pass.
