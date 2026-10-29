import { redirect } from "next/navigation";
import { currentCustomer } from "@/lib/customer";
import { catalog } from "@/lib/keel";
import { safeNext } from "@/lib/store-input";
import { SignInForm } from "./form";

export default async function SignInPage({ searchParams }: PageProps<"/signin">) {
  const next = safeNext((await searchParams).next);
  if (await currentCustomer()) redirect(next);
  const hero = (await catalog().catch(() => [])).find((i) => i.title === "Torrent Rain Jacket" && i.image_url);
  return (
    <main style={{ flex: 1, display: "flex", flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 480px", background: "#EFEAE2", display: "flex", alignItems: "center", justifyContent: "center", padding: 48, boxSizing: "border-box", position: "relative", minHeight: 360 }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- remote catalog image */}
        {hero && <img src={hero.image_url!} alt="" style={{ maxWidth: "72%", maxHeight: 560, objectFit: "contain", mixBlendMode: "multiply" }} />}
        <div className="serif" style={{ position: "absolute", left: 48, right: 48, bottom: 40, maxWidth: 360, fontSize: 28, lineHeight: "34px" }}>
          Made for the weather you actually get.
        </div>
      </div>
      <div style={{ flex: "1 1 420px", display: "flex", alignItems: "center", justifyContent: "center", padding: 48, boxSizing: "border-box" }}>
        <SignInForm next={next} />
      </div>
    </main>
  );
}
