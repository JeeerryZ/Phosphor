"use client";

import { motion } from "motion/react";
import { Spinner } from "@/components/ui/Spinner";

const COLUMN_COUNT = 3;
const CARD_COUNT = 5;

export default function InventoryLoading() {
  return (
    <main className="bg-grid min-h-screen px-6 py-10">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex items-center justify-between">
          <div className="bg-panel-raised h-9 w-64 animate-pulse rounded" />
          <Spinner />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {Array.from({ length: COLUMN_COUNT }).map((_, columnIndex) => (
            <div key={columnIndex} className="flex flex-col gap-4">
              <div className="bg-panel-raised h-16 w-full animate-pulse rounded-lg" />
              {Array.from({ length: CARD_COUNT }).map((_, cardIndex) => (
                <motion.div
                  key={cardIndex}
                  initial={{ opacity: 0.3 }}
                  animate={{ opacity: [0.3, 0.6, 0.3] }}
                  transition={{
                    duration: 1.6,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: cardIndex * 0.08,
                  }}
                  className="border-border bg-panel/80 h-28 rounded-lg border"
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
