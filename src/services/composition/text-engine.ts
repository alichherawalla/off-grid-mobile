// Composition root: shared text-engine control over Mobile's native runtimes.
import { TextEngineApplicationService } from '@offgrid/models';
import { mobileTextEnginePorts } from '../modelServices/textEngineControl';
import { once } from './once';

export const textEngineControl = once(() => new TextEngineApplicationService(mobileTextEnginePorts()));
