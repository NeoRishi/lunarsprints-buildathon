/** Future opt-in capabilities. No ingestion, astrology API, or extra runtime is required. */
export interface KnowledgeRetrievalPort {
  retrieve(input: {
    userId: string;
    query: string;
    consentRef: string;
    topic: string;
  }): Promise<{
    status: "ok" | "unavailable" | "missing_consent";
    snippets: {
      text: string;
      sourceUrl: string;
      sourceTitle: string;
      provenance: "retrieved_untrusted";
    }[];
  }>;
}
export interface RhythmPort {
  read(input: {
    startDate: string;
    endDate: string;
    timezone: string;
    consentRef: string;
    convention: string;
  }): Promise<{
    status: "verified" | "partial" | "unavailable";
    facts: { date: string; field: string; value: string; sourceUrl: string }[];
    traditionalSuggestions: { text: string; sourceUrl: string }[];
  }>;
}
export const featureFlags = {
  realtimeVoice: false,
  rhythmGuidance: false,
  personalJyotisha: false,
  knowledgeRetrieval: false,
} as const;
