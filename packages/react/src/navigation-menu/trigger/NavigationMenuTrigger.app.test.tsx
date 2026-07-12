import { expect, vi } from 'vitest';
import * as React from 'react';
import { NavigationMenu } from '@base-ui/react/navigation-menu';
import { createRenderer } from '#test-utils';
import { screen, waitFor } from '@mui/internal-test-utils';
import userEvent from '@testing-library/user-event';

describe('NavigationMenu with Suspending Content', () => {
  const { render } = createRenderer();

  it('should not throw "Maximum update depth exceeded" when Content suspends', async () => {
    const cache = new Map<string, { done: boolean; promise: Promise<void> }>();
    function suspendOnce(key: string): void {
      let entry = cache.get(key);
      if (!entry) {
        const created = { done: false, promise: Promise.resolve() };
        created.promise = new Promise<void>((resolve) => {
          setTimeout(() => {
            created.done = true;
            resolve();
          }, 150);
        });
        cache.set(key, created);
        entry = created;
      }
      if (!entry.done) throw entry.promise;
    }

    function SuspendingContent({ id }: { id: string }) {
      suspendOnce(id);
      return <span>content {id}</span>;
    }

    const ITEMS = ['a', 'b', 'c', 'd', 'e'];

    function App() {
      return (
        <React.Suspense fallback={<div>loading…</div>}>
          <NavigationMenu.Root>
            <NavigationMenu.List style={{ display: 'flex' }}>
              {ITEMS.map((id) => (
                <NavigationMenu.Item key={id}>
                  <NavigationMenu.Trigger>{id}</NavigationMenu.Trigger>
                  <NavigationMenu.Content>
                    <SuspendingContent id={id} />
                  </NavigationMenu.Content>
                </NavigationMenu.Item>
              ))}
            </NavigationMenu.List>
            <NavigationMenu.Portal>
              <NavigationMenu.Positioner>
                <NavigationMenu.Popup>
                  <NavigationMenu.Viewport />
                </NavigationMenu.Popup>
              </NavigationMenu.Positioner>
            </NavigationMenu.Portal>
          </NavigationMenu.Root>
        </React.Suspense>
      );
    }

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await render(<App />);

      // Hover over first item
      const trigger = screen.getByText('a');
      await user.hover(trigger);

      // Wait for content to load
      await waitFor(() => {
        expect(screen.queryByText('loading…')).not.toBeInTheDocument();
        expect(screen.getByText('content a')).toBeInTheDocument();
      });

      // Check that no "Maximum update depth exceeded" error was thrown
      const hasMaxDepthError = consoleErrorSpy.mock.calls.some((call) =>
        String(call[0]).includes('Maximum update depth exceeded'),
      );

      expect(hasMaxDepthError).toBe(false);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
