import { Parser, Store, DataFactory } from "./vendor/n3.js";

export const prefixes = `@prefix : <https://example.org/access#> .
@prefix odrl: <http://www.w3.org/ns/odrl/2/> .
@prefix dpv: <https://w3id.org/dpv#> .
@prefix math: <http://www.w3.org/2000/10/swap/math#> .
@prefix log: <http://www.w3.org/2000/10/swap/log#> .
@prefix report: <https://w3id.org/force/compliance-report#> .
@prefix sotw: <https://w3id.org/force/sotw#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
`;

export const premiseDefinitions = [
  {
    id: "target-report",
    type: "TargetReport",
    label: "Target is the attached data graph",
  },
  {
    id: "action-report",
    type: "ActionReport",
    label: "Requested action matches the policy",
  },
  {
    id: "party-report",
    type: "PartyReport",
    label: "Evaluation party matches the requester",
  },
  {
    id: "purpose-report",
    type: "ConstraintReport",
    constraint: "offered-purpose",
    label: "Purpose is scientific research",
  },
  {
    id: "ethics-report",
    type: "ConstraintReport",
    constraint: "ethics-required",
    label: "Ethics approval covers this use",
  },
  {
    id: "consent-report",
    type: "ConstraintReport",
    constraint: "consent-required",
    label: "Consent covers this purpose",
  },
  {
    id: "safeguard-report",
    type: "ConstraintReport",
    constraint: "safeguard-required",
    label: "De-identification evidence is supplied",
  },
  {
    id: "retention-report",
    type: "ConstraintReport",
    constraint: "retention-limit",
    label: "Retention is within the policy limit",
  },
  {
    id: "acceptance-report",
    type: "ConstraintReport",
    constraint: "acceptance-required",
    label: "Recipient accepts the attached policy",
  },
];
const evaluation = `:evaluation-42 a sotw:EvaluationRequest; sotw:evaluatedParty ?who; sotw:evaluatedAction ?action; sotw:evaluatedTarget ?data.`;
const basic = `${evaluation}
:request-42 odrl:permission :research-use-42.`;
const requestedPurpose = `:evaluation-42 sotw:requestParameter :purpose-parameter.
:purpose-parameter sotw:describesFeature odrl:purpose; sotw:value ?purpose.`;
const satisfied = (id, body) =>
  `{ ${basic}\n${body}\n} => { :${id} report:satisfactionState report:Satisfied. }.\n`;
const unsatisfied = (id, body) =>
  `{ ${basic}\n${body}\n} => { :${id} report:satisfactionState report:Unsatisfied. }.\n`;
// FORCE: missing information counts as not satisfied. The snapshot is a closed
// world, so a premise is Unsatisfied when its complete satisfying pattern is
// absent. The pattern only uses asserted predicates, never derived ones, so the
// negation does not depend on the order in which rules fire.
const absent = (id, pattern) =>
  `{ :evaluation-42 a sotw:EvaluationRequest.\n?SCOPE log:notIncludes { ${basic}\n${pattern}\n}.\n} => { :${id} report:satisfactionState report:Unsatisfied. }.\n`;
// Satisfied when the pattern holds; Unsatisfied when it is absent.
const closed = (id, pattern) => satisfied(id, pattern) + absent(id, pattern);

// All evaluation states are N3 conclusions. JS assembles the program but does
// not precompute satisfaction or activation.
export const rules = `${prefixes}
# FORCE report structure and provenance. The compatibility ODRL Request is
# linked separately from the newer sotw:EvaluationRequest.
{ ${basic}
  :world a sotw:SotW; dct:issued ?time.
} => {
  :policy-report a report:PolicyReport; report:policy :policy-b;
    report:policyRequest :request-42; :evaluationRequest :evaluation-42;
    :stateOfWorld :world; dct:created ?time; report:ruleReport :permission-report;
    :evaluationScope :PermissionActivationOnly; :notEvaluatedRule :carry-policy.
  :permission-report a report:PermissionReport; report:rule :offered-use;
    report:ruleRequest :research-use-42;
    report:premiseReport ${premiseDefinitions.map((p) => ":" + p.id).join(", ")}.
  ${premiseDefinitions.map((p) => `:${p.id} a report:${p.type}${p.constraint ? "; report:constraint :" + p.constraint : ""}.`).join("\n  ")}
}.

# Structural premises: the offered target and action, and the party/request binding.
${closed("target-report", ":offered-use odrl:target ?data. :research-use-42 odrl:target ?data.")}
${closed("action-report", ":offered-use odrl:action ?action. :research-use-42 odrl:action ?action.")}
${closed("party-report", ":research-use-42 odrl:assignee ?who.")}

# Purpose must match both the policy and the compatibility request.
${closed(
  "purpose-report",
  `${requestedPurpose}
:offered-purpose odrl:leftOperand odrl:purpose; odrl:operator odrl:eq; odrl:rightOperand ?purpose.
:purpose-42 odrl:leftOperand odrl:purpose; odrl:operator odrl:eq; odrl:rightOperand ?purpose.`,
)}

# Evidence comes from sotw:context records, linked to the constraint they
# support with sotw:conditionID and scoped to the evaluated party, data graph
# and purpose. The constraint's own operands must say what the rules evaluate.
${closed(
  "ethics-report",
  `${requestedPurpose}
:research-use-42 odrl:assignee ?who.
:ethics-required odrl:leftOperand :matchingEthicsApproval; odrl:operator odrl:eq; odrl:rightOperand true.
:world sotw:context ?approval.
?approval a :EthicsApproval; sotw:conditionID :ethics-required; :approvedParty ?who;
  dpv:hasData ?data; dpv:hasPurpose ?purpose.`,
)}
${closed(
  "consent-report",
  `${requestedPurpose}
:consent-required odrl:leftOperand :matchingConsent; odrl:operator odrl:eq; odrl:rightOperand true.
:world sotw:context ?consent.
?consent a dpv:Consent; sotw:conditionID :consent-required; dpv:hasData ?data;
  dpv:hasPurpose ?purpose; dpv:hasConsentStatus dpv:ConsentGiven.`,
)}
# A withdrawal for the same data and purpose is explicit negative evidence. If
# it is contradicted by a given consent, interpretation fails closed.
${unsatisfied(
  "consent-report",
  `${requestedPurpose}
:world sotw:context ?consent.
?consent a dpv:Consent; sotw:conditionID :consent-required; dpv:hasData ?data;
  dpv:hasPurpose ?purpose; dpv:hasConsentStatus dpv:ConsentWithdrawn.`,
)}
${closed(
  "safeguard-report",
  `:safeguard-required odrl:leftOperand :deidentificationEvidence; odrl:operator odrl:eq; odrl:rightOperand true.
:world sotw:context ?safeguard.
?safeguard a :SafeguardRecord; sotw:conditionID :safeguard-required; dpv:hasData ?data;
  dpv:hasTechnicalOrganisationalMeasure dpv:Deidentification.`,
)}

# The profile interprets the custom retentionDays operand as whole days.
${satisfied(
  "retention-report",
  `:evaluation-42 sotw:requestParameter :retention-parameter.
:retention-parameter sotw:describesFeature :retentionDays; sotw:value ?days.
:research-use-42 :retentionDays ?days.
:retention-limit odrl:leftOperand :retentionDays; odrl:operator odrl:lteq; odrl:rightOperand ?max.
?days math:notGreaterThan ?max.`,
)}
${unsatisfied(
  "retention-report",
  `:evaluation-42 sotw:requestParameter :retention-parameter.
:retention-parameter sotw:describesFeature :retentionDays; sotw:value ?days.
:retention-limit odrl:rightOperand ?max. ?days math:greaterThan ?max.`,
)}
${unsatisfied(
  "retention-report",
  `:retention-parameter sotw:value ?days.
:research-use-42 :retentionDays ?requested.
?days log:notEqualTo ?requested.`,
)}
# Missing or unsupported retention information is not a satisfied premise.
${absent(
  "retention-report",
  `:evaluation-42 sotw:requestParameter ?parameter.
?parameter sotw:describesFeature :retentionDays; sotw:value ?days.`,
)}
${absent("retention-report", ":research-use-42 :retentionDays ?days.")}
${absent(
  "retention-report",
  ":retention-limit odrl:leftOperand :retentionDays; odrl:operator odrl:lteq; odrl:rightOperand ?max.",
)}

# Acceptance is a precondition. Actual onward policy preservation is NOT inferred.
${closed(
  "acceptance-report",
  `:acceptance-required odrl:leftOperand :policyAcceptance; odrl:operator odrl:eq; odrl:rightOperand true.
:world sotw:context ?acceptance.
?acceptance a :PolicyAcceptance; sotw:conditionID :acceptance-required; :acceptedBy ?who;
  :acceptedPolicy ?policy.
?data odrl:hasPolicy ?policy.`,
)}

# FORCE activation is the conjunction of all premises, not an agreement lookup.
{
  ${premiseDefinitions.map((p) => `:${p.id} report:satisfactionState report:Satisfied.`).join("\n  ")}
} => { :permission-report report:activationState report:Active. }.
{
  :permission-report report:premiseReport ?premise.
  ?premise report:satisfactionState report:Unsatisfied.
} => { :permission-report report:activationState report:Inactive. }.

# An access request is an attempt when party/action/target match the rule.
{
  :target-report report:satisfactionState report:Satisfied.
  :action-report report:satisfactionState report:Satisfied.
  :party-report report:satisfactionState report:Satisfied.
} => { :permission-report report:attemptState report:Attempted. }.
${["target-report", "action-report", "party-report"]
  .map(
    (id) => `{
  :${id} report:satisfactionState report:Unsatisfied.
} => { :permission-report report:attemptState report:NotAttempted. }.`,
  )
  .join("\n")}
{
  :policy-report a report:PolicyReport. :world :usePerformance report:Unknown.
} => {
  :permission-report report:performanceState report:Unknown;
    report:deonticState report:NonSet.
}.

# Separate, DEMO-SPECIFIC agreement construction after a positive evaluation.
# This is not an implementation of the full FORCE instantiation algorithm.
{
  :permission-report report:activationState report:Active.
  :evaluation-42 sotw:evaluatedParty ?who; sotw:evaluatedTarget ?data; sotw:evaluatedAction ?action.
  :research-use-42 odrl:assigner ?holder; :retentionDays ?days.
  ?data odrl:hasPolicy ?policy.
} => {
  :agreement-42 a odrl:Agreement; odrl:uid :agreement-42; odrl:profile :research-profile;
    odrl:assigner ?holder; odrl:assignee ?who; odrl:permission :granted-use-42;
    odrl:obligation :carry-policy; prov:wasDerivedFrom ?policy;
    dct:references :request-42, :policy-report.
  :granted-use-42 a odrl:Permission; odrl:assigner ?holder; odrl:assignee ?who;
    odrl:target ?data; odrl:action ?action; :retentionDays ?days;
    odrl:constraint :offered-purpose, :retention-limit, :ethics-required,
      :consent-required, :safeguard-required, :acceptance-required.
  :request-42 dpv:hasOutcome :agreement-42.
}.
`;

export const defaultState = {
  purpose: "ScientificResearch",
  approval: true,
  consent: true,
  deidentified: true,
  days: 30,
  carry: true,
  recipient: "university",
};

// The native policy graph of the trust envelope: the hospital's ODRL policy and
// the vocabulary its profile defines. _:data is both the payload graph's label
// and the Asset these rules target.
export const policyFacts = `
# The same blank node labels the native payload graph in the TriG envelope.
:cohort-b dpv:hasData _:data.
_:data a odrl:Asset, dpv:Data; odrl:hasPolicy :policy-b.
:policy-b a odrl:Set; odrl:uid :policy-b; odrl:profile :research-profile;
  odrl:permission :offered-use; odrl:obligation :carry-policy.
:offered-use a odrl:Permission; odrl:assigner :hospital;
  odrl:target _:data; odrl:action odrl:use;
  odrl:constraint :offered-purpose, :retention-limit, :ethics-required,
    :consent-required, :safeguard-required, :acceptance-required.
:offered-purpose a odrl:Constraint; odrl:leftOperand odrl:purpose;
  odrl:operator odrl:eq; odrl:rightOperand dpv:ScientificResearch.
:retention-limit a odrl:Constraint; odrl:leftOperand :retentionDays;
  odrl:operator odrl:lteq; odrl:rightOperand 30.
:ethics-required a odrl:Constraint; odrl:leftOperand :matchingEthicsApproval; odrl:operator odrl:eq; odrl:rightOperand true.
:consent-required a odrl:Constraint; odrl:leftOperand :matchingConsent; odrl:operator odrl:eq; odrl:rightOperand true.
:safeguard-required a odrl:Constraint; odrl:leftOperand :deidentificationEvidence; odrl:operator odrl:eq; odrl:rightOperand true.
:acceptance-required a odrl:Constraint; odrl:leftOperand :policyAcceptance; odrl:operator odrl:eq; odrl:rightOperand true.
# Future onward-sharing obligation; this demo does not evaluate its performance.
:carry-policy a odrl:Duty; odrl:action :preservePolicy; odrl:target :policy-b;
  odrl:constraint :onward-sharing-trigger.
:onward-sharing-trigger a odrl:Constraint; odrl:leftOperand :onwardSharing;
  odrl:operator odrl:eq; odrl:rightOperand true.
# Terms defined by the research profile.
:retentionDays a odrl:LeftOperand.
:matchingEthicsApproval a odrl:LeftOperand.
:matchingConsent a odrl:LeftOperand.
:deidentificationEvidence a odrl:LeftOperand.
:policyAcceptance a odrl:LeftOperand.
:onwardSharing a odrl:LeftOperand.
:preservePolicy a odrl:Action.
`;

function validate(state) {
  if (
    !["ScientificResearch", "Marketing"].includes(state.purpose) ||
    !["university", "partner-lab"].includes(state.recipient) ||
    !Number.isInteger(state.days) ||
    state.days < 1 ||
    state.days > 90 ||
    ["approval", "consent", "deidentified", "carry"].some(
      (key) => typeof state[key] !== "boolean",
    )
  )
    throw new Error("Invalid request");
}

// The request and the supporting evidence about the evaluated party. The
// snapshot is closed: evidence that is not listed here is absent, and FORCE
// treats absent information as not satisfied.
export function createEvidence(state) {
  validate(state);
  const context = [
    ":consent-b",
    ...(state.approval ? [":eth-2026-118"] : []),
    ...(state.deidentified ? [":safeguard-record"] : []),
    ...(state.carry ? [":acceptance-record"] : []),
  ];
  return `
# One fixed illustrative snapshot; no inference depends on the host clock.
:world a sotw:SotW; dct:issued "2026-10-26T09:00:00Z"^^xsd:dateTime;
  sotw:context ${context.join(", ")};
  :usePerformance report:Unknown.

# Illustrative DPV assertions, not authenticated attestations.
:consent-b a dpv:Consent; sotw:conditionID :consent-required;
  dpv:hasData _:data; dpv:hasPurpose dpv:ScientificResearch;
  dpv:hasConsentStatus dpv:${state.consent ? "ConsentGiven" : "ConsentWithdrawn"}.
${
  state.approval
    ? `:eth-2026-118 a :EthicsApproval; sotw:conditionID :ethics-required;
  :approvedParty :${state.recipient};
  dpv:hasData _:data; dpv:hasPurpose dpv:ScientificResearch.`
    : "# No ethics approval supplied for this recipient."
}
${
  state.deidentified
    ? `:safeguard-record a :SafeguardRecord; sotw:conditionID :safeguard-required;
  dpv:hasData _:data; dpv:hasTechnicalOrganisationalMeasure dpv:Deidentification.`
    : "# No de-identification evidence supplied."
}
${
  state.carry
    ? `:acceptance-record a :PolicyAcceptance; sotw:conditionID :acceptance-required;
  :acceptedBy :${state.recipient}; :acceptedPolicy :policy-b.`
    : "# Recipient has not accepted the attached policy."
}

# FORCE evaluation input plus an ODRL Request for report-model compatibility.
:evaluation-42 a sotw:EvaluationRequest; sotw:evaluatedParty :${state.recipient};
  sotw:evaluatedAction odrl:use; sotw:evaluatedTarget _:data;
  sotw:requestParameter :purpose-parameter, :retention-parameter.
:purpose-parameter a sotw:RequestParameter; sotw:describesFeature odrl:purpose;
  sotw:value dpv:${state.purpose}.
:retention-parameter a sotw:RequestParameter; sotw:describesFeature :retentionDays;
  sotw:value ${state.days}.
:request-42 a odrl:Request; odrl:profile :research-profile; odrl:permission :research-use-42.
:research-use-42 a odrl:Permission; odrl:assigner :hospital;
  odrl:assignee :${state.recipient}; odrl:target _:data; odrl:action odrl:use;
  odrl:constraint :purpose-42; :retentionDays ${state.days}.
:purpose-42 a odrl:Constraint; odrl:leftOperand odrl:purpose; odrl:operator odrl:eq;
  odrl:rightOperand dpv:${state.purpose}.
`;
}
export function createFacts(state) {
  return `${prefixes}${policyFacts}${createEvidence(state)}`;
}

// Parse actual RDF terms. Prefix aliases, comments and literal text cannot
// impersonate FORCE states, and contradictory states fail closed.
export function interpret(output) {
  const { namedNode, defaultGraph } = DataFactory;
  const ex = (name) => namedNode("https://example.org/access#" + name);
  const report = (name) =>
    namedNode("https://w3id.org/force/compliance-report#" + name);
  const store = new Store(new Parser({ format: "Turtle" }).parse(output));
  const stateOf = (subject, property, permitted) => {
    const values = store.getObjects(
      ex(subject),
      report(property),
      defaultGraph(),
    );
    if (
      values.length > 1 ||
      values.some(
        (value) =>
          value.termType !== "NamedNode" ||
          !permitted.includes(
            value.value.replace(
              "https://w3id.org/force/compliance-report#",
              "",
            ),
          ) ||
          !value.value.startsWith("https://w3id.org/force/compliance-report#"),
      )
    )
      throw new Error(`Invalid or contradictory FORCE ${property}`);
    return values[0]?.value.split("#").pop() || "NotReported";
  };
  const has = (subject, predicate, object) =>
    store.countQuads(
      ex(subject),
      namedNode(predicate),
      object,
      defaultGraph(),
    ) === 1;
  const rdfType = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
  if (store.countQuads(ex("permission-report"), null, null, null)) {
    if (
      !has("policy-report", rdfType, report("PolicyReport")) ||
      !has("permission-report", rdfType, report("PermissionReport")) ||
      !has("policy-report", report("policy").value, ex("policy-b")) ||
      !has("policy-report", report("policyRequest").value, ex("request-42")) ||
      !has(
        "policy-report",
        report("ruleReport").value,
        ex("permission-report"),
      ) ||
      !has("permission-report", report("rule").value, ex("offered-use")) ||
      !has(
        "permission-report",
        report("ruleRequest").value,
        ex("research-use-42"),
      ) ||
      premiseDefinitions.some(
        (p) =>
          !has(p.id, rdfType, report(p.type)) ||
          !has("permission-report", report("premiseReport").value, ex(p.id)) ||
          (p.constraint &&
            !has(p.id, report("constraint").value, ex(p.constraint))),
      )
    )
      throw new Error("Incomplete FORCE compliance report structure");
  }
  const premises = premiseDefinitions.map((p) => ({
    ...p,
    state: stateOf(p.id, "satisfactionState", ["Satisfied", "Unsatisfied"]),
  }));
  const activation = stateOf("permission-report", "activationState", [
    "Active",
    "Inactive",
  ]);
  const attempt = stateOf("permission-report", "attemptState", [
    "Attempted",
    "NotAttempted",
  ]);
  const performance = stateOf("permission-report", "performanceState", [
    "Unknown",
    "Performed",
    "Unperformed",
  ]);
  const deontic = stateOf("permission-report", "deonticState", [
    "NonSet",
    "Fulfilled",
    "Violated",
  ]);
  if (activation === "Active" && premises.some((p) => p.state !== "Satisfied"))
    throw new Error(
      "Active FORCE report has incomplete or unsatisfied premises",
    );
  if (
    activation === "Inactive" &&
    !premises.some((p) => p.state === "Unsatisfied")
  )
    throw new Error("Inactive FORCE report has no unsatisfied premise");
  return {
    allowed: activation === "Active",
    activation,
    attempt,
    performance,
    deontic,
    premises,
    checks: [
      "ethics-report",
      "consent-report",
      "safeguard-report",
      "retention-report",
      "acceptance-report",
    ].map((id) => premises.find((p) => p.id === id).state === "Satisfied"),
  };
}
