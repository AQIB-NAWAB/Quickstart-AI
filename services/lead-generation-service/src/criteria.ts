import type { CriterionEvaluation, LeadEvidence, SearchCriterion } from "@quickstart/contracts";

/** Evaluate observed values only. Missing data never proves absence or a negative condition. */
export function evaluateCriteria(
  criteria: SearchCriterion[],
  evidence: LeadEvidence[],
): CriterionEvaluation[] {
  return criteria.map((criterion) => {
    const observation = evidence.find(
      (item) => item.field.toLowerCase() === criterion.field.toLowerCase(),
    );
    let status: CriterionEvaluation["status"] = "unknown";
    const actual = observation?.value.trim();
    const expected = criterion.value?.trim();
    if (actual && criterion.operator !== "semantic_match") {
      let matched: boolean | undefined;
      switch (criterion.operator) {
        case "exists":
          matched = true;
          break;
        case "equals":
          if (expected !== undefined) matched = actual.toLowerCase() === expected.toLowerCase();
          break;
        case "not_equals":
          if (expected !== undefined) matched = actual.toLowerCase() !== expected.toLowerCase();
          break;
        case "contains":
          if (expected !== undefined)
            matched = actual.toLowerCase().includes(expected.toLowerCase());
          break;
        case "greater_than":
        case "less_than": {
          // Do not interpret ranges, currency suffixes or incomplete numbers as exact values.
          const numeric = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;
          if (expected && numeric.test(actual) && numeric.test(expected)) {
            matched =
              criterion.operator === "greater_than"
                ? Number(actual) > Number(expected)
                : Number(actual) < Number(expected);
          }
          break;
        }
      }
      if (matched !== undefined) status = matched ? "matched" : "unmet";
    }
    return {
      criterion: criterion.id,
      mandatory: criterion.mandatory,
      status,
      value: actual,
      source_url: observation?.source_url,
      quote: observation?.quote,
      explanation:
        status === "unknown"
          ? `${criterion.field}: insufficient evidence or unsupported semantic evaluation`
          : `${criterion.field}: observed value ${status === "matched" ? "matches" : "does not match"} the requirement`,
    };
  });
}
