# Third-Party Notices

Math Research Agent is licensed under Apache-2.0. That license does not replace the licenses of its dependencies.

The following table records the direct dependencies resolved in `package-lock.json` for the current release. Transitive notices remain available in each installed package and, for Electron distributions, in the generated Chromium licenses file.

| Dependency | Use | Resolved version | License |
| --- | --- | ---: | --- |
| @xyflow/react | Research graph rendering | 12.11.2 | MIT |
| fast-xml-parser | arXiv Atom metadata parsing | 5.10.1 | MIT |
| KaTeX | Mathematical typesetting | 0.16.47 | MIT |
| lucide-react | Icons | 0.468.0 | ISC |
| mammoth | DOCX text extraction | 1.12.1 | BSD-2-Clause |
| pdf-parse | Page-aware PDF text extraction | 2.4.5 | Apache-2.0 |
| React / React DOM | Renderer UI | 19.2.8 | MIT |
| react-markdown | Markdown rendering | 10.1.0 | MIT |
| rehype-katex | KaTeX integration | 7.0.1 | MIT |
| remark-math | Math syntax parsing | 6.0.0 | MIT |
| Zod | Runtime validation | 4.4.3 | MIT |
| Zustand | Renderer state | 5.0.14 | MIT |

Major development and packaging dependencies include Electron (MIT), Playwright (Apache-2.0), TypeScript (Apache-2.0), Vite (MIT), Vitest (MIT), ESLint (MIT), Tailwind CSS (MIT), and electron-builder (MIT). Exact versions are locked in `package-lock.json`.

The self-contained Windows installer bundles the following runtime components outside `app.asar`. Their license files and package metadata are retained in the runtime and release resources:

| Dependency | Use | Requirement | License family |
| --- | --- | --- | --- |
| CPython embeddable distribution | Python runtime | 3.12.10 | Python Software Foundation License Version 2 and included notices |
| SymPy | Symbolic mathematics | 1.14.0 | BSD-3-Clause |
| mpmath | Arbitrary-precision dependency of SymPy | 1.3.0 | BSD-3-Clause |
| NumPy | Numerical experiments | 2.4.6 | BSD-3-Clause and bundled permissive notices |
| SciPy | Scientific routines | 1.17.1 | BSD-3-Clause and bundled runtime notices |
| z3-solver | SMT adapter | 4.15.4.0 | MIT |

The self-contained macOS Apple Silicon and Intel packages bundle CPython 3.12.14, SymPy 1.14.0, mpmath 1.3.0, NumPy 2.4.6, SciPy 1.17.1, and z3-solver 4.15.4.0. They also bundle the matching Darwin native binary from `@napi-rs/canvas` 0.1.80 (MIT) for document rendering. Upstream license files and package metadata remain in the packaged runtime or Electron resources.

The bundled SciPy/NumPy wheels may include native numerical runtimes and GCC runtime components. Where GPL-3.0-or-later code is present, it is covered by the GCC Runtime Library Exception, which permits eligible generated target code to be distributed under terms of the distributor's choice. Full upstream notices remain in the bundled `.dist-info/licenses` directories. The project's Apache-2.0 license does not relicense these components.

Lean, SageMath, DeepSeek, OpenAI, Anthropic, and other provider or tool names are factual compatibility references only. Lean 4/Lake is supported as an external executable (v4.32.0 was used for the v1.1.0 validation) and remains under its upstream Apache-2.0 license; it is not bundled. SageMath and model-provider services are not bundled, owned, or endorsed by this project.
