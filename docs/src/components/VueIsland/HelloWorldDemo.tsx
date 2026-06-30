'use client';

import * as React from 'react';
import { VueIsland } from './VueIsland';
import { HelloWorld } from './HelloWorld';

// Client wrapper: imports the Vue component on the client so its functions
// never cross the server/client boundary. This is the pattern for all Vue demos.
export function HelloWorldDemo() {
  return <VueIsland component={HelloWorld} />;
}
