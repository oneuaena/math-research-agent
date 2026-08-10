# Mathematical Verification and Evidence Levels

Math Research Agent separates model assessment, empirical support, computation, exact witnesses, symbolic checks, and formal proof. A stronger label may be assigned only when the stored artifact justifies that exact scope.

## Levels

### UNVERIFIED

No independent evidence establishes the claim. New model-generated statements and proof steps begin here or as `LLM ASSESSED ONLY`.

### LLM ASSESSED ONLY

One or more model passes considered the statement plausible, criticized it, or found no obvious flaw. This is not independent verification. Multiple models agreeing does not upgrade the level.

### NUMERICALLY SUPPORTED

A numerical experiment supports the claim over a stated sample, range, precision, and tolerance. Required record: code/input, bounds, precision/tolerance, seed when random, output, environment, and interpretation.

It cannot establish an exact universal theorem, exclude unsampled counterexamples, or justify a proof step that depends on exact equality.

### COMPUTATIONALLY VERIFIED

A reproducible program checked a bounded statement or artifact with a declared algorithm. The label applies only to the checked domain and implementation. Independent reruns, test vectors, and exact input/output strengthen the evidence but do not automatically generalize it.

### SYMBOLICALLY VERIFIED

A symbolic engine validated the specified identity, simplification, solution, derivative, integral, or transformation under recorded assumptions. The label applies to the encoded expression; it does not prove that the encoding faithfully represents the original natural-language theorem.

### EXACTLY VERIFIED

Exact arithmetic, exhaustive finite search, or an independently rerun exact witness establishes the recorded finite claim. An exact counterexample must satisfy every assumption and falsify the conclusion on a separate check.

An exact witness refutes a universal statement, but exact verification of finitely many positive cases does not prove an unbounded statement.

### FORMALLY VERIFIED

A trusted proof assistant kernel has accepted a faithful formalization of the theorem and assumptions. The record must identify the formal source, tool/version, dependencies/axioms, command, and successful output.

The current application detects Lean/SageMath availability but does not automatically invoke a complete proof-assistant adapter or emit a separate `formally-verified` persisted status. Capability detection, generated Lean text, or an LLM saying “Lean accepts this” must not be labeled `FORMALLY VERIFIED`.

## Promotion rules

A result may move upward only when a new stored artifact directly supports the stronger label. The following do **not** promote evidence:

- a model's confidence score;
- repeated retries or agreement among model roles;
- survival of bounded tests;
- adapter availability without an executed check;
- unrecorded manual computation;
- a source citation that does not contain the claimed result;
- approximate equality presented as exact equality.

When assumptions, encoding, numerical tolerance, search bounds, or dependencies change, re-run the relevant verification.

## Candidate proofs

Candidate proofs must:

1. state assumptions, definitions, and the precise target;
2. identify dependencies for every critical step;
3. preserve unresolved gaps as `UNCERTAIN`, `REQUIRES_LEMMA`, `REQUIRES_COMPUTATION`, or `REQUIRES_FORMALIZATION`;
4. receive independent skeptical review;
5. attach machine/formal evidence only to the steps it actually checks;
6. avoid a verified-proof label while any critical step is not `VALID`.

## Counterexamples

A counterexample record should include the exact input, parameters, environment, expression, computation, code, output, verification checks, and search context. Recheck:

- domain and all assumptions;
- exact evaluation of the claimed property;
- independent rerun of the candidate;
- serialization precision and integer/rational semantics.

One valid counterexample can refute a universal claim. A candidate that fails an assumption is not a counterexample.

## Public result reports

Every public result should state the application version, provider/model, research configuration and budgets, evidence level, witness or proof artifact, verification method/tool version, reproduction steps, and remaining uncertainty. “AI says proved” is not an acceptable result report.
