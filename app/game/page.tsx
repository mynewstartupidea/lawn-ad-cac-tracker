import { Suspense } from "react";
import GameHubLoader from "./GameHubLoader";

export const metadata = {
  title: "Realm Rush — Battle Arena",
  description: "1v1 real-time strategy battle game",
};

export default function GamePage() {
  return (
    <Suspense fallback={
      <div style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#f1f5f9", fontSize: 18, fontFamily: "system-ui",
      }}>
        ⚔️ Loading Realm Rush…
      </div>
    }>
      <GameHubLoader />
    </Suspense>
  );
}
