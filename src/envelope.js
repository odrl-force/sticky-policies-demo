import { prefixes, rules, policyFacts, createEvidence } from "./policy.js";
import { partitionConclusion, serializeGraph } from "./report.js";

export const payload = `${prefixes}
# Entirely invented measurements, not real patient records.
:cohort-b a :SyntheticResearchCohort; :observationCount 3.
:sample-1 a :SyntheticObservation; :value 12.4; :unit "arbitrary units".
:sample-2 a :SyntheticObservation; :value 15.8; :unit "arbitrary units".
:sample-3 a :SyntheticObservation; :value 11.2; :unit "arbitrary units".
`;

export const envelopeFormat = "sticky-policies-demo/trig-v3";
export const envelopePrefixes = `${prefixes}@prefix te: <https://w3id.org/trustenvelope#> .
@prefix eu-dga: <https://w3id.org/dpv/legal/eu/dga#> .
`;

// Preserve multiline N3 as RDF string literals. N3 formulae cannot be embedded
// directly as native TriG triples, so the exact proof and rules are artifacts.
function literal(text) {
  return (
    '"""' +
    [...String(text)]
      .map((char) => (char === "\n" ? "\n" : JSON.stringify(char).slice(1, -1)))
      .join("") +
    '"""'
  );
}
export function graphBody(text) {
  return text.replace(/^@prefix[^\n]*\.\s*$/gm, "").trim();
}
export async function sha256(text) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function createEnvelope(
  snapshot,
  engineVersion,
  createdAt = new Date().toISOString(),
) {
  const { facts, output, proof, audit, state, allowed } = snapshot;
  // A trust envelope carries an instantiated policy. Without an Active
  // permission there is none, so a denied request yields only a report.
  if (!allowed)
    throw new Error(
      "A trust envelope is only issued when the permission is Active",
    );
  const partitioned = partitionConclusion(output);
  const [reportText, agreementText, outcomeText] = await Promise.all([
    serializeGraph(partitioned.reports),
    serializeGraph(partitioned.agreement),
    serializeGraph(partitioned.outcomes),
  ]);
  const artifacts = [
    ["payload", "data.ttl", payload],
    ["facts", "facts.n3", facts],
    ["rules", "rules.n3", rules],
    ["conclusion", "decision.n3", output],
    ["report", "compliance-report.ttl", reportText],
    ["proof", "decision.proof.n3", proof],
    ["audit", "verification.txt", audit],
  ];
  const artifactStatements = await Promise.all(
    artifacts.map(
      async ([key, name, text]) =>
        `:${key}-artifact :name ${literal(name)};\n  :text ${literal(text)};\n  :sha256 "${await sha256(text)}".`,
    ),
  );
  const sender = state.recipient === "partner-lab" ? "university" : "hospital";
  return `${envelopePrefixes}
# Trust envelope (https://w3id.org/trustenvelope): one act of sending one data
# unit to one recipient, with the policy instantiated for that use. Blank nodes
# name the graphs: _:data is the data unit and the ODRL target, _:policy holds
# the policy and agreement, _:evidence the request and DPV assertions, and
# _:report the FORCE compliance report.
:envelope a te:TrustEnvelope;
  dct:issued "${createdAt}"^^xsd:dateTime;
  dpv:hasData _:data;
  odrl:hasPolicy :agreement-42;
  te:provenance :data-provenance, :policy-provenance;
  :format "${envelopeFormat}";
  :engine ${literal(`Eyeron ${engineVersion}`)};
  :payload :payload-artifact;
  :facts :facts-artifact;
  :rules :rules-artifact;
  :conclusion :conclusion-artifact;
  :report :report-artifact;
  :proof :proof-artifact;
  :audit :audit-artifact;
  :dataspace :research-dataspace;
  :simulated true;
  :authenticated false.
# te:sign is omitted: this demo envelope is unsigned.

:data-provenance a te:DataProvenance;
  dct:issued "${createdAt}"^^xsd:dateTime;
  te:sender :${sender};
  eu-dga:hasDataHolder :hospital.
:policy-provenance a te:PolicyProvenance;
  dct:issued "${createdAt}"^^xsd:dateTime;
  te:recipient :${state.recipient};
  te:rightsHolder :hospital;
  :policyGraph _:policy;
  :evidenceGraph _:evidence;
  :reportGraph _:report;
  :complianceReport :policy-report.

:research-dataspace :label "Illustrative research dataspace".

# Actual payload triples, entirely synthetic. This is not a data URL or a JSON string.
_:data {
${graphBody(payload)}
}

# The hospital's ODRL policy, and the agreement derived from it for this recipient.
_:policy {
${graphBody(policyFacts)}
${graphBody(agreementText)}
}

# The request and the supporting assertions about the same data graph.
_:evidence {
${graphBody(createEvidence(state))}
${graphBody(outcomeText)}
}

# FORCE evaluation/compliance report derived by N3 rules.
_:report {
${graphBody(reportText)}
}

# Exact source documents for replaying the captured N3 proof. These are
# strings because N3 rules and quoted formulae are not part of TriG syntax.
${artifactStatements.join("\n\n")}

:envelope :trustBoundary "Unsigned demo. Source-text hashes and graph comparisons detect inconsistencies but do not authenticate issuers. Blank node labels are local to this RDF dataset. The proof checks supplied assertions, not real consent or enforcement.".
`;
}
