// Importing this package registers the connector as a side effect.
export { metaConnector, type MetaConfig, type MetaCredentials } from './connector';
export { MetaGraphError } from './graph-client';
export {
  checkFacebookPostStatus,
  createInstagramContainer,
  createInstagramStoryContainer,
  deleteFacebookPost,
  pollInstagramContainerReady,
  publishFacebookStory,
  publishInstagramContainer,
  scheduleFacebookPost,
  type FacebookScheduleResult,
  type FacebookStoryResult,
  type InstagramContainerResult,
} from './publish';
