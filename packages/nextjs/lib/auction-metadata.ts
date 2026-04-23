export type AuctionMetadata = {
  image: string;
  estimatedValue: string;
  condition: "New" | "Used" | "Digital" | "Refurbished";
  location: string;
  tags: string[];
  reserveMet: boolean;
  reservePrice?: string;
};

export const CATEGORY_DEFAULTS: Record<number, { image: string; gradient: string }> = {
  0: {
    image: "https://images.unsplash.com/photo-1633356122102-3fe601e05bd2?w=600&h=400&fit=crop",
    gradient: "from-purple-600 to-blue-600",
  },
  1: {
    image: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=600&h=400&fit=crop",
    gradient: "from-cyan-600 to-blue-700",
  },
  2: {
    image: "https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=600&h=400&fit=crop",
    gradient: "from-emerald-600 to-teal-700",
  },
  3: {
    image: "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=600&h=400&fit=crop",
    gradient: "from-orange-500 to-amber-600",
  },
  4: {
    image: "https://images.unsplash.com/photo-1610375461246-83df859d849d?w=600&h=400&fit=crop",
    gradient: "from-yellow-500 to-amber-500",
  },
};

export function parseItemURI(uri: string): AuctionMetadata | null {
  if (!uri || uri === "") return null;
  try {
    return JSON.parse(uri) as AuctionMetadata;
  } catch {
    return null;
  }
}

export function buildItemURI(meta: Partial<AuctionMetadata>): string {
  return JSON.stringify(meta);
}
