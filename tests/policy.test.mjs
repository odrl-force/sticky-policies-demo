import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import init, { runCliReport } from "../public/vendor/eyeron/eyeron.js";
import { rules, createFacts, defaultState, interpret } from "../src/policy.js";

await init({
  module_or_path: await readFile(
    new URL("../public/vendor/eyeron/eyeron_bg.wasm", import.meta.url),
  ),
});
const names = ["rules.n3", "facts.n3"];
function execute(facts, flags = [], proof) {
  let output = "";
  const report = JSON.parse(
    runCliReport(
      JSON.stringify({
        args: [...flags, ...names],
        sources: [
          { name: names[0], text: rules },
          { name: names[1], text: facts },
        ],
        ...(proof ? { proof: { name: "decision.proof.n3", text: proof } } : {}),
      }),
      (text) => {
        output += text;
      },
    ),
  );
  return { output, report };
}
function reason(changes) {
  const result = execute(createFacts({ ...defaultState, ...changes }));
  assert.equal(result.report.ok, true, result.report.stderr);
  return interpret(result.output);
}
test("Research derives an ODRL agreement with the original sticky policy", () => {
  const result = execute(createFacts(defaultState));
  assert.equal(interpret(result.output).allowed, true);
  assert.deepEqual(interpret(result.output).checks, [
    true,
    true,
    true,
    true,
    true,
  ]);
  assert.match(result.output, /:agreement-42 :inheritsPolicy :policy-b/);
});
test("All combinations of evidence, purpose, retention and recipient require the full conjunction", () => {
  let combinations = 0;
  for (const recipient of ["university", "partner-lab"]) {
    for (const purpose of ["ScientificResearch", "Marketing"]) {
      for (const days of [1, 30, 31]) {
        for (let mask = 0; mask < 16; mask++) {
          const approval = Boolean(mask & 1),
            consent = Boolean(mask & 2),
            deidentified = Boolean(mask & 4),
            carry = Boolean(mask & 8);
          const result = reason({
            recipient,
            purpose,
            days,
            approval,
            consent,
            deidentified,
            carry,
          });
          assert.equal(
            result.allowed,
            purpose === "ScientificResearch" &&
              days <= 30 &&
              approval &&
              consent &&
              deidentified &&
              carry,
            JSON.stringify({ recipient, purpose, days, mask }),
          );
          combinations++;
        }
      }
    }
  }
  assert.equal(combinations, 192);
});
test("New recipient cannot reuse the university approval", () => {
  const facts = createFacts(defaultState).replace(
    "odrl:assignee :university",
    "odrl:assignee :partner-lab",
  );
  const result = interpret(execute(facts).output);
  assert.equal(result.allowed, false);
  assert.equal(result.checks[0], false);
});
test("The attached policy purpose still constrains claims of marketing approval and consent", () => {
  const facts = createFacts(defaultState)
    .replaceAll("dpv:ScientificResearch", "dpv:Marketing")
    .replace(
      "odrl:rightOperand dpv:Marketing",
      "odrl:rightOperand dpv:ScientificResearch",
    );
  const result = execute(facts);
  assert.equal(result.report.ok, true);
  assert.equal(interpret(result.output).allowed, false);
});
test("The exact saved proof verifies against the original sources", () => {
  const facts = createFacts(defaultState);
  const proof = execute(facts, ["--proof"]);
  assert.ok(proof.output.includes("pe:rule"));
  const checked = execute(
    facts,
    ["--check-proof", "decision.proof.n3"],
    proof.output,
  );
  assert.equal(checked.report.ok, true, checked.report.stderr);
  assert.match(checked.output, /0 failed/);
  assert.match(checked.output, /verified/);
});
test("The saved grant proof fails when its supporting consent is withdrawn", () => {
  const proof = execute(createFacts(defaultState), ["--proof"]).output;
  const changedFacts = createFacts({ ...defaultState, consent: false });
  const checked = execute(
    changedFacts,
    ["--check-proof", "decision.proof.n3"],
    proof,
  );
  assert.equal(checked.report.ok, false);
});
test("An unsupported request has a verifiable partial derivation, but no grant", () => {
  const facts = createFacts({ ...defaultState, carry: false });
  const proof = execute(facts, ["--proof"]).output;
  const checked = execute(facts, ["--check-proof", "decision.proof.n3"], proof);
  assert.equal(checked.report.ok, true);
  assert.equal(interpret(execute(facts).output).allowed, false);
});
test("Request values cannot inject N3 or invalid retention values", () => {
  for (const patch of [
    { purpose: "Marketing. :attack a :Attack" },
    { recipient: "outsider" },
    { days: -1 },
    { days: 1.5 },
    { days: 91 },
  ])
    assert.throws(() => createFacts({ ...defaultState, ...patch }));
});
