import Ledger from "@/components/Ledger";
import { createClient } from "@/lib/supabase/server";
import type { Partner } from "@/lib/ledger";

export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = (user?.email ?? "").toLowerCase();

  // RLS only returns partner rows to a signed-in partner, so an empty result means "not invited".
  const { data: me } = await supabase.from("partners").select("id,name,email,role,sort").eq("email", email).maybeSingle<Partner>();

  if (!me) {
    return (
      <main className="mx-auto mt-[8vh] grid max-w-sm gap-4">
        <h1 className="font-display text-2xl font-extrabold">This ledger is for invited partners</h1>
        <p className="note">
          You're signed in as <b className="text-ink">{email || "an unknown account"}</b>, which isn't one of the partner emails. Sign in with the email you were invited
          with, or ask Towfiq to add you.
        </p>
        <form action="/auth/signout" method="post">
          <button className="btn btn-ghost" type="submit">
            Sign out
          </button>
        </form>
      </main>
    );
  }

  return <Ledger me={me} />;
}
