// Importing this package registers the connector as a side effect.
export { metaConnector, type MetaConfig, type MetaCredentials } from './connector';
export { MetaGraphError } from './graph-client';
export {
  assertMediaUrlIsPublic,
  checkFacebookPostStatus,
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
