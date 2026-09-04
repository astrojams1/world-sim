"use client";

import dynamic from "next/dynamic";

// The app renders with WebGL and random rooms, so it is client-only.
const App = dynamic(() => import("@/components/App"), { ssr: false });

export default function Home() {
  return <App />;
}
