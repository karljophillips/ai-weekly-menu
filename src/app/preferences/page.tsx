import { auth, signIn } from "@/auth";
import { getSettings } from "@/lib/sheets";
import { PreferencesForm } from "./PreferencesForm";

export default async function PreferencesPage() {
  const session = await auth();

  if (!session) {
    return (
      <main className="mx-auto max-w-md p-8">
        <h1 className="mb-4 text-xl font-semibold">Sign in required</h1>
        <form
          action={async () => {
            "use server";
            await signIn("google");
          }}
        >
          <button
            type="submit"
            className="rounded bg-black px-4 py-2 text-white"
          >
            Sign in with Google
          </button>
        </form>
      </main>
    );
  }

  const settings = await getSettings();

  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="mb-6 text-xl font-semibold">Meal preferences</h1>
      <PreferencesForm initialSettings={settings} />
    </main>
  );
}
