import type {
  Goal,
  Sprint,
  Story,
} from "../src/features/lunarsprints/contracts";
import { newSprint } from "../src/features/lunarsprints/coordinator";
export const goal: Goal = {
  id: "goal-portfolio",
  intentId: "portfolio",
  title: "Launch a focused portfolio",
  statement:
    "Publish one reviewed case study and a working home page by November 11.",
  smart: {
    specific: "A published portfolio with a home page and one case study.",
    measurable: "Both pages are live and checked.",
    achievable: "Pending effort review.",
    relevant: "The user wants to launch a portfolio.",
    timeBound: "By November 11.",
  },
  completionCriteria: [
    "Home page and one case study are publicly accessible.",
    "Both pages work on a phone and laptop.",
  ],
  definitionOfSuccess: "A working public portfolio with a reviewed case study.",
  deadline: "2026-11-11",
  assumptions: [],
  warnings: [],
  confidence: "medium",
  feasibility: "provisional",
};
export const story: Story = {
  id: "story-launch",
  goalId: goal.id,
  title: "Publish and check the portfolio",
  description: "Finish the remaining public pages.",
  definitionOfDone: [
    "The pages are published and checked on two screen sizes.",
  ],
  priority: 1,
  dependencyIds: [],
  coveredCriteria: [0, 1],
  tasks: [
    {
      id: "task-write",
      title: "Publish the case study",
      motivation: "Show the work clearly.",
      minutes: 45,
      definitionOfDone: "The case study page is live and reviewed.",
      subtasks: [
        {
          id: "sub-draft",
          title: "Draft the case study",
          minutes: 25,
          definitionOfDone: "The draft describes the process and outcome.",
        },
        {
          id: "sub-review",
          title: "Review and publish",
          minutes: 20,
          definitionOfDone: "The reviewed case study is publicly accessible.",
        },
      ],
    },
    {
      id: "task-check",
      title: "Check responsive pages",
      motivation: "Make the portfolio usable on different screens.",
      minutes: 30,
      definitionOfDone: "Both pages work on phone and laptop widths.",
      subtasks: [],
    },
  ],
};
export function sprint(): Sprint {
  const s = newSprint(crypto.randomUUID(), {
    startDate: "2026-10-28",
    timezone: "Asia/Kolkata",
    capacityMinutes: 600,
    dailyMinutes: Array(15).fill(60),
    bufferPercent: 20,
  });
  s.originalIntention = "Launch my portfolio.";
  s.intention = s.originalIntention;
  s.assessment = {
    intents: [
      {
        id: "portfolio",
        outcome: "Launch my portfolio",
        why: null,
        priority: null,
        conflicts: [],
      },
    ],
    facts: [],
    uncertainties: [],
    baseline: null,
    constraints: [],
    recommendation: "Start with one goal.",
  };
  s.selectedIntentIds = ["portfolio"];
  s.goals = [structuredClone(goal)];
  s.stage = "goals";
  return s;
}
