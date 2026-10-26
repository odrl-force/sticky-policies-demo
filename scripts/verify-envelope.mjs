import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import init, { runCliReport } from "../public/vendor/eyeron/eyeron.js";
import { interpret } from "../src/policy.js";
import { readEnvelope } from "./envelope-validation.mjs";

let initialized;
export async function verifyEnvelope(text) {
  const envelope = await readEnvelope(text);
  initialized ??= readFile(
    new URL("../public/vendor/eyeron/eyeron_bg.wasm", import.meta.url),
  ).then((bytes) => init({ module_or_path: bytes }));
  await initialized;
  const sources = [
    { name: "rules.n3", text: envelope.artifacts.rules },
    { name: "facts.n3", text: envelope.artifacts.facts },
  ];
  function run(args, proof) {
    let output = "";
    const report = JSON.parse(
      runCliReport(
        JSON.stringify({ args, sources, ...(proof ? { proof } : {}) }),
        (text) => {
          output += text;
        },
      ),
    );
    if (!report.ok)
      throw new Error(report.stderr || output || "Proof verification failed");
    return output;
  }
  const audit = run(
    ["--check-proof", "decision.proof.n3", "rules.n3", "facts.n3"],
    { name: "decision.proof.n3", text: envelope.artifacts.proof },
  );
  const output = run(["rules.n3", "facts.n3"]);
  if (output !== envelope.artifacts.conclusion)
    throw new Error("The recorded conclusion differs from fresh reasoning");
  const decision = interpret(output).allowed
    ? "permission-established"
    : "permission-not-established";
  if (decision !== envelope.decision)
    throw new Error(
      "The declared decision differs from the derived conclusion",
    );
  return { decision, audit };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (!process.argv[2])
      throw new Error(
        "Usage: npm run verify -- /path/to/cohort-b.trust-envelope.trig",
      );
    const { decision, audit } = await verifyEnvelope(
      await readFile(process.argv[2], "utf8"),
    );
    console.log(audit);
    console.log(
      `Verified: ${decision}. The TriG payload and context match the replay sources. This unsigned envelope does not authenticate its issuers.`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
