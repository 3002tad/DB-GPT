# Funnelmetry Knowledge Base integration

The shared KLTN Knowledge Base is available to Pipeline Admin and Analyst.
Opening a space uses POST `knowledge/{space}/arguments` to read retrieval
settings and POST `knowledge/{space}/tools/ls-json` to browse the indexed
file tree. The role policy admits these read operations and the existing
read tools (`ls`, `glob`, `grep`, `cat`, `semantic_search`). This does not
grant a generic prefix for mutations or access to model/provider credentials.

## Retrieval evidence

Selecting a KB binds its tools and runs a bounded prefetch before the first
Agent model call. A task can use the prefetched context without making a
separate KB tool call. Absence of a KB tool in the step list does not establish
that retrieval was skipped.

`knowledge.prefetch` spans retain the exact selected excerpts. The SSE stream
now also emits `knowledge.prefetch` with status, space, document/chunk IDs,
document version when present, excerpt hashes, context hash/length and
`included_in_prompt`. The last field confirms that the returned context was
included in the constructed system prompt. It does not certify that the model
used or understood it, or that a final claim is grounded. Final citations still
need to be assessed separately; retrieval provenance is not fabricated into
an answer citation. When version metadata is missing, the field remains null;
the document/space identity and hash can be used to inspect the published copy.

Missing or unavailable KB retrieval leaves an explicit status and allows
the Agent to continue with other evidence. This path uses the selected space;
it does not impose a fixed list of analytical tools or SQL queries.

## Q08 verification, 2026-11-07

Existing conversation `ed1d68ae-6f48-401d-a065-ef05fc599819` on image
`bfdc89e1-agent` has a `knowledge.prefetch` span with `status=retrieved`,
space ID 8, `funnelmetry-demo-1-2-0-112e65b3b815`, document ID 8 and three
chunks. They describe session/browser-event schema, the difference between
independent counts and conversion, and the two coverage views. They do not
contain the cart-link or order-ON definitions. Final citations were empty.
The inspected `Agent.llm_client.no_streaming_call` spans contain the retrieved
context in all 13 model-call prompts. This confirms delivery to the model for
that run; it does not establish that every definition required by Q08 was
retrieved or used correctly.

The final six counts matched the golden SQL, but its summary called a cart
link an addition and its explanation called order ON terminal. Skill 1.0.7
clarifies these labels throughout the answer: cart links establish identity
correlation; additions need cart mutations or `cart.item_added`. An order row
ON is a retractable reference current state. A terminal journey claim needs
the profile's checkout/transition/coverage evidence. This is prompt guidance,
not a claim that a subsequent model evaluation has already passed.

After deploying code commit `cec29533` on 2026-11-07, authenticated checks for
both Analyst and Admin returned HTTP 200 and `success=true` for `ls-json` and
`arguments`, replacing the reproduced 403 responses. No additional analysis
model call was made for this check.
