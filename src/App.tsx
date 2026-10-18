import { useState } from "react";
import Search from "./screens/Search";
import Results from "./screens/Results";
import Journey from "./screens/Journey";
import { routes, type Route } from "./data/routes";

type Screen = "search" | "results" | "journey";

export default function App() {
  const [screen, setScreen] = useState<Screen>("search");
  const [route, setRoute] = useState<Route>(routes[0]);

  return (
    <main className="app">
      {screen === "search" && <Search onSearch={() => setScreen("results")} />}
      {screen === "results" && (
        <Results
          onBack={() => setScreen("search")}
          onSelect={(next) => {
            setRoute(next);
            setScreen("journey");
          }}
        />
      )}
      {screen === "journey" && <Journey route={route} onBack={() => setScreen("results")} />}
    </main>
  );
}
