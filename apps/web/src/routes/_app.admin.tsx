import { t as tMacro } from "@lingui/core/macro"
import { useLingui } from "@lingui/react/macro"
import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router"
import { isWorkspaceAdmin } from "@audit/domain/roles"
import { PageBody } from "../components/feedback.tsx"
import {
  SECTION_LINK_CLASS,
  SectionFrame,
  SectionGroup,
} from "../components/shell/section-frame.tsx"

/** Owners and admins only. Everyone else is sent to the home page. */
export const Route = createFileRoute("/_app/admin")({
  beforeLoad: ({ context }) => {
    if (!isWorkspaceAdmin(context.me.role)) throw redirect({ to: "/" })
  },
  staticData: { crumb: () => ({ label: tMacro`Admin console`, to: "/admin" }) },
  component: AdminLayout,
})

function AdminLayout() {
  const { t } = useLingui()
  return (
    <SectionFrame
      label={t`Admin console`}
      nav={
        <>
          <SectionGroup title={t`General`}>
            <Link to="/admin" activeOptions={{ exact: true }} className={SECTION_LINK_CLASS}>
              {t`Overview`}
            </Link>
            <Link to="/admin/workspace" className={SECTION_LINK_CLASS}>
              {t`Workspace`}
            </Link>
            <Link to="/admin/branding" className={SECTION_LINK_CLASS}>
              {t`Branding`}
            </Link>
          </SectionGroup>
          <SectionGroup title={t`People`}>
            <Link to="/admin/members" className={SECTION_LINK_CLASS}>
              {t`Members`}
            </Link>
            <Link to="/admin/invites" className={SECTION_LINK_CLASS}>
              {t`Invites`}
            </Link>
            <Link to="/admin/teams" className={SECTION_LINK_CLASS}>
              {t`Teams`}
            </Link>
            <Link to="/admin/access" className={SECTION_LINK_CLASS}>
              {t`Access review`}
            </Link>
          </SectionGroup>
          <SectionGroup title={t`Projects`}>
            <Link to="/admin/projects" className={SECTION_LINK_CLASS}>
              {t`Projects`}
            </Link>
          </SectionGroup>
          <SectionGroup title={t`Security and compliance`}>
            <Link to="/admin/security" className={SECTION_LINK_CLASS}>
              {t`Security`}
            </Link>
            <Link to="/admin/audit" className={SECTION_LINK_CLASS}>
              {t`Audit log`}
            </Link>
            <Link to="/admin/retention" className={SECTION_LINK_CLASS}>
              {t`Retention`}
            </Link>
          </SectionGroup>
          <SectionGroup title={t`Infrastructure`}>
            <Link to="/admin/email" className={SECTION_LINK_CLASS}>
              {t`Email`}
            </Link>
            <Link to="/admin/storage" className={SECTION_LINK_CLASS}>
              {t`Storage`}
            </Link>
            <Link to="/admin/maintenance" className={SECTION_LINK_CLASS}>
              {t`Maintenance`}
            </Link>
            <Link to="/admin/ai" className={SECTION_LINK_CLASS}>
              {t`AI`}
            </Link>
          </SectionGroup>
        </>
      }
    >
      <PageBody width="full" className="max-w-5xl">
        <Outlet />
      </PageBody>
    </SectionFrame>
  )
}
