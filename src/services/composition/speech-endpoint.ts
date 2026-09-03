// Composition root: the shared speech endpoint timer over Mobile's logger.
import { SpeechEndpointTimer } from '@offgrid/speech';
import logger from '../../utils/logger';

/** One turn's endpoint detector. The caller owns begin/stop; shared owns the silence rule. */
export function createSpeechEndpointTimer(onEndedBySilence: () => void): SpeechEndpointTimer {
  return new SpeechEndpointTimer(onEndedBySilence, line => logger.log(line));
}
