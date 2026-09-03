// Composition root: shared tool routing over Mobile's embedding ports.
import { ToolRoutingService } from '@offgrid/models';
import { mobileToolRoutingPorts } from '../modelServices/toolPorts';
import { once } from './once';

export const toolRouting = once(() => new ToolRoutingService(mobileToolRoutingPorts()));
