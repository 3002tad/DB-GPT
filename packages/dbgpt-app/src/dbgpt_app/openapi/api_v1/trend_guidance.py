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
Compute every displayed percentage, complement, ratio and difference using
SQL/Python on the captured evidence; do not calculate new figures mentally in
the final prose. Label numerator and denominator consistently: with an event
and without that event are complementary populations only at the same grain,
scope and deduplication. A checkout-start count measures starts, not abandonment.
For hour/day-of-week analyses state the timestamp type and timezone used for
both filtering and grouping. Do not label UTC/session-timezone hours as local
customer hours. If a local zone is requested, convert explicitly and use matching
local interval boundaries. Unequal time buckets need counts AND exposure hours
or comparable rates; the largest count is not necessarily the highest density.
When delivering generated charts, use the published image/artifact URL supplied
by the successful tool, never a local plots/... path. Finish the task plan before
the final answer; the final explanation may use kind=final_response, while any
unfinished analysis remains explicitly unfinished."""
