import { LinkButton } from "@/components/app/ui";

export default function NotFound() {
  return (
    <div className="mx-auto mt-16 max-w-md text-center">
      <p className="text-sm font-medium text-primary">404</p>
      <h1 className="mt-1 text-xl font-semibold tracking-tight">We could not find that page</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The record may belong to a different demo persona, or the demo data was reset.
      </p>
      <LinkButton href="/" className="mt-5">
        Back to start
      </LinkButton>
    </div>
  );
}
