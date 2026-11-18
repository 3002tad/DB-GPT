# Skill script argument handling

The native schema requests JSON object `args` or a list of string `argv` for
CLI scripts. Model calls can encode the nested object/list as a JSON string.
The runner decodes exactly one JSON layer and validates its type before
processing attachments, applying input contracts or starting a subprocess.
It does not parse shell strings, split command lines or recursively decode
values inside an object.

- JSON scripts: `args={"input_file":"<attached file>"}`.
- CLI scripts: `argv=["<one argument>","--flag","value"]`.
- Do not supply both modes to `run_skill_script`.
- Invalid shapes return `success:false`, `SKILL_ARGUMENTS_INVALID` and a
  recovery hint. They do not start a script or create a success artifact.

Normalization is shared by the unified tool, the legacy file tool and the
SkillManager file executor. Dictionaries/lists are copied before attachment
path substitution. Selected-skill scope, attachment authorization, captured
upstream contracts, script identity checks and artifact capture remain in
place. A repaired call and other tools remain available; repeated failures
use the existing advisory recovery rather than a new execution cap.

## RUN18-03

The Analyst trace showed repeated `'str' object has no attribute 'keys'`.
The file tool assumed `args` was a dictionary at attachment-path substitution.
Native FunctionTool forwards runtime values without enforcing that nested
annotation, so a JSON-encoded string reached `args.keys()`.

Nine targeted tests passed on 2026-11-18. They exercise the real CSV analyzer,
real CLI execution with spaces/shell characters, generated HTML from a test
script, evidence capture, invalid input rejection and advisory recovery/reset.
Execution used synthetic files in a temporary directory and a separate process
with the current image's dependencies. No LLM or live customer data was used.

Source is fixed; deployment and Analyst browser retest remain pending. The
tests prove script/argument handling, not the full Agent-generated CSV report
or the language/content of that report. Those require post-deploy acceptance.
