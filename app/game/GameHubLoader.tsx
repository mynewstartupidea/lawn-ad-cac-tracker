"use client";

import { useSearchParams } from "next/navigation";
import GameHub from "../components/game/GameHub";

export default function GameHubLoader() {
  const params = useSearchParams();
  const room = params.get("room") ?? undefined;
  return <GameHub initialRoom={room} />;
}
