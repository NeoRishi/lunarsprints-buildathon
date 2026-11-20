import "./safe-test-errors";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);
const { data, error } = await db
  .from("ls_agent_runs")
  .select("role,session_id,turn_id,duration_ms,error_code")
  .eq("status", "error")
  .order("created_at", { ascending: false })
  .limit(3);
if (error) throw new Error("Could not read run metadata");
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  maxRetries: 0,
});
for (const row of data ?? []) {
  console.log("Failed run metadata", row);
  if (row.session_id) {
    for await (const turn of client.beta.agents.sessions.turns.list(
      row.session_id,
    )) {
      console.log("Turn outcome", { status: turn.status, error: turn.error });
    }
  }
}
