# Evaluation management

The `/evaluation` page uses the native Evaluate service with dataset/run
management routes registered under its existing v1/v2 prefixes. The legacy UI
management URLs previously returned 404 because only direct evaluation and
benchmark execution endpoints remained registered.

Management stores both datasets and runs in the existing `evaluate_manage`
table. Dataset rows use `scene_key=dataset`; runs use `app` or `recall`. Lists
separate these kinds and scope all reads/mutations to the authenticated user ID
injected by Pipeline identity middleware. This correction does not extend the
existing Admin-only Evaluation policy to Analyst.

Supported dataset input is a non-empty JSON array, JSONL or UTF-8 CSV, with a
non-empty `query` per row. Include `factual` for application metrics; retrieval
evaluation uses the native knowledge document/space bindings. Input examples:

```json
[{"query":"What is the fixture answer?","factual":"42"}]
```

Both inline JSON and file upload are parsed and saved to database storage;
file mode does not claim OSS integration or accept arbitrary server paths.
Uploads have a 10 MiB read ceiling. Members are retained as descriptive dataset
metadata; changing them does not grant Pipeline roles or bypass owner checks.
CSV/JSON/JSONL are advertised by the form; Excel is not advertised or parsed.

Run creation resolves an owned dataset, validates registered metrics, saves a
running record, invokes `Service.run_evaluation`, then persists detailed metric
results and average scores. Errors save a failed run with diagnostic information.
Execution currently completes within the request; this is not a durable
background-job queue. Native App/recall execution may call configured models or
embedding providers. Provider/target configuration must be valid for the chosen
metric; the deterministic fixture tests do not certify every provider/metric.

The core `ExactMatchMetric` is available alongside the existing registered
metrics. The native result adapter accepts metrics without an optional feedback
attribute; execution duration is non-negative. Existing direct-evaluation and
benchmark routes remain available.

Dataset management supports listing, upload, descriptive member updates, delete
and CSV download. Evaluation runs support listing, detail, CSV export and delete.
Run records retain the dataset snapshot so deleting the source dataset does not
erase the saved scores. UI labels use the current language; source data, metric
identifiers and filenames retain their original values.

Targeted tests exercise two rows through the native AWEL evaluator and real
`ExactMatchMetric` with fixture model output (scores 1 and 0, mean 0.5), SQL
persistence, HTTP handlers, identity middleware, exports and failed execution.
No LLM is called by these tests. After deployment, perform an Admin browser test
with a real configured App/KB and a deliberately small dataset before running
a larger evaluation batch.
