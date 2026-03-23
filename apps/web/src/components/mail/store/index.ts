// apps/web/src/components/mail/store/index.ts

export {
  type ComposeInstance,
  useComposeStore,
} from './compose-store'
export {
  type CountUpdates,
  selectSharedInboxCount,
  selectSharedInboxesTotal,
  selectViewCount,
  useMailCountsStore,
} from './mail-counts-store'
