import Link from "next/link";
import { notFound } from "next/navigation";
import { AddToBag } from "@/components/bag";
import { aisleFor } from "@/lib/aisles";
import { catalog } from "@/lib/keel";
import { usd } from "@/lib/money";

export default async function ProductPage({ params }: PageProps<"/p/[sku]">) {
  const { sku } = await params;
  const item = (await catalog()).find((i) => i.sku === decodeURIComponent(sku));
  if (!item) notFound();
  const aisle = aisleFor(item.category);
  return (
    <main className="shop-main">
      <nav className="small dim" aria-label="Breadcrumb">
        <Link href="/" className="dim">
          Shop
        </Link>
        {aisle && (
          <>
            {" / "}
            <Link href={`/?aisle=${aisle.slug}`} className="dim">
              {aisle.label}
            </Link>
          </>
        )}
        {" / "}
        {item.title}
      </nav>
      <div className="two">
        <div className="pimg" style={{ aspectRatio: "1 / 1" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- remote catalog images */}
          {item.image_url && <img src={item.image_url} alt={item.title} />}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div>
            <h1 className="serif" style={{ margin: 0, fontSize: 34, lineHeight: "40px", fontWeight: 500 }}>
              {item.title}
            </h1>
            <div className="price" style={{ fontSize: 22, marginTop: 8 }}>
              {usd(item.price)}
            </div>
          </div>
          <AddToBag item={{ sku: item.sku, title: item.title, image: item.image_url, price: item.price }} sizes={aisle?.sizes ? [...aisle.sizes] : undefined} />
          <div className="box">
            <div className="box-b small mut" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span>Standard shipping takes 3 to 7 business days.</span>
              <span>Unused items can be refunded within 30 days of delivery.</span>
              <span>
                Questions?{" "}
                <Link href="/help" style={{ textDecoration: "underline" }}>
                  Chat with our support assistant
                </Link>
                .
              </span>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
