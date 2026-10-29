"use client";

import Link from "next/link";
import { useCallback, useState, useSyncExternalStore } from "react";
import { addLine, type BagLine, itemCount, parseBag } from "@/lib/bag";

const KEY = "tidewell-bag";
const EVENT = "tidewell-bag";

// Storage can be blocked (private mode, disabled site data): the bag then lives for this page only.
const read = (): string | null => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

const subscribe = (fn: () => void) => {
  window.addEventListener(EVENT, fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener("storage", fn);
  };
};

/** The bag and a setter that saves it and tells every bag view on the page. */
export function useBag(): [BagLine[], (next: BagLine[]) => void] {
  const raw = useSyncExternalStore(subscribe, read, () => null);
  const bag = parseBag(raw);
  const save = useCallback((next: BagLine[]) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {}
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [bag, save];
}

export function BagLink() {
  const [bag] = useBag();
  return <Link href="/bag">Bag ({itemCount(bag)})</Link>;
}

export function AddToBag({ item, sizes, small }: { item: Omit<BagLine, "qty" | "size">; sizes?: string[]; small?: boolean }) {
  const [bag, save] = useBag();
  const [size, setSize] = useState(sizes?.[Math.floor(sizes.length / 2)] ?? null);
  const [added, setAdded] = useState(false);
  const add = () => {
    save(addLine(bag, { ...item, size }));
    setAdded(true);
  };
  if (small) {
    return (
      <button type="button" className="sbtn sm" onClick={add} aria-label={`Add ${item.title} to bag`}>
        {added ? "Added" : "Add to bag"}
      </button>
    );
  }
  return (
    <>
      {sizes && (
        <fieldset className="sizes">
          <legend className="sl">Size</legend>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {sizes.map((z) => (
              <button key={z} type="button" className={z === size ? "sbtn sm on" : "sbtn sm"} aria-pressed={z === size} onClick={() => setSize(z)} style={{ minWidth: 56 }}>
                {z}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button type="button" className="sbtn pri" style={{ flex: "1 1 200px" }} onClick={add}>
          {added ? "Added · add another" : "Add to bag"}
        </button>
        <Link className="sbtn" href="/bag">
          Go to bag
        </Link>
      </div>
    </>
  );
}
