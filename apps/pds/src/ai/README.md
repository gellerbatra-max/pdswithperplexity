# `ai` — the assistant layer

An assistant, not a chatbot. There is no prompt box, no conversation, and no
floating window. The assistant appears as one inspector section beside the thing
it is talking about, stays quiet until something is selected, and proposes
structured changes the user accepts or ignores.

```
ai/
├── index.ts               Public surface
├── types.ts               Recommendation, provider contract, capabilities
├── provider.ts            Provider registry + the local default
├── mock.ts                Hand-written recommendations for the seed pattern
├── useRecommendations.ts  Binds the provider to workspace + selection
└── README.md
```

## Local-first, enforced

A pattern is commercially sensitive intellectual property. The architecture
assumes inference runs on the machine:

- Every provider declares `runtime: 'local' | 'remote'`.
- The default, `localMockProvider`, is local and performs no I/O.
- `setAiProvider` **throws** when handed a remote provider unless
  `allowRemoteProviders(true)` was called first.

That last line is the point: "can this app upload my patterns" is answerable by
grepping for one function, rather than by auditing every call site. A real build
would gate that opt-in behind an explicit setting.

The active provider's name and runtime are printed under the suggestions list,
so local-first is visible to the user and not just true in the source.

## Recommendation shape

Never free text. Each one carries:

| Field | Purpose |
| --- | --- |
| `title` | The proposal, imperative, one line |
| `why` | The observation behind it |
| `changes[]` | Structured edits — target, summary, `from` → `to` |
| `confidence` | 0–1, displayed only; never used to auto-apply |
| `target` | Piece and optional point the advice attaches to |
| `preview` | **Implemented** — selects and frames the target, changes nothing |
| `apply` | **Placeholder** — renders disabled with its reason attached |

Preview is real because revealing geometry needs no model. Apply is not, and
says so: nothing in this codebase can modify a document from a recommendation.

## What is mocked

`mock.ts` is hand-written against the seed pattern — dart placement, seam
allowance mismatch, balance notch, and three grading anomalies. No model is
called anywhere. The mocks are shaped exactly like real provider output, so
swapping in inference means replacing the source and nothing else.

Filtering is done by the provider, not the UI: it returns only recommendations
matching the requested workspace and selection. A provider that ignores context
would flood the panel, which is the failure mode this design exists to avoid.

## Wiring a real provider

Implement `AiProvider`, then:

```ts
setAiProvider(myLocalProvider); // runtime: 'local'
```

`useRecommendations` is already asynchronous and discards stale responses, so a
model with real latency needs no UI change. It is the only thing features call —
no component talks to a provider directly.
