"use client";

import dynamic from "next/dynamic";

const BoomerangGeneratorDynamic = dynamic(
  () => import("./BoomerangGenerator").then((m) => m.BoomerangGenerator),
  { ssr: false },
);

export function BoomerangGeneratorClient() {
  return <BoomerangGeneratorDynamic />;
}
