import { useState } from "react";
import Search from "./screens/Search";
import Results from "./screens/Results";
import Journey from "./screens/Journey";
import { fetchPlan } from "./api";
import type { Plan } from "./types";

type Screen = "search" | "results" | "journey";
type Status = "idle" | "loading" | "error";

export default function App() {
  const [screen, setScreen] = useState<Screen>("search");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  const search = async (from: string, to: string) => {
    const normal = (v: string) => v.toLowerCase().replace(/[^a-z ]/g, "").trim();
    const supported =
      normal(from).includes("sungai long") && normal(to).includes("kl sentral");
    if (!supported) {
      setStatus("error");
      setMessage("Laluan ini belum disokong. / This route isn't supported yet.");
      return;
    }
    setStatus("loading");
    setMessage("");
    try {
      const next = await fetchPlan();
      setPlan(next);
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
      {screen === "results" && plan && (
        <Results plan={plan} onBack={() => setScreen("search")} onSelect={() => setScreen("journey")} />
      )}
      {screen === "journey" && plan && <Journey plan={plan} onBack={() => setScreen("results")} />}
    </main>
  );
}
