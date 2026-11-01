import { AppShell } from "@/features/workspace/components/app-shell";
import { loadWorkspaceShell } from "@/lib/server/auth/session";

type Props = {
  children: React.ReactNode;
  params: { workspaceId: string };
};

export default async function WorkspaceLayout({ children, params }: Props) {
  const { me, workspaces, activeWorkspace } = await loadWorkspaceShell(params.workspaceId);

  return (
    <AppShell
      workspaceId={activeWorkspace.id}
      workspaceName={activeWorkspace.name}
      userEmail={me.user.email}
      workspaces={workspaces}
      organizations={me.organizations}
      activeOrgId={activeWorkspace.orgId ?? activeWorkspace.org_id}
    >
      {children}
    </AppShell>
  );
}
