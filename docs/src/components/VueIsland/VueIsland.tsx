'use client';

import * as React from 'react';
import { createApp, type Component } from 'vue';

interface VueIslandProps {
  /** Vue component to mount (render-function or SFC component). */
  component: Component;
  /** Props passed to the mounted Vue root component. */
  props?: Record<string, unknown>;
}

/**
 * Mounts a Vue 3 app into a React-rendered container (client-only island).
 * Server renders an empty container; Vue mounts in an effect on the client.
 */
export function VueIsland({ component, props }: VueIslandProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return undefined;
    }
    const app = createApp(component, props ?? {});
    app.mount(el);
    return () => app.unmount();
  }, [component, props]);

  return <div ref={containerRef} suppressHydrationWarning />;
}
