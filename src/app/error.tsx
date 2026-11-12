"use client";

import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto mt-16 max-w-md text-center" role="alert">
      <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Nothing was changed. Try again, or reset the demo data from the guided demo page.
      </p>
      <Button className="mt-5" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
