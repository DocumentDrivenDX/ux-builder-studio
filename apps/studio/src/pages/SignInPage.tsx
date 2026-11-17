/* Before anything else: who you are. The studio signs people in with their
   organisation's identity provider; what they then see of the
   organisation's data is what the data catalog lets them see. */
import { Card, Notice } from "@ux-builder/ui";
import { Page, Stack } from "@ux-builder/ui/patterns";
import { Button } from "../agent/generated/bound/ux-builder-ui";
import { useSession } from "../session";

export function SignInPage() {
  const { auth, signIn } = useSession();
  const expired = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("signin") === "expired";
  return (
    <main className="studio-signin">
      <Page width="form">
        <Card title="Sign in to UX Builder Studio">
          <Stack gap={4}>
            {expired ? <Notice tone="warning" title="That sign-in took too long">Sign in again.</Notice> : null}
            <p>Build apps on your organisation's data, by describing them. You sign in as yourself: the apps you make, and the data you see in them, follow your organisation's permissions.</p>
            {auth?.mode === "local" ? (
              <Notice tone="info" title="A sample organisation, on this computer">
                This studio signs in with {auth.label}. You'll choose one of its made-up people; each sees different data in the catalog.
              </Notice>
            ) : auth ? <p className="studio-meta">Signing in with {auth.label}.</p> : null}
            <div>
              <Button onClick={signIn} agent={{ nonAgent: "signing in is the person's own step, before the App Expert is available" }}>Sign in</Button>
            </div>
          </Stack>
        </Card>
      </Page>
    </main>
  );
}
