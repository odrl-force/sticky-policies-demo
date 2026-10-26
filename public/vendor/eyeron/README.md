# Vendored Eyeron runtime

Eyeron **0.8.21**, retrieved on 2026-10-26 from:

- https://eyereasoner.github.io/eyeron/pkg/eyeron.js
- https://eyereasoner.github.io/eyeron/pkg/eyeron_bg.wasm

Upstream project: https://github.com/eyereasoner/eyeron

The MIT license is included as `LICENSE.md`. The application rules in `src/policy.js` adapt the upstream `examples/verifiable-decision.n3` example, with additional demo-specific retention and policy-preservation rules.

SHA-256 of the vendored runtime:

```
a9ceb7568c9c5d9295181bb09f51b37b0cafff5ac0cc789031fe1eb56bfdf158  eyeron.js
6ccc9b42a1136c2b833e010a253dddfbb30a1d2009f0c562ec3784039f75c728  eyeron_bg.wasm
```

Upgrade the JavaScript glue and WebAssembly binary together, retain their license, update this record, and run `npm test` before deploying. Both files are served from the site itself; the app makes no runtime requests to a reasoning service or CDN.
