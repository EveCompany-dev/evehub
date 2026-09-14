// Importing this package registers the connector as a side effect.
export { metaConnector, type MetaConfig, type MetaCredentials } from './connector';
export { MetaGraphError } from './graph-client';
export {
  assertMediaUrlIsPublic,
  checkFacebookPostStatus,
  createInstagramContainer,
  createInstagramReelContainer,
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
export {
  ALL_TARGETS,
  mediaKindFromUrl,
  targetAcceptsMedia,
  targetLabel,
  type MediaKind,
  type Platform,
  type PostTarget,
  type PostTypeName,
} from './shared';
