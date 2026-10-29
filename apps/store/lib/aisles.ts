// The shop's aisles, matching the API's catalog categories.
export const AISLES = [
  { slug: "jackets", label: "Jackets", category: "Jackets", sizes: ["XS", "S", "M", "L", "XL"] },
  { slug: "footwear", label: "Footwear", category: "Footwear", sizes: ["7", "8", "9", "10", "11", "12"] },
  { slug: "bottles", label: "Bottles", category: "Bottles", sizes: null },
] as const;

export const aisleFor = (category: string) => AISLES.find((a) => a.category === category);
