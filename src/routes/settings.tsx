import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const [jsonUrl, setJsonUrl] = useState(
    "https://raw.githubusercontent.com/YOUR_NAME/YOUR_REPO/main/redux.json",
  );

  return (
    <div className="p-8 text-white">
      <h1 className="text-3xl font-bold mb-6">Settings</h1>

      <div className="rounded-xl border border-white/10 bg-white/5 p-6 max-w-2xl">
        <label className="block text-sm text-white/70 mb-2">GitHub JSON URL</label>

        <input
          value={jsonUrl}
          onChange={(e) => setJsonUrl(e.target.value)}
          className="w-full rounded-lg bg-black/40 border border-white/10 px-4 py-3 text-white outline-none"
          placeholder="https://raw.githubusercontent.com/..."
        />

        <button
          onClick={() => {
            localStorage.setItem("reduxJsonUrl", jsonUrl);
            alert("Saved");
          }}
          className="mt-4 rounded-lg bg-blue-600 px-5 py-2 text-white hover:bg-blue-700"
        >
          Save
        </button>
      </div>
    </div>
  );
}
