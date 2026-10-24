import Ledger from "@/components/Ledger";
import { loadLedger } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function Home() {
  return <Ledger initial={await loadLedger()} />;
}
