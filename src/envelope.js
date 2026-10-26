import { prefixes, rules } from "./policy.js";

export const payload = `${prefixes}
# Entirely invented measurements, not real patient records.
:cohort-b a :SyntheticResearchCohort; :observationCount 3.
:sample-1 a :SyntheticObservation; :value 12.4; :unit "arbitrary units".
:sample-2 a :SyntheticObservation; :value 15.8; :unit "arbitrary units".
:sample-3 a :SyntheticObservation; :value 11.2; :unit "arbitrary units".
`;

export const envelopeFormat = "sticky-policies-demo/trig-v1";
export const envelopePrefixes = `${prefixes}@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
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
  const artifacts = [
    ["payload", "data.ttl", payload],
    ["facts", "facts.n3", facts],
    ["rules", "rules.n3", rules],
    ["conclusion", "decision.n3", output],
    ["proof", "decision.proof.n3", proof],
    ["audit", "verification.txt", audit],
  ];
  const artifactStatements = await Promise.all(
    artifacts.map(
      async ([key, name, text]) =>
        `:${key}-artifact :name ${literal(name)};\n  :text ${literal(text)};\n  :sha256 "${await sha256(text)}".`,
    ),
  );
  return `${envelopePrefixes}
# Trust envelope: the blank node _:data both labels the payload graph and
# appears as the target of the ODRL permissions in the context graph.
:envelope a :TrustEnvelope;
  :format "${envelopeFormat}";
  :createdAt "${createdAt}"^^xsd:dateTime;
  :engine ${literal(`Eyeron ${engineVersion}`)};
  :dataGraph _:data;
  :contextGraph _:context;
  :decisionGraph _:decision;
  :policy :policy-b;
  :payload :payload-artifact;
  :facts :facts-artifact;
  :rules :rules-artifact;
  :conclusion :conclusion-artifact;
  :proof :proof-artifact;
  :audit :audit-artifact;
  :decision :${allowed ? "PermissionEstablished" : "PermissionNotEstablished"};
  :dataspace :research-dataspace;
  :originalProvider :hospital;
  :sendingParticipant :${state.recipient === "partner-lab" ? "university" : "hospital"};
  :receivingParticipant :${state.recipient};
  :simulated true;
  :authenticated false.

:research-dataspace :label "Illustrative research dataspace".
_:data :stickyPolicy :policy-b.

# Actual payload triples, entirely synthetic. This is not a data URL or a JSON string.
_:data {
${graphBody(payload)}
}

# Native RDF policy, request and supporting assertions about that same graph.
_:context {
${graphBody(facts)}
}

# Derived conclusions, kept separate from the supplied context.
_:decision {
${graphBody(output)}
}

# Exact source documents for replaying the captured N3 proof. These are
# strings because N3 rules and quoted formulae are not part of TriG syntax.
${artifactStatements.join("\n\n")}

:envelope :trustBoundary "Unsigned demo. Source-text hashes and graph comparisons detect inconsistencies but do not authenticate issuers. Blank node labels are local to this RDF dataset. The proof checks supplied assertions, not real consent or enforcement.".
`;
}
