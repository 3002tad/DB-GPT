"""Shared interpretation guidance, not a classifier or an execution gate."""

TREND_GUIDANCE = """## Time-series interpretation
Distinguish net change between endpoints from a sustained or monotonic recovery.
Before a directional claim, inspect adjacent observed periods at the same grain
and scope using SQL/Python on captured results; reuse sufficient existing evidence.
State the comparison interval, intervening declines or reversals, and the latest
segment. A final uptick is a rebound, not proof of continued recovery. Missing,
NULL, irregular or partial periods do not become zero or consecutive periods.
Smoothed charts, peaks/troughs and positive endpoint change alone cannot establish
a continuous trend. Qualify uncertainty rather than inventing missing evidence."""
