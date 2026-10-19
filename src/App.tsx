import { useState } from "react";
import Search from "./screens/Search";
import Results from "./screens/Results";
import Journey from "./screens/Journey";
import { fetchPlans } from "./api";
import type { Plan } from "./types";

type Screen = "search" | "results" | "journey";
type Status = "idle" | "loading" | "error";

export default function App() {
  const [screen, setScreen] = useState<Screen>("search");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  const search = async (from: string, to: string, fromName?: string) => {
    setStatus("loading");
    setMessage("");
    try {
      const next = await fetchPlans(from, to, { fromName });
      if (!next.length) throw new Error("Tiada laluan / No route found");
      setPlans(next);
      setPlan(next[0]);
      setScreen("results");
      setStatus("idle");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Data unavailable");
    }
  };

  return (
    <main className="app">
      {screen === "search" && <Search onSearch={search} loading={status === "loading"} error={status === "error" ? message : null} />}
      {screen === "results" && plans.length > 0 && (
        <Results
          plans={plans}
          onBack={() => setScreen("search")}
          onSelect={(index) => {
            setPlan(plans[index]);
            setScreen("journey");
          }}
        />
      )}
      {screen === "journey" && plan && <Journey plan={plan} onBack={() => setScreen("results")} />}
    </main>
  );
}
