/* Before anything else: who you are. The studio signs people in with their
   organisation's identity provider; what they then see of the
   organisation's data is what the data catalog lets them see. */
import { Card, Notice } from "@ux-builder/ui";
import { Page, Stack } from "@ux-builder/ui/patterns";
import { Button } from "../agent/generated/bound/ux-builder-ui";
import { useSession } from "../session";

export function SignInPage() {
  const { auth, signIn, solo } = useSession();
  const expired = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("signin") === "expired";
  return (
    <main className="studio-signin">
      <Page width="form">
        <Stack gap={5}>
          {expired ? <Notice tone="warning" title="That sign-in took too long">Sign in again.</Notice> : null}
          {auth?.solo ? (
            <Card title="Build on your own">
              <Stack gap={3}>
                <p>The whole studio, as before: describe an app to the App Expert, bring in a brand, build, preview with sample people, make variants. Your apps keep their own data. No organisation, no sign-in.</p>
                <div>
                  <Button onClick={() => void solo()} agent={{ nonAgent: "choosing how to use the studio is the person's own step, before the App Expert is available" }}>Start building</Button>
                </div>
              </Stack>
            </Card>
          ) : null}
          <Card title={auth?.solo ? "Or sign in to an organisation" : "Sign in to UX Builder Studio"}>
            <Stack gap={3}>
              <p>{auth?.solo ? "Everything above, plus apps" : "Build apps by describing them, including apps"} on the organisation's data: reports and dashboards over its data catalog, and apps that keep that data up to date. You sign in as yourself, so the apps you make, and the data you see in them, follow the organisation's permissions.</p>
              {auth?.mode === "local" ? (
                <p className="studio-meta">On this computer, that is {auth.label}: you choose one of its made-up people, and each sees different data.</p>
              ) : auth ? <p className="studio-meta">Signing in with {auth.label}.</p> : null}
              <div>
                <Button variant={auth?.solo ? "secondary" : "primary"} onClick={signIn} agent={{ nonAgent: "signing in is the person's own step, before the App Expert is available" }}>Sign in</Button>
              </div>
            </Stack>
          </Card>
        </Stack>
      </Page>
    </main>
  );
}
