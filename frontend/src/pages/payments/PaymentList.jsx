import { Plus } from 'lucide-react'

import Page, { Fab } from '../../components/layout/Page.jsx'
import Button from '../../components/ui/Button.jsx'
import { useSession } from '../../context/SessionContext.jsx'
import { PAYMENT_KINDS } from './paymentConfig.js'
import { PaymentListContent } from './PaymentShared.jsx'

export default function PaymentList({ kind }) {
  const cfg = PAYMENT_KINDS[kind]
  const { t } = useSession()
  return (
    <Page
      title={t(cfg.titleKey)}
      actions={<Button to={`${cfg.base}/new`} icon={Plus}>{cfg.newLabel}</Button>}
      mobileActions={null}
      fab={<Fab><Button to={`${cfg.base}/new`} size="lg" icon={Plus} variant={kind === 'in' ? 'success' : 'danger'}>{cfg.newLabel}</Button></Fab>}
    >
      <PaymentListContent kind={kind} />
    </Page>
  )
}
