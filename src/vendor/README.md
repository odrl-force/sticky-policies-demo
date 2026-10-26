# N3.js browser module

`n3.js` is the unmodified `browser/n3.esm.min.js` distribution from N3.js 2.13.12, as locked in this project's package-lock.json. The MIT license is included in `n3-LICENSE.md`.

Upstream: https://github.com/rdfjs/N3.js

This local module parses the actual FORCE report RDF in the browser and serializes the report/decision graph projections. It is not a reasoning engine: Eyeron applies the N3 rules and produces the report states.

When upgrading, replace the module and license together from the locked npm package, and rerun the policy/envelope and browser checks.
