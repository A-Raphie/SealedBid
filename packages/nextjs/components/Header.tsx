"use client";

import React from "react";
import { RainbowKitCustomConnectButton } from "~~/components/helper";

export const Header = () => {
  return (
    <div className="sticky top-0 z-30 bg-[#0d1129] border-b border-white/[0.06]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between py-2.5">
        <span className="text-lg font-semibold text-white tracking-tight">
          Sealed<span className="text-[#FFD208]">Bid</span>
        </span>
        <RainbowKitCustomConnectButton />
      </div>
    </div>
  );
};
