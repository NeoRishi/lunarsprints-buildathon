import type { Sprint } from "./contracts";

/** Resolve answer IDs once, retaining who supplied each value and its certainty. */
export function planningFacts(s: Sprint) {
  const facts = [
    {
      id: "intention",
      question: "Original intention",
      value: s.intention,
      source: "user_utterance",
      status: "confirmed",
    },
  ];
  for (const answer of s.answers) {
    const q = s.clarification?.questions.find(
      (q) => q.id === answer.questionId,
    );
    if (!q || answer.status !== "confirmed") continue;
    const value =
      answer.customText ||
      q.options.find((o) => o.id === answer.optionId)?.text;
    if (value)
      facts.push({
        id: `answer:${q.id}`,
        question: q.question,
        value,
        source: answer.source,
        status: "confirmed",
      });
  }
  for (const answer of s.clarificationHistory ?? [])
    facts.push({
      id: `answer:${answer.questionId}`,
      question: answer.question,
      value: answer.value,
      source: answer.source,
      status: answer.status,
    });
  if (s.capacityMinutes !== null)
    facts.push({
      id: "availability",
      question: "Explicitly confirmed time budget",
      value: `${s.capacityMinutes} total minutes; daily limits: ${s.dailyMinutes.join(", ")}; buffer ${s.bufferPercent}%`,
      source: "user_confirmed",
      status: "confirmed",
    });
  return facts;
}
export function clarificationBase(s: Sprint) {
  return {
    intention: s.intention,
    selectedIntentIds: s.selectedIntentIds,
    goals: s.goals,
    stories: s.stories,
    allocations: s.allocations,
    capacityMinutes: s.capacityMinutes,
    dailyMinutes: s.dailyMinutes,
    bufferPercent: s.bufferPercent,
    progress: s.progress,
  };
}
