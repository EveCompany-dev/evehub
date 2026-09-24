// Importing this package registers the connector as a side effect.
export { metaConnector, type MetaConfig, type MetaCredentials } from './connector';
export { isMissingObjectError, isUnknownOutcomeError, MetaGraphError } from './graph-client';
export {
  assertMediaUrlIsPublic,
  checkFacebookPostStatus,
  ContainerNotReadyError,
  getInstagramContainerStatus,
  metaPublishApi,
  createInstagramCarouselContainer,
  createInstagramCarouselItemContainer,
  createInstagramContainer,
  createInstagramReelContainer,
  createInstagramStoryContainer,
  deleteFacebookPost,
  fetchPermalink,
  pollInstagramContainerReady,
  publishFacebookStory,
  publishInstagramContainer,
  scheduleFacebookPost,
  type FacebookScheduleResult,
  type FacebookStoryResult,
  type ContainerStatus,
  type InstagramContainerResult,
} from './publish';
export {
  ALL_TARGETS,
  MAX_CAROUSEL_ITEMS,
  MIN_CAROUSEL_ITEMS,
  mediaKindFromUrl,
  targetAcceptsMedia,
  targetLabel,
  type MediaKind,
  type Platform,
  type PostTarget,
  type PostTypeName,
} from './shared';
