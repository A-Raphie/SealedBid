export type AuctionTemplate = {
  title: string;
  description: string;
  category: number;
  meta: {
    image: string;
    estimatedValue: string;
    condition: string;
    location: string;
    tags: string[];
    reserveMet: boolean;
    reservePrice?: string;
  };
};

export const TEMPLATES: AuctionTemplate[] = [
  {
    title: "Ethereal Dreams #47",
    description:
      "A mesmerizing generative art piece exploring the intersection of chaos and order. Part of the Ethereal Dreams collection, this 1/1 piece uses algorithmic patterns to create unique visual harmonics.",
    category: 0,
    meta: {
      image: "https://images.unsplash.com/photo-1634017839464-5c339ebe3cb4?w=600&h=400&fit=crop",
      estimatedValue: "~0.15 ETH ($380)",
      condition: "Digital",
      location: "On-chain",
      tags: ["1/1", "Generative", "Verified"],
      reserveMet: false,
      reservePrice: "0.08 ETH",
    },
  },
  {
    title: "Tokyo Nights Photo",
    description:
      "Rare digital photograph from the neon-lit streets of Shibuya. Captured at midnight during a rainstorm, this piece evokes the electric energy of urban Japan. Limited edition 1/1.",
    category: 0,
    meta: {
      image: "https://images.unsplash.com/photo-1549490349-8643362247b5?w=600&h=400&fit=crop",
      estimatedValue: "~0.08 ETH ($200)",
      condition: "Digital",
      location: "On-chain",
      tags: ["Photography", "Rare", "1/1"],
      reserveMet: true,
      reservePrice: "0.04 ETH",
    },
  },
  {
    title: "Downtown Studio — 6 Month Lease",
    description:
      "Modern studio apartment in the heart of downtown. 450 sq ft, furnished, gym access, rooftop terrace. Sealed bidding ensures fair market rent discovery.",
    category: 2,
    meta: {
      image: "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=600&h=400&fit=crop",
      estimatedValue: "$650/month",
      condition: "Used",
      location: "Austin, TX",
      tags: ["Studio", "Furnished", "Downtown"],
      reserveMet: false,
      reservePrice: "$500/mo",
    },
  },
  {
    title: "Smart Contract Security Audit",
    description:
      "Full security audit for a Solidity smart contract up to 2,000 lines. Includes static analysis, fuzzing, and a detailed report with remediation steps. FHE-encrypted bidding ensures fair competition.",
    category: 3,
    meta: {
      image: "https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=600&h=400&fit=crop",
      estimatedValue: "$500 — $800",
      condition: "Digital",
      location: "Remote",
      tags: ["Security", "Audit", "Solidity"],
      reserveMet: true,
      reservePrice: "$400",
    },
  },
  {
    title: "Landing Page Design & Build",
    description:
      "Custom responsive landing page design with Figma mockups and coded implementation. Includes 2 revision rounds, SEO optimization, and Lighthouse 95+ performance target.",
    category: 3,
    meta: {
      image: "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=600&h=400&fit=crop",
      estimatedValue: "$300 — $600",
      condition: "Digital",
      location: "Remote",
      tags: ["Design", "Frontend", "Responsive"],
      reserveMet: false,
    },
  },
  {
    title: "5 oz Silver Bullion (Tokenized)",
    description:
      "Physical silver backed 1:1 by tokenized certificates on-chain. Stored in a vault with full insurance. Instant settlement upon auction completion via smart contract.",
    category: 4,
    meta: {
      image: "https://images.unsplash.com/photo-1610375461246-83df859d849d?w=600&h=400&fit=crop",
      estimatedValue: "~$165 (spot price)",
      condition: "New",
      location: "Vault Storage",
      tags: ["Silver", "Tokenized", "Physical"],
      reserveMet: false,
      reservePrice: "$140",
    },
  },
  {
    title: "Quantum Fractals #12",
    description:
      "AI-generated fractal artwork rendered at 8K resolution. Each piece in the Quantum Fractals series is computationally unique and verified on-chain. Includes physical print.",
    category: 0,
    meta: {
      image: "https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?w=600&h=400&fit=crop",
      estimatedValue: "~0.12 ETH ($300)",
      condition: "Digital",
      location: "On-chain",
      tags: ["AI Art", "Fractal", "8K"],
      reserveMet: false,
      reservePrice: "0.06 ETH",
    },
  },
  {
    title: "Logo & Brand Identity Package",
    description:
      "Complete brand identity design including logo, color palette, typography guide, and social media templates. 3 initial concepts with unlimited refinements on chosen direction.",
    category: 3,
    meta: {
      image: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=600&h=400&fit=crop",
      estimatedValue: "$200 — $500",
      condition: "Digital",
      location: "Remote",
      tags: ["Branding", "Logo", "Design"],
      reserveMet: true,
      reservePrice: "$150",
    },
  },
  {
    title: "Vintage Rolex Oyster (1965)",
    description:
      "Authentic vintage Rolex Oyster Perpetual from 1965. Recently serviced, keeping excellent time. Comes with original box and authentication certificate from a certified horologist.",
    category: 4,
    meta: {
      image: "https://images.unsplash.com/photo-1569529465841-dfecdab7503b?w=600&h=400&fit=crop",
      estimatedValue: "~$850",
      condition: "Used",
      location: "London, UK",
      tags: ["Vintage", "Luxury", "Authenticated"],
      reserveMet: false,
      reservePrice: "$600",
    },
  },
  {
    title: "Web3 Dev Bootcamp Scholarship",
    description:
      "Full scholarship to a 12-week intensive Web3 development bootcamp covering Solidity, React, and FHE integration. Includes mentorship, career support, and certificate upon completion.",
    category: 3,
    meta: {
      image: "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=600&h=400&fit=crop",
      estimatedValue: "~$499",
      condition: "Digital",
      location: "Remote",
      tags: ["Education", "Web3", "Scholarship"],
      reserveMet: true,
      reservePrice: "$300",
    },
  },
  {
    title: "Rare Vinyl Collection — 25 LPs",
    description:
      "Curated collection of 25 rare vinyl records spanning jazz, soul, and classic rock. Includes original pressings of Miles Davis, Marvin Gaye, and Led Zeppelin. All graded VG+ or better.",
    category: 4,
    meta: {
      image: "https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=600&h=400&fit=crop",
      estimatedValue: "~$750",
      condition: "Used",
      location: "Nashville, TN",
      tags: ["Vinyl", "Rare", "Collection"],
      reserveMet: false,
      reservePrice: "$500",
    },
  },
  {
    title: "Banksy-Style Limited Print",
    description:
      "Numbered limited edition screen print (47/200) from a contemporary street artist. Features iconic stencil work with social commentary. Museum-quality archival paper, signed and authenticated.",
    category: 0,
    meta: {
      image: "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=600&h=400&fit=crop",
      estimatedValue: "~$450",
      condition: "New",
      location: "Berlin, Germany",
      tags: ["Print", "Street Art", "Limited"],
      reserveMet: false,
      reservePrice: "$300",
    },
  },
];

export function pickRandom(arr: AuctionTemplate[], count: number): AuctionTemplate[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

export const TARGET_ACTIVE = 8;
