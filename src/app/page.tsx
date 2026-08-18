import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="mb-2 text-xl font-semibold">AI Weekly Menu</h1>
      <p className="mb-6 text-gray-600">
        This week&apos;s dinners are on the &quot;Meals&quot; Google
        Calendar. Use the preferences page to steer future weeks or trigger
        a manual regenerate.
      </p>
      <Link href="/preferences" className="underline">
        Go to preferences →
      </Link>
    </main>
  );
}
