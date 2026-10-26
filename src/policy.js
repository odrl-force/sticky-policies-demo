export const prefixes = `@prefix : <https://example.org/access#> .
@prefix odrl: <http://www.w3.org/ns/odrl/2/> .
@prefix dpv: <https://w3id.org/dpv#> .
@prefix math: <http://www.w3.org/2000/10/swap/math#> .
`;

// Demo application profile: custom extension terms define these decision semantics.
export const rules = `${prefixes}
# R1 — An ethics approval must match the requester, dataset and purpose.
{
  :request-42 a odrl:Request; odrl:permission ?use.
  ?use odrl:assignee ?who; odrl:target ?data; odrl:constraint ?constraint.
  ?constraint odrl:leftOperand odrl:purpose; odrl:operator odrl:eq;
    odrl:rightOperand ?purpose.
  ?who :holdsApproval ?approval.
  ?approval dpv:hasData ?data; dpv:hasPurpose ?purpose.
} => { ?use dpv:hasJustification ?approval. }.

# R2 — Given consent must cover the requested dataset and purpose.
{
  :request-42 odrl:permission ?use.
  ?use odrl:target ?data; odrl:constraint ?constraint.
  ?constraint odrl:leftOperand odrl:purpose; odrl:operator odrl:eq;
    odrl:rightOperand ?purpose.
  ?consent a dpv:Consent; dpv:hasData ?data; dpv:hasPurpose ?purpose;
    dpv:hasConsentStatus dpv:ConsentGiven.
} => { ?use dpv:hasLegalBasis ?consent. }.

# R3 — A recorded safeguard is required; de-identification is not anonymity.
{
  :request-42 odrl:permission ?use.
  ?use odrl:target ?data.
  ?data dpv:hasTechnicalOrganisationalMeasure dpv:Deidentification.
} => { ?use dpv:hasTechnicalOrganisationalMeasure dpv:Deidentification. }.

# R4 — Evaluate the attached ODRL offer's retention constraint.
{
  :request-42 odrl:permission ?use.
  ?use :retentionDays ?days; odrl:target ?data.
  ?data :stickyPolicy ?policy.
  ?policy odrl:permission ?offered.
  ?offered odrl:constraint ?limit.
  ?limit odrl:leftOperand :retentionDays; odrl:operator odrl:lteq;
    odrl:rightOperand ?max.
  ?days math:notGreaterThan ?max.
} => { ?use :retentionSatisfied true. }.

# R5 — The recipient commits to carry the same policy into further sharing.
{
  :request-42 odrl:permission ?use.
  ?use odrl:target ?data; :acceptsPolicy ?policy.
  ?data :stickyPolicy ?policy.
} => { ?use :policyPreserved true. }.

# R6 — Only the full conjunction derives an agreement. No default permission.
{
  :request-42 a odrl:Request; odrl:profile :research-profile; odrl:permission ?use.
  ?use a odrl:Permission; odrl:assigner ?holder; odrl:assignee ?researcher;
    odrl:target ?data; odrl:action odrl:use; odrl:constraint ?constraint;
    dpv:hasJustification ?approval; dpv:hasLegalBasis ?consent;
    dpv:hasTechnicalOrganisationalMeasure dpv:Deidentification;
    :retentionSatisfied true; :policyPreserved true.
  ?data :stickyPolicy ?policy.
  ?policy odrl:permission ?offered.
  ?offered odrl:constraint ?offeredConstraint.
  ?offeredConstraint odrl:leftOperand odrl:purpose; odrl:operator odrl:eq;
    odrl:rightOperand ?purpose.
  ?constraint odrl:leftOperand odrl:purpose; odrl:operator odrl:eq;
    odrl:rightOperand ?purpose.
} => {
  :agreement-42 a odrl:Agreement; odrl:profile :research-profile;
    odrl:assigner ?holder; odrl:assignee ?researcher; odrl:permission ?use;
    :inheritsPolicy ?policy.
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

export function createFacts(state) {
  if (
    !["ScientificResearch", "Marketing"].includes(state.purpose) ||
    !["university", "partner-lab"].includes(state.recipient) ||
    !Number.isInteger(state.days) ||
    state.days < 1 ||
    state.days > 90
  )
    throw new Error("Invalid request");
  return `${prefixes}
# The blank node names the payload graph in the exported TriG dataset.
:cohort-b :dataGraph _:data.
_:data :stickyPolicy :policy-b.
:policy-b a odrl:Offer; odrl:profile :research-profile;
  odrl:permission :offered-use.
:offered-use a odrl:Permission; odrl:assigner :hospital;
  odrl:target _:data; odrl:action odrl:use;
  odrl:constraint :offered-purpose, :retention-limit;
  odrl:duty :carry-policy.
:offered-purpose a odrl:Constraint; odrl:leftOperand odrl:purpose;
  odrl:operator odrl:eq; odrl:rightOperand dpv:ScientificResearch.
:retention-limit a odrl:Constraint; odrl:leftOperand :retentionDays;
  odrl:operator odrl:lteq; odrl:rightOperand 30.
:carry-policy a odrl:Duty; odrl:action :preservePolicy; odrl:target :policy-b.

# Each recipient needs a fresh request, never an inherited access grant.
:request-42 a odrl:Request; odrl:profile :research-profile;
  odrl:permission :research-use-42.
:research-use-42 a odrl:Permission; odrl:assigner :hospital;
  odrl:assignee :${state.recipient}; odrl:target _:data;
  odrl:action odrl:use; odrl:constraint :purpose-42;
  :retentionDays ${state.days}.
:purpose-42 a odrl:Constraint; odrl:leftOperand odrl:purpose;
  odrl:operator odrl:eq; odrl:rightOperand dpv:${state.purpose}.

# Illustrative authority assertions, not verified real-world attestations.
${
  state.approval
    ? `:${state.recipient} :holdsApproval :eth-2026-118.
:eth-2026-118 dpv:hasData _:data; dpv:hasPurpose dpv:ScientificResearch.`
    : "# No ethics approval supplied for this recipient."
}
:consent-b a dpv:Consent; dpv:hasData _:data;
  dpv:hasPurpose dpv:ScientificResearch;
  dpv:hasConsentStatus dpv:${state.consent ? "ConsentGiven" : "ConsentWithdrawn"}.
${state.deidentified ? "_:data dpv:hasTechnicalOrganisationalMeasure dpv:Deidentification." : "# No de-identification evidence supplied."}
${state.carry ? ":research-use-42 :acceptsPolicy :policy-b." : "# Recipient has not accepted the attached policy."}
`;
}

export function interpret(output) {
  const has = (value) => output.includes(value);
  return {
    allowed:
      has("odrl:Agreement") || has("<http://www.w3.org/ns/odrl/2/Agreement>"),
    checks: [
      has("hasJustification"),
      has("hasLegalBasis"),
      has("hasTechnicalOrganisationalMeasure"),
      has("retentionSatisfied"),
      has("policyPreserved"),
    ],
  };
}
