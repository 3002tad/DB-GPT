"""Shared interpretation guidance, not a classifier or an execution gate."""

TREND_GUIDANCE = """## Time-series interpretation
Distinguish net change between endpoints from a sustained or monotonic recovery.
Before a directional claim, inspect adjacent observed periods at the same grain
and scope using SQL/Python on captured results; reuse sufficient existing evidence.
State the comparison interval, intervening declines or reversals, and the latest
segment. A final uptick is a rebound, not proof of continued recovery. Missing,
NULL, irregular or partial periods do not become zero or consecutive periods.
Smoothed charts, peaks/troughs and positive endpoint change alone cannot establish
a continuous trend. Qualify uncertainty rather than inventing missing evidence.
For weekly comparisons, state the week convention and number of observed days;
month-boundary weeks may be partial. Compare equal-duration windows or daily
rates, not unqualified partial-week totals. A comparison of two half-month means
is descriptive, not a significance test or proof of weekly stability. Use
'statistically significant/not significant' only with an actual test and its
assumptions; otherwise report the observed difference and uncertainty.
Independent counts of orders and cart-linked sessions form a descriptive ratio,
not cart-to-order conversion without linked cohorts and temporal ordering.
When delivering generated charts, use the published image/artifact URL supplied
by the successful tool, never a local plots/... path. Finish the task plan before
the final answer; the final explanation may use kind=final_response, while any
unfinished analysis remains explicitly unfinished."""
