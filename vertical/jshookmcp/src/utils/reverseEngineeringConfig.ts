import type { ReverseEngineeringConfig } from '@internal-types/config';
import { getConfig } from './config';

export function getReverseEngineeringConfig(): ReverseEngineeringConfig {
  return getConfig().reverseEngineering;
}
