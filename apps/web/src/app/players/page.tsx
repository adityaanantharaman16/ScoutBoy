import { Suspense } from "react";

import { Loading } from "@/components/common";
import { SearchExperience } from "@/components/search/SearchExperience";

export default function PlayersPage() {
  return (
    <Suspense fallback={<Loading label="Loading Discover..." />}>
      <SearchExperience />
    </Suspense>
  );
}
