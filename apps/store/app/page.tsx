import Link from "next/link";
import { AddToBag } from "@/components/bag";
import { AISLES } from "@/lib/aisles";
import { catalog } from "@/lib/keel";
import { usd } from "@/lib/money";

export default async function ShopPage({ searchParams }: PageProps<"/">) {
  const { aisle: raw } = await searchParams;
  const aisle = AISLES.find((a) => a.slug === raw);
  const items = (await catalog()).filter((i) => (aisle ? i.category === aisle.category : i.category !== "Other"));
  return (
    <main className="shop-main">
      <div>
        <h1 className="serif" style={{ margin: 0, fontSize: 36, lineHeight: "44px", fontWeight: 500, letterSpacing: "-0.01em" }}>
          {aisle ? aisle.label : "Rain-ready essentials"}
        </h1>
        <p className="mut" style={{ margin: "6px 0 0" }}>
          Jackets, shoes and bottles for wet commutes and weekend trails.
        </p>
      </div>
      {items.length === 0 ? (
        <p className="mut">Nothing here yet.</p>
      ) : (
        <ul className="pgrid" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {items.map((p) => (
            <li key={p.sku} className="pcard">
              <Link className="pimg" href={`/p/${encodeURIComponent(p.sku)}`} tabIndex={-1} aria-hidden="true">
                {/* eslint-disable-next-line @next/next/no-img-element -- remote catalog images */}
                {p.image_url && <img src={p.image_url} alt="" loading="lazy" />}
              </Link>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <Link className="pname" href={`/p/${encodeURIComponent(p.sku)}`}>
                  {p.title}
                </Link>
                <span className="price">{usd(p.price)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <span className="small dim">{p.category}</span>
                {/* Sized items pick a size on their page. */}
                {AISLES.find((a) => a.category === p.category)?.sizes ? (
                  <Link className="sbtn sm" href={`/p/${encodeURIComponent(p.sku)}`}>
                    Choose size
                  </Link>
                ) : (
                  <AddToBag small item={{ sku: p.sku, title: p.title, image: p.image_url, price: p.price }} />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
