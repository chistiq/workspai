import { GRAPH_LOCATOR_IDENTITY_LAW } from '../contracts/foundation.js';
import {
  admitDeclaredGraphLocator,
  classifyGraphRelativeLocator,
  decodeGraphLocatorState,
  opaqueGraphDeclaredLocator,
} from '../domain/locator-identity.js';

/**
 * Public locator-identity API. Shadow consumers must use this contract, not a
 * parallel decoder.
 */
export const GRAPH_LOCATOR_IDENTITY = Object.freeze({
  ...GRAPH_LOCATOR_IDENTITY_LAW,
  classify: classifyGraphRelativeLocator,
  decode: decodeGraphLocatorState,
  admitDeclared: admitDeclaredGraphLocator,
  opaqueDeclared: opaqueGraphDeclaredLocator,
});
