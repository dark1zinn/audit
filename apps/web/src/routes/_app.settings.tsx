import { t as tMacro } from "@lingui/core/macro"
import { useLingui } from "@lingui/react/macro"
import { createFileRoute, Link, Outlet } from "@tanstack/react-router"
import { PageBody } from "../components/feedback.tsx"
import {
  SECTION_LINK_CLASS,
  SectionFrame,
  SectionGroup,
} from "../components/shell/section-frame.tsx"

export const Route = createFileRoute("/_app/settings")({
  staticData: { crumb: () => ({ label: tMacro`Settings`, to: "/settings/profile" }) },
  component: SettingsLayout,
})

function SettingsLayout() {
  const { t } = useLingui()
  return (
    <SectionFrame
      label={t`Settings`}
      nav={
        <SectionGroup title={t`Account`}>
          <Link to="/settings/profile" className={SECTION_LINK_CLASS}>
            {t`Profile`}
          </Link>
          <Link to="/settings/notifications" className={SECTION_LINK_CLASS}>
            {t`Notifications`}
          </Link>
          <Link to="/settings/security" className={SECTION_LINK_CLASS}>
            {t`Security`}
          </Link>
          <Link to="/settings/privacy" className={SECTION_LINK_CLASS}>
            {t`Privacy`}
          </Link>
        </SectionGroup>
      }
    >
      <PageBody width="narrow">
        <Outlet />
      </PageBody>
    </SectionFrame>
  )
}
